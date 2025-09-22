const {joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice")
const {SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, ForumChannel} = require("discord.js")
const fs = require("fs");
const recordings = require("./recordManager");
const { spawn } = require('child_process');

function getPcmDuration(filePath) {
    try {
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;
        const sampleRate = 48000;
        const channels = 2;
        const bytesPerSample = 2; // s16le
        const durationInSeconds = fileSizeInBytes / (sampleRate * channels * bytesPerSample);
        return durationInSeconds.toFixed(2);
    } catch (error) {
        console.error(`Error getting PCM duration for ${filePath}:`, error);
        return 'Unknown';
    }
}

function runChild(path, name) {
    return new Promise((resolve, reject) => {
        const process = spawn('node', [path]);

        process.stdout.on('data', (data) => {
            console.log(`[${name}] stdout: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`[${name}] stderr: ${data}`);
        });

        process.on('close', (code) => {
            console.log(`[${name}] child process exited with code ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`[${name}] process exited with code ${code}`));
            }
        });

        process.on('error', (err) => {
            console.error(`[${name}] Failed to start subprocess.`, err);
            reject(err);
        });
    });
}

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
					{ name: 'Recording Length', value: `${recordingLength}s`, inline: true },
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

						let forumChannel = interaction.guild.channels.cache.find(
							ch => ch.name === 'Study' && ch.type === ChannelType.GuildForum
						);

						if (!forumChannel) {
							forumChannel = await interaction.guild.channels.create({
								name: 'bibelstudie',
								type: ChannelType.GuildForum,
								topic: 'Forum for Bibelstudie discussions',
								defaultThreadRateLimitPerUser: 1440,
								reason: 'Automated creation of forum channel for sessions',
							});
							console.log(`Created new forum channel: ${forumChannel.name}`);
						} else {
							console.log(`Using existing forum channel: ${forumChannel.name}`);
						}

						const summaryText = fs.readFileSync(`${basepath}/archive/summerized.txt`, "utf8");
						
						const forumPost = await forumChannel.threads.create({
							name: `Summering av Bibelstudie: ${new Date().toLocaleDateString()}`,
							autoArchiveDuration: 10080,
							reason: "Automated session summary",
							message: {
							  content: summaryText,
							  files: [
								{
								  attachment: `${basepath}/archive/mixed.txt`,
								  name: "mixed.txt"
								}
							  ]
							}
						  });
						console.log(`Sent to forum channel: ${forumChannel.name}`);
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