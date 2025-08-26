module.exports = {
    name: "ping",
    description: "Replies with pong",
    async execute(message) {
        await message.reply("Pong")
    }
}

