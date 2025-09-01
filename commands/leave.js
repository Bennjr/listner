const {joinVoiceChannel} = require("@discordjs/voice")
const {SlashCommandBuilder} = require("discord.js")

module.exports = {
	data: new SlashCommandBuilder()
		.setName('leave')
		.setDescription('Leaves specified voice channel'),
	async execute(interaction) {
		const connection = interaction.client.voice?.connections?.get(interaction.guildId);
		if (!connection) {
			return interaction.reply('Not connected to a voice channel!');
		}
		
		connection.destroy();
		await interaction.reply('Left voice channel!');
	},
}