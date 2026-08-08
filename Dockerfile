# Use Node.js as the base image
FROM node:20-slim

# Install system dependencies (Python 3, pip, venv, and sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Set Environment variables to avoid pip PEP 668 warnings inside Docker
ENV PIP_BREAK_SYSTEM_PACKAGES=1
ENV PORT=3000
ENV NODE_ENV=production

# Create app directory
WORKDIR /app

# Install Node.js dependencies first (for better caching)
COPY package*.json ./
RUN npm install

# Copy Python requirements file and pre-install Python packages
COPY telegram_ai_bot/requirements.txt ./telegram_ai_bot/
RUN pip3 install --no-cache-dir -r ./telegram_ai_bot/requirements.txt \
    && pip3 install --no-cache-dir telethon aiohttp sqlalchemy aiosqlite python-dotenv openai pydantic

# Copy the rest of the application files
COPY . .

# Build the frontend assets and bundle the server
RUN npm run build

# Expose the application port
EXPOSE 3000

# Start the application using the precompiled server bundle
CMD ["npm", "start"]
