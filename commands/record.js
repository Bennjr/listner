const { EndBehaviorType, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const prism = require('prism-media');
const { v4: uuidv4 } = require('uuid');

const activeUserRecordings = new Map();
const activeSpeakingHandlers = new Map(); // TRACKS ACTIVE SPEAKERS
let mixedArchiveRecording = null; 
let recState = false;
let currentConnection = null;
let currentSessionId = null;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("record")
        .setDescription("Recording both individual and mixed archive"),
    async execute(interaction) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply('You need to be in a voice channel to start recording!');
        }

        if (recState) {
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

        currentConnection = connection;
        recState = true;
        const currentDate = new Date().toISOString().split('T')[0];
        const userID = interaction.user.id;
        const sessionId = uuidv4();
        currentSessionId = sessionId;

        const basePath = `server/chunks/audio/${currentDate}/${sessionId}`;
        try {
            fs.writeFileSync("server/metadata.json", JSON.stringify({
                basepath: basePath,
                sessionId: sessionId,
                currentDate: currentDate,
                recState: recState,
            }, null, 2));
        } catch (error) {
            console.error('Error writing metadata:', error);
        }

        const foldersToCreate = [
            `${basePath}/users`,
            `${basePath}/archive`,
        ]

        try {
            foldersToCreate.forEach(folder => {
                if (!fs.existsSync(folder)) {
                    fs.mkdirSync(folder, { recursive: true });
                }
            });
        } catch (error) {
            console.error('Error creating folders:', error);
            return await interaction.reply('Error creating directories!');
        }

        const mixedArchiveFile = `${basePath}/archive/mixed.pcm`
        const mixedArchiveStream = fs.createWriteStream(mixedArchiveFile)

        mixedArchiveRecording = {
            stream: mixedArchiveStream,
            filePath: mixedArchiveFile,
            startTime: Date.now()
        }

        await interaction.reply(`Started recording, session ID: ${sessionId}`);

        const mainSpeakingHandler = (userID) => {
            if (!activeUserRecordings.has(userID)) {
                console.log(`Starting recording for new user: ${userID}`);
                startIndividualRecording(connection, userID, basePath);
                addUserToMixedArchive(connection, userID)
            }
        }
        
        activeSpeakingHandlers.set(userID, mainSpeakingHandler);
        connection.receiver.speaking.on("start", mainSpeakingHandler);

        connection.on(`error`, (error) => {
            console.error(`Connection error: ${error.message}`);
        });

        connection.on(`disconnect`, () => {
            console.log(`Disconnected from voice channel`);
            module.exports.stopAllRecordings();
        });
    }
}

function startIndividualRecording(connection, userId, basePath) {
    const userFolder = `${basePath}/users/${userId}`;
    const chunksFolder = `${userFolder}/chunks`;
    const fullFolder = `${userFolder}/full`;

    try {
        [userFolder, chunksFolder, fullFolder].forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }
        });
    } catch (error) {
        console.error(`Error creating folders for user ${userId}:`, error);
        return;
    }

    const userFullFile = `${fullFolder}/${userId}_complete.pcm`
    const userFullStream = fs.createWriteStream(userFullFile)

    userFullStream.on("error", (error) => {
        console.error(`Error writing full stream for user ${userId}:`, error);
    });

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

    decoder.on("error", (error) => {
        console.error(`Error decoding stream for user ${userId}:`, error);
    });

    userContinousStream.on("error", (error) => {
        console.error(`Error receiving stream for user ${userId}:`, error);
    });

    userContinousStream.pipe(decoder).pipe(userFullStream, {end: false})

    const speakingHandler = (speakingUserId) => {
        if (speakingUserId != userId) return;

        const recording = activeUserRecordings.get(userId);
        
        if (!recording) {
            console.warn(`No recording found for user ${userId}, skipping chunk`)
            return;
        }

        const chunkStream = connection.receiver.subscribe(userId, {
            end: {
                behaviour: EndBehaviorType.AfterSilence,
                duration: 1000
            }
        });

        const chunkDecoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000
        });

        recording.chunkCount++;
        const chunkFile = `${recording.chunksFolder}/chunk_${recording.chunkCount}.pcm`;
        const chunkOutput = fs.createWriteStream(chunkFile);
        const chunkStartTime = Date.now();

        chunkStream.on('error', (error) => {
            console.error(`Chunk stream error for user ${userId}:`, error);
        });

        chunkDecoder.on('error', (error) => {
            console.error(`Chunk decoder error for user ${userId}:`, error);
        });

        chunkOutput.on('error', (error) => {
            console.error(`Chunk output error for user ${userId}:`, error);
        });

        chunkStream.pipe(chunkDecoder).pipe(chunkOutput);

        chunkOutput.on("finish", async () => {
            const chunkEndTime = Date.now();
            const chunkDuration = chunkEndTime - chunkStartTime;
            
            if (chunkDuration < 750) {
                fs.unlink(chunkFile, (err) => {
                    if (err) console.error(err);
                });
                return;
            }
            try {
                const { PythonShell } = require('python-shell');
                const options = {
                    scriptPath: 'server/scripts',
                    args: [chunkFile, userId, currentRecording.username, sessionId],
                    pythonOptions: ['-u'] 
                };
                PythonShell.run('whisper.py', options, function(err, results) {
                    if (err) {
                        console.error(`Transcription error for ${currentRecording.username} (${userId}):`, err);
                    } else {
                        console.log(`Transcribed chunk for ${currentRecording.username} (${userId})`);
                        if (results && results.length > 0) {
                            console.log(`Python script output:`, results);
                        }
                    }
                });
            } catch (error) {
                console.error(`Error running Python script for ${currentRecording.username} (${userId}):`, error);
            }
        });
    };

    activeUserRecordings.set(userId, {
        fullStream: userFullStream,
        continuousStream: userContinuousStream,
        decoder: decoder,
        chunksFolder: chunksFolder,
        fullPath: userFullFile,
        startTime: Date.now(),
        chunkCount: 0,
        username: `User_${userId.slice(-4)}`,
        sessionId: sessionId
    });

    activeSpeakingHandlers.set(userId, speakingHandler);
    connection.receiver.speaking.on("start", speakingHandler);

    console.log(`Started individual recording for ${userId}`)
}

