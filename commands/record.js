const { EndBehaviorType, joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { SlashCommandBuilder } = require('@discordjs/builders');
const fs = require('fs');
const prism = require('prism-media');
const { v4: uuidv4 } = require('uuid');

module.exports = {
    data: new SlashCommandBuilder()
        .setName("record")
        .setDescription("Begin recording"),
    async execute(interaction) {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply('You need to be in a voice channel to start recording!');
        }

        let connection = getVoiceConnection(interaction.guild.id);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
            });
        }

        await interaction.reply('Started recording!');

        const currentDate = new Date().toISOString().split('T')[0];
        const folderPath = `server/chunks/audio/${currentDate}`;
        const pcmFolderPath = `${folderPath}/pcm`;
        const wavFolderPath = `${folderPath}/wav`;

        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            fs.mkdirSync(pcmFolderPath, { recursive: true });
            fs.mkdirSync(wavFolderPath, { recursive: true });
        }

        connection.receiver.speaking.on("start", (userId) => {
            const opusStream = connection.receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1000
                }
            });

            const decoder = new prism.opus.Decoder({
                rate: 48000,
                channels: 2,
                frameSize: 960
            });

            const filename = uuidv4();
            const pcmFilePath = `${pcmFolderPath}/${filename}.pcm`;
            const output = fs.createWriteStream(pcmFilePath);
            opusStream.pipe(decoder).pipe(output);

            opusStream.on("end", () => {
                console.log(`Recording ended for ${userId}`);
            });
            
            output.on("finish", async () => {
                const { PythonShell } = require('python-shell');
                const options = {
                    scriptPath: 'server/scripts',
                    args: [pcmFilePath]
                };
                PythonShell.run('whisper.py', options, function(err, results) {
                    if (err) throw err;
                    console.log("Done transcribing");
                });
            });
        });
    },
}
