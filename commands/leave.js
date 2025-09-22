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

		const recState = recordings.getRecordingState();
		if (recState.isRecording === true) {
			const metadataPath = "server/metadata.json";
			const metadata = JSON.parse(fs.readFileSync(metadataPath));
			const basepath = metadata.basepath;
			const results = recordings.stopAllRecordings();

			const transcript = 'This is the transcribed text of your recording.'; 
			let recordingLength = 'Unknown';
			try {
				recordingLength = getPcmDuration(`${basepath}/archive/mixed.pcm`);
			} catch (error) {
				console.error('Error getting recording length:', error);
			}
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

					return Promise.all([
						runChild("./utils/gemini.js", "Gemini"),
						runChild("./utils/pcm-to-mp3.js", "Convert")
					]).then(async () => {
						console.log("Both Gemini and Convertion done");
						const channel = interaction.channel;
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
									name: "mixed.txt"
								}
							]
						});
					
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
						fs.rmSync(basepath, { recursive: true, force: true });
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

function getPcmDuration(filePath, sampleRate = 48000, channels = 2, bitDepth = 16) {
    const stats = fs.statSync(filePath);
    const bytesPerSample = bitDepth / 8;
    const frameSize = channels * bytesPerSample;
    const numSamples = stats.size / frameSize;
    const durationSeconds = numSamples / sampleRate;
    return durationSeconds;
}