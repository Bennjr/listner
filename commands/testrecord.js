// testrecord.js
require("dotenv").config();
const fs = require("fs");
const { SlashCommandBuilder } = require("@discordjs/builders");
const { 
    joinVoiceChannel, 
    getVoiceConnection, 
    EndBehaviorType, 
    VoiceConnectionStatus 
} = require("@discordjs/voice");
const prism = require("prism-media");

// Map to track active chunk timers per user
const userTimers = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName("testrecord")
        .setDescription("Test voice recording with manual silence detection."),
    async execute(interaction) {
        if (!interaction.member.voice.channel) {
            return interaction.reply("You need to be in a voice channel first!");
        }

        const channel = interaction.member.voice.channel;
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: interaction.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            interaction.reply(`Joined voice channel: ${channel.name}`);
            listenToUsers(connection);
        });
    },
};

// Main function to subscribe to user audio and detect silence
function listenToUsers(connection) {
    const receiver = connection.receiver;

    connection.on("stateChange", (oldState, newState) => {
        console.log(`Connection state changed from ${oldState.status} to ${newState.status}`);
    });

    connection.on("error", console.error);

    connection.receiver.speaking.on("start", async (userId) => {
        console.log(`User started speaking: ${userId}`);

        if (userTimers.has(userId)) return; // Already recording this user

        const opusStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.Manual,
            },
        });

        const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
        const chunkFile = `chunks/${userId}_${Date.now()}.pcm`;
        const output = fs.createWriteStream(chunkFile);
        opusStream.pipe(decoder).pipe(output);

        let lastChunkTime = Date.now();

        decoder.on("data", (chunk) => {
            lastChunkTime = Date.now();
        });

        // Manual silence detection timer
        const interval = setInterval(() => {
            if (Date.now() - lastChunkTime > 2000) { // 2 seconds of silence
                console.log(`Silence detected for user ${userId}, ending chunk.`);
                clearInterval(interval);
                opusStream.destroy();
                decoder.end();
                output.end();
                userTimers.delete(userId);
                console.log(`Chunk saved: ${chunkFile}`);
            }
        }, 500);

        userTimers.set(userId, interval);

        opusStream.on("error", console.error);
        decoder.on("error", console.error);
        output.on("error", console.error);
    });
}
