const fs = require("fs");

const config = JSON.parse(fs.readFileSync("server/config.json"));

try {
    if (fs.existsSync(config.basepath)) {
        fs.rmSync(config.basepath, { recursive: true, force: true });
    }
    fs.writeFileSync("server/config.json", JSON.stringify({
        "API_KEY": "",
        "GUILD_ID": "",
        "GEMINI_API": ""
    }));
    console.log("Data cleared successfully.");
} catch (err) {
    console.error("Error clearing data:", err);
}