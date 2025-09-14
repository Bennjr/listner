const fs = require("fs");
const lamejs = require("lamejs");

async function convert() {

    const metadata = JSON.parse(fs.readFileSync("server/metadata.json"));
    const basepath = metadata.basepath;

    const pcmPath = `${basepath}/archive/mixed.pcm`;
    const mp3Path = `${basepath}/archive/mixed.mp3`;

    const pcmBuffer = fs.readFileSync(pcmPath);
    const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.byteLength / 2);

    const mp3Encoder = new lamejs.Mp3Encoder(2, 48000, 128);
    let mp3Data = [];

    let mp3buf = mp3Encoder.encodeBuffer(samples);
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    mp3buf = mp3Encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    fs.writeFileSync(mp3Path, Buffer.concat(mp3Data));
    console.log(`Converted ${pcmPath} to ${mp3Path}`);
}
