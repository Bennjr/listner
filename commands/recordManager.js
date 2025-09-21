const {
  EndBehaviorType,
  joinVoiceChannel,
  SpeakingMap,
} = require("@discordjs/voice");
const { SlashCommandBuilder } = require("@discordjs/builders");
const fs = require("fs");
const prism = require("prism-media");
const { v4: uuidv4 } = require("uuid");

const chunkQueue = new Map();
const userProcessing = new Map();
const activeUserRecordings = new Map();
const userChunkCounters = new Map(); 
const chunkQueues = new Map();
const activeSubscriptions = new Map();
const userCurrentlyChunking = new Map();
const debounceTimer = new Map();
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
      return await interaction.reply(
        "You need to be in a voice channel to start recording!"
      );
    }

    if (recState) {
      return await interaction.reply("Recording is already active!");
    }

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });

    // SETUP ALL VARIABLES -----------------------------------
    currentConnection = connection;
    recState = true;
    const currentDate = new Date().toISOString().split("T")[0];
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

        const foldersToCreate = [`${basePath}/users`, `${basePath}/archive`];
        foldersToCreate.forEach(folder => {
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder, { recursive: true });
            }
        });

        setupMixedArchive(basePath);
    } catch (error) {
        console.error('Setup error:', error);
        return await interaction.reply('Error setting up recording!');
    }

    await interaction.reply(`Started recording, session ID: ${sessionId}`);

    // SPEAKING HANDLER --------------------------------------
    const speakingHandler = (speakingUserId) => {
        const debounceTimeout = 1000;
        const timeoutId = debounceTimer.get(speakingUserId);
        console.log(`User ${speakingUserId} speaking [timer: ${debounceTimeout}ms]`);

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        const timeout = setTimeout(() => {
            debounceTimer.delete(speakingUserId);

            if (!activeUserRecordings.has(speakingUserId)) {
                console.log(`New user detected: ${speakingUserId}`);
                setupUserRecording(speakingUserId, basePath, sessionId);
                setupUserMixedArchive(connection, speakingUserId);
                userCurrentlyChunking.set(speakingUserId, false);
            }

            startUserChunking(connection, speakingUserId);
            //testChunking(connection, speakingUserId);
        }, debounceTimeout);

        debounceTimer.set(speakingUserId, timeout);
    };
    
    connection.receiver.speaking.on("start", (userId) => {
        speakingHandler(userId);
    });

    connection.receiver.speaking.on("end", () => {});

    //HANDLE CONNECTION ERRORS ---------------------------------
    console.log(`Succesfully setup mixed archive for session ${sessionId}`);

    connection.on('error', (error) => {
        console.error(`Connection error: ${error.message}`);
    });

    connection.on('disconnect', () => {
        console.log(`Disconnected from voice channel`);
        module.exports.stopAllRecordings();
    });
  },
};

// SETUP USER RECORDING -------------------------------------------
function setupUserRecording(userId, basePath, sessionId) {
  const userFolder = `${basePath}/users/${userId}`;
  const chunksFolder = `${userFolder}/chunks`;
  const fullFolder = `${userFolder}/full`;

  try {
    [userFolder, chunksFolder, fullFolder].forEach((folder) => {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }
    });
  } catch (error) {
    console.error(`Error creating folders for user ${userId}:`, error);
    return;
  }

  activeUserRecordings.set(userId, {
    chunksFolder: chunksFolder,
    startTime: Date.now(),
    username: `User_${userId.slice(-4)}`,
    sessionId: sessionId
    });

    chunkQueue.set(userId, []);
    userProcessing.set(userId, false);
    userChunkCounters.set(userId, 0);

    console.log(`Setup user recording for ${userId}`);
}

