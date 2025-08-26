const {Client, GatewayIntentBits, Collection} = require("discord.js")
const {Client, GatewayIntentBits, Collection, REST, Routes} = require("discord.js")
const fs = require("fs")
const path = require("path")

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
})

client.commands = new Collection()
const commandPath = path.join(__dirname, "commands")
const commandFiles = fs.readdirSync(commandPath).filter(file => file.endsWith(".js"))

for (const file of commandFiles) {
    const filePath = path.join(commandPath, file)
    const command = require(filePath)
    client.commands.set(command.name, command)
}



client.login(TEMP_KEY)
