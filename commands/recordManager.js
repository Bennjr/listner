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
const silenceThreshold = 2000; 
const checkInterval = 500; 

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
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
    const speakingHandler = (userId) => {
        if (!activeUserRecordings.has(userId)) {
            console.log(`New user detected: ${userId}`);
            setupUserRecording(userId, basePath, sessionId);
            setupUserMixedArchive(connection, userId);
            userCurrentlyChunking.set(userId, false);
        }
    
        if (!userCurrentlyChunking.get(userId)) {
            startUserChunking(connection, userId);
        }
    };
    
    connection.receiver.speaking.on("start", (userId) => {
        speakingHandler(userId);
    });

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
    if (!recording) return;

    // Track chunk number
    const chunkCounter = (userChunkCounters.get(userId) || 0) + 1;
    userChunkCounters.set(userId, chunkCounter);

    console.log(`Starting chunk ${chunkCounter} for user ${userId}`);

    const subscription = connection.receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.Never }, // we handle ending manually
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
    userCurrentlyChunking.set(userId, true);

    subscription.on("data", (chunk) => {
        decoder.write(chunk);
        const decoded = decoder.read(chunk);
        if (decoded) output.write(decoded);

        lastChunkTime = Date.now();
        // console.log(`Received chunk for user ${userId}, size: ${chunk.length}`);
    });

    const interval = setInterval(() => {
        if (Date.now() - lastChunkTime > silenceThreshold) {
            console.log(`Silence detected for user ${userId}, closing chunk ${chunkCounter}`);
            clearInterval(interval);
            subscription.destroy();
            decoder.end();
            output.end();

            userCurrentlyChunking.set(userId, false);

            // queue chunk for transcription
            if (!chunkQueues.has(userId)) chunkQueues.set(userId, []);
            const stats = fs.statSync(chunkFile);
            chunkQueues.get(userId).push({
                file: chunkFile,
                counter: chunkCounter,
                size: stats.size,
                duration: Date.now() - lastChunkTime
            });

            // start processing next chunk if any
            processNextChunk(userId);
        }
    }, checkInterval);

    subscription.on("error", (err) => console.error(`Subscription error for user ${userId}:`, err));

    activeSubscriptions.set(userId, { stream: subscription, decoder, output });
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
    if (userProcessing.get(userId)) {
        console.log(`User ${userId} is already processing a chunk`);
        return;
    }
    const queue = chunkQueues.get(userId);
    if (!queue || queue.length === 0) return;

    userProcessing.set(userId, true);

    const chunkData = queue.shift();
    const recording = activeUserRecordings.get(userId);
    if (!recording) {
        userProcessing.set(userId, false);
        return;
    }

    try {
        if (chunkData.size < 50000) {
            fs.unlink(chunkData.file, err => err && console.error(err));
        } else {
            console.log(`Transcribing chunk ${chunkData.counter} for ${recording.username}`);
            await transcribeChunk(chunkData.file, userId, recording.username, currentSessionId, chunkData.counter);
            console.log(`Completed chunk ${chunkData.counter} for ${recording.username}`);
        }
    } catch (err) {
        console.error(`Error transcribing chunk ${chunkData.counter}:`, err);
    } finally {
        userProcessing.set(userId, false);
        if (queue.length > 0) setTimeout(() => processNextChunk(userId), 50);
    }
}

// TRANSSCRIBE CHUNK -----------------------------------------

async function transcribeChunk(chunkFile, userId, username, sessionId, chunkCount) {
    console.log(`[${chunkCount}] Starting transcription for user ${userId}`);
    const { PythonShell } = require("python-shell");

    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const options = {
            scriptPath: "server/scripts",
            args: [chunkFile, userId, username, sessionId],
            pythonOptions: ["-u"],
        };

        console.log(`[${chunkCount}] Creating PythonShell with args:`, options.args);

        const pyshell = new PythonShell("whisper.py", options);
        let allOutput = [];
        let hasResolved = false;

        pyshell.on('message', (message) => {
            console.log(`[${chunkCount}] Python output:`, message);
            allOutput.push(message);
        });

        pyshell.on('stderr', (stderr) => {
            console.log(`[${chunkCount}] Python stderr:`, stderr);
        });

        pyshell.on('error', (error) => {
            console.error(`[${chunkCount}] Python error:`, error);
            if (!hasResolved) {
                hasResolved = true;
                reject(error);
            }
        });

        pyshell.on('close', (code) => {
            const duration = Date.now() - startTime;
            console.log(`[${chunkCount}] Python process closed with code ${code} after ${duration}ms`);
            
            if (hasResolved) return;
            hasResolved = true;

            if (code && code !== 0) {
                reject(new Error(`Python script exited with code ${code}`));
                return;
            }

            if (allOutput.length > 0) {
                try {
                    const lastLine = allOutput[allOutput.length - 1];
                    const parsed = JSON.parse(lastLine);
                    console.log(`[${chunkCount}] Parsed transcription:`, parsed.text);
                    resolve(parsed);
                } catch (parseError) {
                    console.log(`[${chunkCount}] Could not parse JSON, returning raw output`);
                    console.log(`[${chunkCount}] Parse error:`, parseError.message);
                    resolve(allOutput);
                }
            } else {
                console.log(`[${chunkCount}] No output from Python script`);
                resolve(null);
            }
        });

        const timeout = setTimeout(() => {
            if (!hasResolved) {
                console.error(`[${chunkCount}] Python process timeout, terminating...`);
                pyshell.terminate();
                hasResolved = true;
                reject(new Error('Python process timeout'));
            }
        }, 120000);

        pyshell.on('close', () => {
            clearTimeout(timeout);
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