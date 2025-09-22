const { Client, GatewayIntentBits, Collection, REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

// Fix SSL certificate issues for corporate networks
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
process.env["HTTPS_PROXY"] = "";
process.env["HTTP_PROXY"] = "";

let TEMP_KEY;
let GUILD_ID;
try {
    const config = JSON.parse(fs.readFileSync("server/config.json"));
    TEMP_KEY = config.API_KEY;
    GUILD_ID = config.GUILD_ID;
} catch (err) {
    console.error("Missing APIs or missing config.json");
}

fs.writeFileSync("server/metadata.json", JSON.stringify({
            basepath: "",
            sessionId: "",
            currentDate: "",
            recState: false,
        }));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
}) 

client.slashCommands = new Collection()

const commandsPath = path.join(__dirname, "commands")
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"))
const commands = []

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
        client.slashCommands.set(command.data.name, command)
        commands.push(command.data.toJSON())
    }
}

client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user.tag}!`)

    const rest = new REST().setToken(TEMP_KEY)

    try {console.log("Refreshing application (/) commands.")
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        )
        console.log("Reloaded application (/) commands.")
    } catch (error) {
        console.error(error)
    }
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isCommand()) return

    const command = client.slashCommands.get(interaction.commandName)
    if (!command) return

    try {
        await command.execute(interaction)
    } catch (error) {
        console.error(error)
        await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true })
    }
})

client.login(TEMP_KEY)
