const { EndBehaviorType, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const prism = require('prism-media');
const { v4: uuidv4 } = require('uuid');

const activeUserRecordings = new Map();
const userMixedStreams = new Map();
const userLastSpoke = new Map(); // Track when users last spoke to prevent duplicates
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
        const sessionId = uuidv4();
        currentSessionId = sessionId;

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

        // Set up mixed archive recording
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

        await interaction.reply(`Started recording, session ID: ${sessionId}`);

        // SINGLE speaking handler that handles everything
        const speakingHandler = (speakingUserId) => {
            const now = Date.now();
            const lastSpokeTime = userLastSpoke.get(speakingUserId) || 0;
            
            // Prevent duplicate chunks with a cooldown period
            if (now - lastSpokeTime < 500) { // 500ms cooldown
                console.log(`Duplicate speaking event for user ${speakingUserId}, ignoring`);
                return;
            }
            
            userLastSpoke.set(speakingUserId, now);

            // Initialize user recording if they're new
            if (!activeUserRecordings.has(speakingUserId)) {
                console.log(`New user detected: ${speakingUserId} - setting up recording`);
                setupUserRecording(connection, speakingUserId, basePath, sessionId);
                setupUserMixedArchive(connection, speakingUserId);
            }

            // Create chunk for this speaking session
            createUserChunk(connection, speakingUserId, sessionId);
        };
        
        connection.receiver.speaking.on("start", speakingHandler);

        connection.on('error', (error) => {
            console.error(`Connection error: ${error.message}`);
        });

        connection.on('disconnect', () => {
            console.log(`Disconnected from voice channel`);
            module.exports.stopAllRecordings();
        });
    }
};

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

    // Set up full recording stream for this user
    const userFullFile = `${fullFolder}/${userId}_complete.pcm`;
    const userFullStream = fs.createWriteStream(userFullFile);

    userFullStream.on("error", (error) => {
        console.error(`Error writing full stream for user ${userId}:`, error);
    });

    // Set up continuous stream for full recording
    const userContinuousStream = connection.receiver.subscribe(userId, {
        end: {
            behaviour: EndBehaviorType.Manual
        }
    });

    const fullDecoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000
    });

    fullDecoder.on("error", (error) => {
        console.error(`Error decoding full stream for user ${userId}:`, error);
    });

    userContinuousStream.on("error", (error) => {
        console.error(`Error receiving continuous stream for user ${userId}:`, error);
    });

    // Pipe continuous stream to full recording
    userContinuousStream.pipe(fullDecoder).pipe(userFullStream, {end: false});

    // Store user recording data
    activeUserRecordings.set(userId, {
        fullStream: userFullStream,
        continuousStream: userContinuousStream,
        fullDecoder: fullDecoder,
        chunksFolder: chunksFolder,
        fullPath: userFullFile,
        startTime: Date.now(),
        chunkCount: 0,
        username: `User_${userId.slice(-4)}`,
        sessionId: sessionId
    });

    console.log(`Set up individual recording for user ${userId}`);
}

function setupUserMixedArchive(connection, userId) {
    if (!mixedArchiveRecording) {
        console.warn(`No mixed archive recording active`);
        return;
    }
    
    try {
        // Create separate stream for mixed archive
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

        // Pipe this user's audio to the mixed archive
        mixedStream.pipe(mixedDecoder).pipe(mixedArchiveRecording.stream, { end: false });
        
        // Store mixed stream reference for cleanup
        userMixedStreams.set(userId, {
            stream: mixedStream,
            decoder: mixedDecoder
        });

        console.log(`Added user ${userId} to mixed archive`);
    } catch (error) {
        console.error(`Error adding user ${userId} to mixed archive:`, error);
    }
}

