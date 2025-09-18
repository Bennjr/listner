const { EndBehaviorType, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const prism = require('prism-media');
const { v4: uuidv4 } = require('uuid');

const chunkQueue = new Map();
const userProcessing = new Map();
let mixedArchiveRecording = null; 
let recState = false;
let currentConnection = null;
let currentSessionId = null;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("record")
        .setDescription("Recording both individual and mixed archive"),
    async execute(interaction) {
        // BASIC CHECKS ------------------------------------------
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply('You need to be in a voice channel to start recording!');
        }

        if (recState) {
            return await interaction.reply('Recording is already active!');
        }

        // SETUP ALL VARIABLES -----------------------------------
        currentConnection = connection;
        recState = true;
        const currentDate = new Date().toISOString().split('T')[0];
        const sessionId = uuidv4();
        currentSessionId = sessionId;

        // SETUP FOLDERS -----------------------------------------
        const basePath = `server/recs/${currentDate}/${sessionId}`;

        try {
            fs.writeFileSync("server/metadata.json", JSON.stringify({
                basepath: basePath,
                sessionId: sessionId,
                currentDate: currentDate,
                recState: recState,
            }, null, 2));
        } catch (error) {
            console.error('Error writing metadata:', error);
            return await interaction.reply('Error writing metadata file!');
        }

        const foldersToCreate = [
            `${basePath}/users`,
            `${basePath}/archive`,
        ];
        
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

        // SETUP MIXED ARCHIVE -----------------------------------
        const mixedArchiveFile = `${basePath}/archive/mixed.pcm`;
        const mixedArchiveStream = fs.createWriteStream(mixedArchiveFile);
        
        mixedArchiveStream.on('error', (error) => {
            console.error('Mixed archive stream error:', error);
        });
        
        mixedArchiveRecording = {
            stream: mixedArchiveStream,
            filePath: mixedArchiveFile,
            startTime: Date.now()
        };
        
        console.log(`Succesfully setup mixed archive for session ${sessionId}`);
    }
};

// SETUP USER RECORDING -------------------------------------------
function setupUserRecording(connection, userId, basePath, sessionId) {
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
}

// START USER CHUNKING --------------------------------------------
function startUserChunking(userId, username, sessionId) {
    const chunkStream = connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.AfterSilence,
            duration: 500
        }
    });

    const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
    });

    const chunkFile = `${chunksFolder}/${userId}_chunk_${Date.now()}.pcm`;
    const output = fs.createWriteStream(chunkFile);

    chunkStream.pipe(decoder).pipe(output);

    output.on('finish', () => {
        if (!chunkQueue.has(userId)) chunkQueue.set(userId, []);
        chunkQueue.get(userId).push(chunkFile);

        processNextChunk(userId); 
    });
}

// ASYNC FUNCTION TO PROCESS NEXT CHUNK IN QUEUE ------------
async function processNextChunk(userId) {
    if (userProcessing.get(userId)) return; 
    const queue = chunkQueue.get(userId);
    if (!queue || queue.length === 0) return;

    userProcessing.set(userId, true);

    const chunkFile = queue.shift();
    try {
        if (fs.statSync(chunkFile).size < 48000) {
            return;
        }
        await transcribeChunk(chunkFile, userId);
    } catch (err) {
        console.error(`Error transcribing chunk for ${userId}:`, err);
    } finally {
        userProcessing.set(userId, false);
        processNextChunk(userId); 
    }
}

function startMixedRecorder(userId, username, sessionId) {
    console.log(`Starting mixed recorder`);
}

module.exports.stopAllRecordings = function() {
    console.log(`Stopping all recordings`);
};
