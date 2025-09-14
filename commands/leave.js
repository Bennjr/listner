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