function createUserChunk(connection, userId, sessionId) {
    const recording = activeUserRecordings.get(userId);
    if (!recording) {
        console.warn(`No recording found for user ${userId}, skipping chunk`);
        return;
    }

    console.log(`Creating chunk ${recording.chunkCount + 1} for user ${userId}`);

    // Create chunk stream for this speaking session
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
        
        console.log(`User ${userId} chunk ${recording.chunkCount} completed: ${chunkDuration}ms`);
        
        // Get file size to help filter noise
        const chunkStats = fs.statSync(chunkFile);
        const chunkSizeBytes = chunkStats.size;
        
        console.log(`Chunk ${recording.chunkCount}: ${chunkDuration}ms, ${chunkSizeBytes} bytes`);
        
        // Filter out chunks that are likely noise
        const shouldDelete = 
            chunkDuration < 750 ||           // Too short (under 0.75 seconds)
            chunkSizeBytes < 50000 ||        // Too small (under ~50KB)
            (chunkDuration < 1500 && chunkSizeBytes < 100000); // Short AND small
            
        if (shouldDelete) {
            console.log(`Filtering out noise chunk: ${chunkDuration}ms, ${chunkSizeBytes} bytes - deleting chunk_${recording.chunkCount}`);
            fs.unlink(chunkFile, (err) => {
                if (err) console.error(`Error deleting noise chunk: ${err}`);
            });
            recording.chunkCount--; // Decrement since we're not keeping this chunk
            return;
        }
        
        console.log(`Keeping chunk ${recording.chunkCount} - likely contains speech`);

        // Double-check recording still exists
        const currentRecording = activeUserRecordings.get(userId);
        if (!currentRecording) {
            console.warn(`Recording for user ${userId} no longer exists, skipping transcription`);
            return;
        }

        try {
            console.log(`Starting transcription for ${currentRecording.username} chunk ${currentRecording.chunkCount}`);
            
            const { PythonShell } = require('python-shell');
            const options = {
                scriptPath: 'server/scripts',
                args: [chunkFile, userId, currentRecording.username, sessionId],
                pythonOptions: ['-u'] 
            };
            
            PythonShell.run('whisper.py', options, function(err, results) {
                if (err) {
                    console.error(`Transcription error for ${currentRecording.username}:`, err);
                } else {
                    console.log(`✓ Transcribed ${currentRecording.username} chunk ${currentRecording.chunkCount}`);
                    if (results && results.length > 0) {
                        console.log(`Result: "${results.join(' ').trim()}"`);
                    }
                }
            });
        } catch (error) {
            console.error(`Error running Python script for user ${userId}:`, error);
        }
    });
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
        // Close user's individual streams
        if (recording.fullStream) {
            recording.fullStream.end();
        }
        
        if (recording.continuousStream) {
            recording.continuousStream.destroy();
        }

        if (recording.fullDecoder) {
            recording.fullDecoder.destroy();
        }

        // Close user's mixed archive streams
        const mixedStreamData = userMixedStreams.get(userId);
        if (mixedStreamData) {
            if (mixedStreamData.stream) {
                mixedStreamData.stream.destroy();
            }
            if (mixedStreamData.decoder) {
                mixedStreamData.decoder.destroy();
            }
            userMixedStreams.delete(userId);
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
        userLastSpoke.delete(userId);
        console.log(`Stopped individual recording for ${recording.username}: ${duration}ms, ${recording.chunkCount} chunks`);
        
        return result;
    } catch (error) {
        console.error(`Error stopping recording for user ${userId}:`, error);
        activeUserRecordings.delete(userId);
        userMixedStreams.delete(userId);
        userLastSpoke.delete(userId);
        return null;
    }
}

module.exports.stopAllRecordings = function() {
    console.log(`Stopping recordings for ${activeUserRecordings.size} users`);
    
    const results = {
        individualRecordings: [],
        mixedArchive: null
    };

    // Stop all individual user recordings
    const userIds = Array.from(activeUserRecordings.keys());
    userIds.forEach(userId => {
        const result = stopIndividualRecording(userId);
        if (result) {
            results.individualRecordings.push(result);
        }
    });

    // Remove all speaking handlers (there's only one now)
    if (currentConnection) {
        currentConnection.receiver.speaking.removeAllListeners("start");
    }

    // Stop mixed archive
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

    // Clean up all state
    activeUserRecordings.clear();
    userMixedStreams.clear();
    userLastSpoke.clear();
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