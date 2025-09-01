const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("server/config.json"));
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API });

async function main() {
    const fileText = fs.readFileSync("server/transcriptions/example/raw/raw.txt", "utf8");
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: fileText
    });
    console.log(response.text);
    fs.writeFileSync("server/transcriptions/example/summerized/summerized.txt", response.text);
}

main();