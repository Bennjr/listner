# Base Node.js image
FROM node:22

# Install Python + FFmpeg
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install --upgrade pip
RUN pip3 install faster-whisper numpy

# (Optional GPU support: replace with torch+cu121 if you want CUDA inside Docker)
# RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Set workdir
WORKDIR /app

# Copy package files and install dependencies first (better cache usage)
COPY package*.json ./
RUN npm install

# Copy application source
COPY bot.js ./
COPY commands ./commands
COPY server ./server
COPY utils ./utils

# Start the bot
CMD ["node", "bot.js"]