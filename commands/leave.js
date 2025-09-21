const {joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice")
const {SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder} = require("discord.js")
const fs = require("fs");
const recordings = require("./recordManager");

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

		const recState = recordings.getRecordingState();

		if (recState.isRecording === true) {
			const results = recordings.stopAllRecordings();
			await interaction.reply(`Stopped recording. Processed ${results.individualRecordings.length} individual recordings.`);

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

					const metadata = JSON.parse(fs.readFileSync("server/metadata.json"));
					const basepath = metadata.basepath;

					await interaction.reply("Starting save process...");

					return Promise.all([
						runChild("./utils/gemini.js", "Gemini"),
						runChild("./utils/pcm-to-mp3.js", "Convert")
					]).then(async () => {
						console.log("Both Gemini and Convertion done");
					
						const threadChannel = await channel.threads.create({
							name: `Summering av Bibelstudie: ${new Date().toLocaleDateString()}`,
							autoArchiveDuration: 10080,
							reason: "Automated"
						});

						const textContent = fs.readFileSync(`${basepath}/archive/mixed.txt`, "utf8");
						await threadChannel.send({
							content: textContent,
							files: [
								{
									attachment: `${basepath}/archive/summerized.txt`,
									name: "summerized.txt"
								},
								{
									attachment: `${basepath}/archive/mixed.txt`,
									name: "mixed.mp3"
								}
							]
						})
					
						await interaction.editReply(`Save process completed! Saved to ${channel.name}`);
						collector.stop();
					}).catch(async (err) => {
						console.error("Process error:", err);
						await interaction.editReply(`Error: ${err.message}`);
						throw err;
					});
				} else if (i.customId === 'discard') {
					await i.update({ content: 'Transcript discarded.', components: [] });
					// DELETE FILES
					
					const metadata = JSON.parse(fs.readFileSync("server/metadata.json"));
					const basepath = metadata.basepath;


					if (fs.existsSync(basepath)) {
						fs.rmdirSync(basepath, { recursive: true });
					}
					collector.stop();
				}
			});

			collector.on('end', collected => {
				if (collected.size === 0) {
					interaction.editReply({ content: 'No action taken. Collector timed out.', components: [] });
				}
			});
		}
	}
}