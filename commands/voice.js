const {joinVoiceChannel} = require("@discordjs/voice")
const {SlashCommandBuilder, ChannelType} = require("discord.js")

module.exports = {
	data: new SlashCommandBuilder()
		.setName('join')
		.setDescription('Joins specified voice channel')
		.addChannelOption(option =>
			option.setName('channel')
				.setDescription('The voice channel to join')
				.setRequired(true)
				.addChannelTypes(ChannelType.GuildVoice)),
	async execute(interaction) {
		const channel = interaction.options.getChannel('channel');
		
		if (!channel || channel.type !== ChannelType.GuildVoice) {
			return await interaction.reply({ content: 'Please select a valid voice channel!', ephemeral: true });
		}
		
		try {
			const connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: interaction.guild.id,
				adapterCreator: interaction.guild.voiceAdapterCreator
			});
			
			await interaction.reply({ content: `Joined ${channel.name}!`, ephemeral: true });
		} catch (error) {
			console.error(error);
			await interaction.reply({ content: 'There was an error joining the voice channel!', ephemeral: true });
		}
	},
};