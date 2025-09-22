const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

async function convert() {
    try {
        const metadata = JSON.parse(fs.readFileSync("server/metadata.json"));
        const basepath = metadata.basepath;
        const pcmPath = `${basepath}/archive/mixed.pcm`;
        const mp3Path = `${basepath}/archive/mixed.mp3`;

        console.log("Converting PCM to MP3...");

        if (!fs.existsSync(pcmPath)) {
            throw new Error(`PCM file not found: ${pcmPath}`);
        }

        const ffmpegCmd = [
            'ffmpeg',
            '-y',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
            '-i', `"${pcmPath}"`,
            '-codec:a', 'libmp3lame',
            '-b:a', '128k',
            '-loglevel', 'error',
            `"${mp3Path}"`
        ].join(' ');

        console.log(`Running: ${ffmpegCmd}`);

        const { stdout, stderr } = await execAsync(ffmpegCmd);
        
        if (stderr && !stderr.includes('size=')) {
            console.warn('FFmpeg warnings:', stderr);
        }

        if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0) {
            const inputSize = fs.statSync(pcmPath).size;
            const outputSize = fs.statSync(mp3Path).size;
            console.log(`Successfully converted ${pcmPath} to ${mp3Path}`);
            console.log(`Input size: ${inputSize} bytes, Output size: ${outputSize} bytes`);
        } else {
            throw new Error('Conversion failed: Output file is empty or does not exist');
        }

    } catch (error) {
        console.error('Conversion error:', error.message);
        if (error.stderr) {
            console.error('FFmpeg error:', error.stderr);
        }
    }
}

convert();
