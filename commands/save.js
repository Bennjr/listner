const { SlashCommandBuilder, ChannelType } = require("discord.js");
const childProcess = require("child_process");
const {joinVoiceChannel} = require("@discordjs/voice")

module.exports = {
    data: new SlashCommandBuilder()
        .setName("save")
        .setDescription("Begin saving process")
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription("Save recording to forum")
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildForum)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        console.log(`Selected channel: ${channel.name}`);

        await interaction.reply("Starting save process...");

        return new Promise((resolve, reject) => {
            const geminiProcess = childProcess.fork("./utils/gemini.js");

            geminiProcess.on('error', async (err) => {
                console.error('Gemini process error:', err);
                await interaction.editReply(`Error: ${err.message}`);
                reject(err); 
            });

            geminiProcess.on('exit', async (code) => {
                if (code === 0) {
                    console.log('Child process "Gemini" done');

                    try {
                        const threadChannel = await channel.threads.create({
                            name: `Summering av Bibelstudie: ${new Date().toLocaleDateString()}`,
                            autoArchiveDuration: 10080,
                            reason: "Automated"
                        });
                        console.log(threadChannel);
                    } catch (error) {
                        console.error(error);
                    }

                    await interaction.editReply(`Save process completed! Saved to ${channel.name}`);
                    resolve();
                } else {
                    console.error(`Gemini process exited with code ${code}`);
                    await interaction.editReply(`Process failed with exit code ${code}`);
                    reject(new Error(`exit code ${code}`));
                }
            });
        });
    }
}
