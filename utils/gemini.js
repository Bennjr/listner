const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("server/config.json"));
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API });

const metadata = JSON.parse(fs.readFileSync("server/metadata.json"));
const basepath = metadata.basepath;


async function main() {
    const fileText = fs.readFileSync(`${basepath}/archive/mixed.txt`, "utf8");
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Oppsummer følgende innhold på norsk: ${fileText}`
    });
    console.log(response.text);
    fs.writeFileSync(`${basepath}/archive/summerized.txt`, response.text);
}

main();