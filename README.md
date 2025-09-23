-- 🔗 PRESTEPS 🔗--

**Invite the bot to your server with the correct scopes:**
You will have to make your own bot and invite it to your server with the correct scopes.

Firstly go to https://discord.com/developers/applications
Click **new application**
Give it a **name**
Go to **Installation**
Sctroll down to **Guild install**
Select: Attach files, Connect, Create Private threads, Create Public Threads,
Embed links, Manage channels, Manage threads, Read Message History
Send messages, Send Messages in Threads, View channels
**Invite** to your server

Scopes:
1387420143302217748

-- 📦 Without Docker 📦--

**Install dependencies:**
Node.js 22+
Python 3.9+
FFmpeg (must be in PATH)
pip install faster-whisper

-- 🐳 With Docker 🐳--

**Build the docker image:**
docker build -t listner .

**Optional:**
For docker gpu support:
uncomment the line in .dockerfile

**Run the docker container:**
docker run -it listner

-- ⚙️ Configuration ⚙️ --

**Edit the config-headless.json to match your setup:**

{
"API_KEY": "Your api key",
"GUILD_ID": "Your guild id",
"GEMINI_API": "Your gemini api key"
}