// START USER CHUNKING --------------------------------------------
function startUserChunking(connection, userId) {
    const recording = activeUserRecordings.get(userId);
    if (!recording) {
        console.warn(`No recording found for user ${userId}`);
        return;
    }

    // Clean up previous subscription to prevent memory leaks
    if (activeSubscriptions.has(userId)) {
        const prevSub = activeSubscriptions.get(userId);
        console.log(`Cleaning up previous subscription for user ${userId}`);
        prevSub.stream?.destroy();
        prevSub.decoder?.destroy();
        prevSub.output?.destroy();
        activeSubscriptions.delete(userId);
    }

    let chunkCounter = (userChunkCounters.get(userId) || 0) + 1;
    userChunkCounters.set(userId, chunkCounter);

    console.log(`Starting chunk ${chunkCounter} for user ${userId}`);

    const subscription = connection.receiver.subscribe(userId, {
        end: {
            behavior: EndBehaviorType.Manual,
        },
    });

    const decoder = new prism.opus.Decoder({
        frameSize: 960,
        channels: 2,
        rate: 48000,
    });

    const chunksFolder = recording.chunksFolder;
    const chunkFile = `${chunksFolder}/${userId}_chunk_${chunkCounter}_${Date.now()}.pcm`;
    const output = fs.createWriteStream(chunkFile);

    let lastChunkTime = Date.now();
    let silenceTimer = null;

    subscription.on("data", (chunk) => {
        decoder.write(chunk);
        output.write(decoder.read(chunk));
        console.log(`Received chunk for user ${userId}, size: ${chunk.length}`);
        lastChunkTime = Date.now();

        // Reset silence timer if audio comes back before cutoff
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
    });

    function closeChunk() {
        console.log(`Silence detected for user ${userId}, closing chunk ${chunkCounter}`);

        output.end();
        subscription.destroy();
        decoder.end();

        try {
            if (!chunkQueues.has(userId)) chunkQueues.set(userId, []);
            const stats = fs.statSync(chunkFile);
            chunkQueues.get(userId).push({
                file: chunkFile,
                counter: chunkCounter,
                size: stats.size,
                duration: Date.now() - lastChunkTime,
            });

            activeSubscriptions.delete(userId);
        } catch (err) {
            console.error(`Error finalizing chunk for user ${userId}:`, err);
        }

        processNextChunk(userId);
    }

    const silenceInterval = setInterval(() => {
        if (Date.now() - lastChunkTime > 2000 && !silenceTimer) {
            silenceTimer = setTimeout(closeChunk, 100); // finalize after confirming silence
        }
    }, 500);

    subscription.on("error", (error) => {
        console.error(`Error in chunk stream for user ${userId}:`, error);
    });

    output.on("finish", () => {
        clearInterval(silenceInterval);
        console.log(`Chunk ${chunkCounter} FINISHED for user ${userId}`);
    });

    activeSubscriptions.set(userId, {
        stream: subscription,
        decoder: decoder,
        output: output,
    });
}

function stopUserChunking(userId) {
    const sub = activeSubscriptions.get(userId);
    if (!sub) {
        console.log(`No active subscription to stop for user ${userId}`);
        return;
    }

    console.log(`Manually stopping chunk stream for user ${userId}`);
    sub.stream?.destroy();
    sub.decoder?.destroy();
    sub.output?.end();  // flush remaining writes
    activeSubscriptions.delete(userId);
    userCurrentlyChunking.set(userId, false);
}

// ASYNC FUNCTION TO PROCESS NEXT CHUNK IN QUEUE ------------
async function processNextChunk(userId) {
    console.log(`Processing next chunk for user ${userId}`);
    if (userProcessing.get(userId)) {
        console.log(`User ${userId} already processing, queuing chunk`);
        return;
    }
    
    const queue = chunkQueues.get(userId);
    console.log(`Chunk queue length for user ${userId}: ${queue?.length ?? 0}`);
    if (!queue || queue.length === 0) return;

    userProcessing.set(userId, true);

    const chunkData = queue.shift();
    const recording = activeUserRecordings.get(userId);
    
    if (!recording) {
        console.warn(`No recording found for user ${userId}, skipping chunk processing`);
        userProcessing.set(userId, false);
        return;
    }

    try {
        console.log(`Processing chunk ${chunkData.counter} for ${recording.username} (queue: ${queue.length} remaining)`);
    
        if (chunkData.size < 50000) {
            console.warn(`Chunk size too small (${chunkData.size} bytes), skipping transcription`);
            userProcessing.set(userId, false);
            fs.unlink(chunkData.file, (err) => {
                if (err) console.error(`Error deleting noise chunk: ${err}`);
            });
            return;
        }
        
        await transcribeChunk(chunkData.file, userId, recording.username, currentSessionId, chunkData.counter);
        
        console.log(`Completed chunk ${chunkData.counter} for ${recording.username}`);
    } catch (err) {
        console.error(`Error transcribing chunk ${chunkData.counter} for user ${userId}:`, err);
    } finally {
        userProcessing.set(userId, false);
        if (queue.length > 0) {
            setTimeout(() => processNextChunk(userId), 100); 
        }
    }
}

