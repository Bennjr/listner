const { SlashCommandBuilder, ChannelType } = require("discord.js");

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
    }
}
