const { EndBehaviorType, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const prism = require('prism-media');
const { v4: uuidv4 } = require('uuid');

const activeUserRecordings = new Map();
let mixedArchiveRecording = null;
let isRecordingActive = false;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("record")
        .setDescription("Recording both individual and mixed archive"),
    async execute(interaction) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply('You need to be in a voice channel to start recording!');
        }

        if (isRecordingActive) {
            return await interaction.reply('Recording is already active!');
        }

        let connection = getVoiceConnection(interaction.guild.id);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
        }

        isRecordingActive = true;
        const currentDate = new Date().toISOString().split('T')[0];
        const userID = interaction.user.id;
        const sessionId = uuidv4();

        const basePath = `server/chunks/audio/${currentDate}/${sessionId}`;

        fs.writeFileSync("server/metadata.json", JSON.stringify({
            basepath: basePath
        }));

        const foldersToCreate = [
            `${basePath}/users`,
            `${basePath}/archive`,
        ]

        foldersToCreate.forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }
        });

        const mixedArchiveFile = `${basePath}/archive/mixed.pcm`
        const mixedArchiveStream = fs.createWriteStream(mixedArchiveFile)

        mixedArchiveRecording = {
            stream: mixedArchiveStream,
            filePath: mixedArchiveFile,
            startTime: Date.now()
        }

        await interaction.reply(`Started recording, session ID: ${sessionId}`);

        connection.receiver.speaking.on("start", (userID) => {
            if (!activeUserRecordings.has(userID)) {
                startIndividualRecording(connection, userID, basePath);
            }
        });

        addUserToMixedArchive(connection, userID);
    }
}

function startIndividualRecording(connection, userId, basePath) {
    const userFolder = `${basePath}/users/${userId}`;
    const chunksFolder = `${userFolder}/chunks`;
    const fullFolder = `${userFolder}/full`;

    [userFolder, chunksFolder, fullFolder].forEach(folder => {
        if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
        }
    });

    const userFullFile = `${fullFolder}/${userId}_complete.pcm`
    const userFullStream = fs.createWriteStream(userFullFile)

    activeUserRecordings.set(userId, {
        fullStream: userFullStream,
        chunksFolder: chunksFolder,
        fullPath: userFullFile,
        startTime: Date.now(),
        chunkCount: 0,
        username: `User_${userId.slice(-4)}`
    })

    const userContinousStream = connection.receiver.subscribe(userId, {
        end: {
            behaviour: EndBehaviorType.Manual
        }
    })

    const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
    })

    userContinousStream.pipe(decoder).pipe(activeUserRecordings.get(userId).fullStream, {end: false})

    connection.receiver.speaking.on("start", (speakingUserId) => {
        if (speakingUserId != userId) return;

        const chunkStream = connection.receiver.subscribe(userId, {
            end: {
                behaviour: EndBehaviorType.AfterSilence,
                duration: 1000
            }
        })

        const chunkDecoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000
        })

        const recording = activeUserRecordings.get(userId);
        recording.chunkCount++;
        const chunkFile = `${recording.chunksFolder}/chunk_${recording.chunkCount}.pcm`;
        const chunkOutput = fs.createWriteStream(chunkFile);
        const chunkStartTime = Date.now();

        chunkStream.pipe(chunkDecoder).pipe(chunkOutput)

        chunkOutput.on("finish", async () => {
            const chunkEndTime = Date.now();
            const chunkDuration = chunkEndTime - chunkStartTime;
            
            if (chunkDuration < 750) {
                fs.unlink(chunkFile, (err) => {
                    if (err) console.error(err);
                });
                return;
            }

            const { PythonShell } = require('python-shell');
            const options = {
                scriptPath: 'server/scripts',
                args: [chunkFile, userId, recording.username, sessionId] 
            };
            PythonShell.run('whisper.py', options, function(err, results) {
                if (err) {
                    console.error('Transcription error:', err);
                } else {
                    console.log(`Transcribed chunk for ${recording.username} (${userId})`);
                }
            });
        });
    });
}

function addUserToMixedArchive(connection, userId) {
    if (!mixedArchiveRecording) return;

    const mixedStream = connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual
        }
    });

    const mixedDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
    });

    mixedStream.pipe(mixedDecoder).pipe(mixedArchiveRecording.stream, {end: false});
}

module.exports.setUsername = function(userId, username) {
    if (activeUserRecordings.has(userId)) {
        activeUserRecordings.get(userId).username = username;
        console.log(`Updated username for ${userId}: ${username}`);
        return true;
    }
    return false;
};

module.exports.stopAllRecordings = function() {
    console.log(`Stopping recordings for ${activeUserRecordings.size} users`);
    
    const results = {
        individualRecordings: [],
        mixedArchive: null
    };

    activeUserRecordings.forEach((recording, userId) => {
        recording.fullStream.end();
        const duration = Date.now() - recording.startTime;
        results.individualRecordings.push({
            userId,
            username: recording.username,
            filePath: recording.fullPath,
            duration,
            chunks: recording.chunkCount
        });
        console.log(`Stopped individual recording for ${recording.username} (${userId}): ${duration}ms, ${recording.chunkCount} chunks`);
    });

    if (mixedArchiveRecording) {
        mixedArchiveRecording.stream.end();
        results.mixedArchive = {
            filePath: mixedArchiveRecording.filePath,
            duration: Date.now() - mixedArchiveRecording.startTime
        };
        console.log(`Stopped mixed archive: ${results.mixedArchive.duration}ms`);
    }

    activeUserRecordings.clear();
    mixedArchiveRecording = null;
    isRecordingActive = false;
    
    return results;
};