// TRANSSCRIBE CHUNK -----------------------------------------
async function transcribeChunk(chunkFile, userId, username, sessionId, chunkCount) {
    console.log(`Transcribing chunk for user ${userId}`);
    const { PythonShell } = require("python-shell");

    return new Promise((resolve, reject) => {
        const options = {
            scriptPath: "server/scripts",
            args: [chunkFile, userId, username, sessionId],
            pythonOptions: ["-u"],
        };

        PythonShell.run("whisper.py", options, (err, results) => {
            if (err) {
                console.error(`Transcription error for ${username}:`, err);
                reject(err);
            } else {
                console.log(`Transcribed ${username} chunk ${chunkCount}`);
                if (results && results.length > 0) {
                    console.log(`Result: "${results.join(" ").trim()}"`);
                }
                resolve(results);
            }
        });
    });
}


// SETUP MIXED ARCHIVE ---------------------------------------
function setupMixedArchive(basePath) {
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

    console.log('Mixed archive recording started');
}

// MIXED RECORDER ---------------------------------------------
function setupUserMixedArchive(connection, userId) {
    if (!mixedArchiveRecording) {
        console.warn('No mixed archive recording active');
        return;
    }
    try {
        const mixedStream = connection.receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.Manual,
            },
          });
        
          const mixedDecoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: 48000,
          });
        
          mixedStream.on("error", (error) => {
            console.error(`Mixed stream error for user ${userId}:`, error);
          });
        
          mixedDecoder.on("error", (error) => {
            console.error(`Mixed decoder error for user ${userId}:`, error);
          });
        
          mixedStream.pipe(mixedDecoder).pipe(mixedArchiveRecording.stream, { end: false });    
    } catch (error) {
        console.error(`Error setting up mixed archive for user ${userId}:`, error);
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

module.exports.stopAllRecordings = function () {
    console.log(`Stopping recordings for ${activeUserRecordings.size} users`);
    
    const results = {
        individualRecordings: [],
        mixedArchive: null
    };

    // Stop individual recordings
    activeSubscriptions.forEach((sub, userId) => {
        console.log(`Stopping active chunk for user ${userId}`);
        sub.silenceTimer && clearTimeout(sub.silenceTimer);
        sub.silenceInterval && clearInterval(sub.silenceInterval);
        sub.stream?.destroy();
        sub.decoder?.destroy();
        sub.output?.end();
    });
    activeSubscriptions.clear();
    userCurrentlyChunking.forEach((val, userId) => userCurrentlyChunking.set(userId, false));

    activeUserRecordings.forEach((recording, userId) => {
        const chunkCount = userChunkCounters.get(userId) || 0;
        const duration = Date.now() - recording.startTime;

        results.individualRecordings.push({
            userId,
            username: recording.username,
            duration,
            chunks: chunkCount,
            sessionId: recording.sessionId
        });

        console.log(`Stopped chunking for ${recording.username}: ${duration}ms, ${chunkCount} chunks`);
    });

    if (mixedArchiveRecording) {
        mixedArchiveRecording.stream.end();
        results.mixedArchive = {
            filePath: mixedArchiveRecording.filePath,
            duration: Date.now() - mixedArchiveRecording.startTime
        };
        console.log(`Stopped mixed archive: ${results.mixedArchive.duration}ms`);
    }

    if (currentConnection) {
        currentConnection.receiver.speaking.removeAllListeners("start");
    }

    activeUserRecordings.clear();
    chunkQueues.clear();
    userProcessing.clear();
    userChunkCounters.clear();
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
    const queueStatus = {};
    chunkQueues.forEach((queue, userId) => {
        queueStatus[userId] = {
            queued: queue.length,
            processing: userProcessing.get(userId) || false
        };
    });
    
    return {
        isRecording: recState,
        activeUsers: activeUserRecordings.size,
        sessionId: currentSessionId,
        queueStatus: queueStatus
    };
};