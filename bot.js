const { Client, GatewayIntentBits, Collection, REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

const TEMP_KEY = JSON.parse(fs.readFileSync("server/config.json")).API_KEY

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
})

client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
})

client.login(TEMP_KEY)