function addUserToMixedArchive(connection, userId) {
    if (!mixedArchiveRecording) {
        console.warn(`No mixed archive recording active`);
        return;
    };
    
    try {
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

        mixedStream.on('error', (error) => {
            console.error(`Mixed stream error for user ${userId}:`, error);
        });

        mixedDecoder.on('error', (error) => {
            console.error(`Mixed decoder error for user ${userId}:`, error);
        });

        mixedStream.pipe(mixedDecoder).pipe(mixedArchiveRecording.stream, { end: false });
        console.log(`Added user ${userId} to mixed archive`);
    } catch (error) {
        console.error(`Error adding user ${userId} to mixed archive:`, error);
    }
}

module.exports.setUsername = function(userId, username) {
    if (activeUserRecordings.has(userId)) {
        activeUserRecordings.get(userId).username = username;
        console.log(`Updated username for ${userId}: ${username}`);
        return true;
    }
    return false;
};

function stopIndividualRecording(userId) {
    const recording = activeUserRecordings.get(userId);
    if (!recording) {
        console.warn(`No active recording found for user ${userId}`);
        return null;
    }

    try {
        const speakingHandler = activeSpeakingHandlers.get(userId);
        if (speakingHandler && currentConnection) {
            currentConnection.receiver.speaking.removeListener("start", speakingHandler);
            activeSpeakingHandlers.delete(userId);
        }

        if (recording.fullStream) {
            recording.fullStream.end();
        }
        
        if (recording.continuousStream) {
            recording.continuousStream.destroy();
        }

        if (recording.decoder) {
            recording.decoder.destroy();
        }

        const duration = Date.now() - recording.startTime;
        const result = {
            userId: userId,
            username: recording.username,
            filePath: recording.fullPath,
            duration: duration,
            chunks: recording.chunkCount,
            sessionId: recording.sessionId
        };

        activeUserRecordings.delete(userId);
        console.log(`Stopped individual recording for ${recording.username} (${userId}): ${duration}ms, ${recording.chunkCount} chunks`);
        
        return result;
    } catch (error) {
        console.error(`Error stopping recording for user ${userId}:`, error);
        activeUserRecordings.delete(userId);
        activeSpeakingHandlers.delete(userId);
        return null;
    }
}

module.exports.stopAllRecordings = function() {
    console.log(`Stopping recordings for ${activeUserRecordings.size} users`);
    
    const results = {
        individualRecordings: [],
        mixedArchive: null
    };

    const userIds = Array.from(activeUserRecordings.keys());
    userIds.forEach(userId => {
        const result = stopIndividualRecording(userId);
        if (result) {
            results.individualRecordings.push(result);
        }
    });

    const mainHandler = activeSpeakingHandlers.get('main');
    if (mainHandler && currentConnection) {
        currentConnection.receiver.speaking.removeListener("start", mainHandler);
        activeSpeakingHandlers.delete('main');
    }

    if (mixedArchiveRecording) {
        try {
            mixedArchiveRecording.stream.end();
            results.mixedArchive = {
                filePath: mixedArchiveRecording.filePath,
                duration: Date.now() - mixedArchiveRecording.startTime
            };
            console.log(`Stopped mixed archive: ${results.mixedArchive.duration}ms`);
        } catch (error) {
            console.error('Error stopping mixed archive:', error);
        }
    }

    activeUserRecordings.clear();
    activeSpeakingHandlers.clear();
    mixedArchiveRecording = null;
    currentConnection = null;
    currentSessionId = null;
    recState = false;
    
    try {
        const metadataPath = "server/metadata.json";
        if (fs.existsSync(metadataPath)) {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            metadata.recState = false;
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        }
    } catch (error) {
        console.error('Error updating metadata:', error);
    }
    
    return results;
};

module.exports.getRecordingState = function() {
    return {
        isRecording: recState,
        activeUsers: activeUserRecordings.size,
        sessionId: currentSessionId
    };
};