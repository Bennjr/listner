const {joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice")
const {SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require("discord.js")

module.exports = {
	data: new SlashCommandBuilder()
		.setName('leave')
		.setDescription('Leaves voice channel'),
	async execute(interaction) {
		const connection = getVoiceConnection(interaction.guild.id);
		if (!connection) {
			return await interaction.reply('The bot is not in a voice channel');
		}
		connection.destroy();

		if (isRecordingActive) {
			console.log(`Recording is active, stopping it before leaving voice channel`);
			await module.exports.stopAllRecordings();

			const transcript = 'This is the transcribed text of your recording.'; 
			const recordingLength = '1:45';
			const fileName = 'mixed.mp3';
		
			const embed = new EmbedBuilder()
				.setTitle('Transcription Ready')
				.setDescription(transcript)
				.setColor(0x1abc9c)
				.addFields(
					{ name: 'Recording Length', value: recordingLength, inline: true },
					{ name: 'File Name', value: fileName, inline: true },
					{ name: 'Date', value: new Date().toLocaleString(), inline: false }
				)
				.setFooter({ text: 'Click a button below to save or discard' });

		const row = new ActionRowBuilder()
			.addComponents(
				new ButtonBuilder()
					.setCustomId('save')
					.setLabel('Save')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId('discard')
					.setLabel('Discard')
					.setStyle(ButtonStyle.Danger)
				);

			await interaction.reply({ embeds: [embed], components: [row] });

			const filter = i => ['save', 'discard'].includes(i.customId) && i.user.id === interaction.user.id;
			const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

			collector.on('collect', async i => {
				if (i.customId === 'save') {
					await i.update({ content: 'Transcript saved!', components: [] });
					// logic here
				} else if (i.customId === 'discard') {
					await i.update({ content: 'Transcript discarded.', components: [] });
					// logic here
				}
				collector.stop();
			});

			collector.on('end', collected => {
				if (collected.size === 0) {
					interaction.editReply({ content: 'No action taken. Collector timed out.', components: [] });
			}
		});
	}
	}
}