import express from "express";
import path from "path";
import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Store bot console logs in memory
const botLogs: string[] = [];
const MAX_LOG_LINES = 150;
let botProcess: ChildProcess | null = null;
let isRestarting = false;
let shouldBeRunning = true;
let isInstalling = false;

function addBotLog(message: string) {
  const lines = message.split("\n");
  for (let line of lines) {
    if (line.trim()) {
      // Clean sensitive tokens from being displayed in logs
      let sanitized = line;
      if (process.env.BOT_TOKEN) {
        sanitized = sanitized.replace(new RegExp(process.env.BOT_TOKEN, "g"), "CONFIDENTIAL_BOT_TOKEN");
      }
      if (process.env.AI_API_KEY) {
        sanitized = sanitized.replace(new RegExp(process.env.AI_API_KEY, "g"), "CONFIDENTIAL_AI_KEY");
      }
      botLogs.push(`[${new Date().toLocaleTimeString()}] ${sanitized}`);
    }
  }
  if (botLogs.length > MAX_LOG_LINES) {
    botLogs.splice(0, botLogs.length - MAX_LOG_LINES);
  }
}

function runCommandAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.toString());
      }
    });
  });
}

function initializeDotEnv() {
  const envContent = `BOT_TOKEN=${process.env.BOT_TOKEN || ""}\n` +
                     `TELEGRAM_API_ID=${process.env.TELEGRAM_API_ID || ""}\n` +
                     `TELEGRAM_API_HASH=${process.env.TELEGRAM_API_HASH || ""}\n` +
                     `TELEGRAM_PHONE=${process.env.TELEGRAM_PHONE || ""}\n` +
                     `AI_API_KEY=${process.env.AI_API_KEY || ""}\n` +
                     `AI_BASE_URL=${process.env.AI_BASE_URL || "https://api.openai.com/v1"}\n` +
                     `AI_MODEL=${process.env.AI_MODEL || "gpt-4o-mini"}\n` +
                     `OWNER_ID=${process.env.OWNER_ID || ""}\n` +
                     `MAX_HISTORY_MESSAGES=${process.env.MAX_HISTORY_MESSAGES || "20"}\n`;

  try {
    if (!fs.existsSync(".env")) {
      fs.writeFileSync(".env", envContent, "utf8");
    }
    const botEnvPath = path.join(process.cwd(), "telegram_ai_bot", ".env");
    if (!fs.existsSync(botEnvPath)) {
      fs.writeFileSync(botEnvPath, envContent, "utf8");
    }
    addBotLog("Environment configuration files (.env) auto-initialized from environment.");
  } catch (err: any) {
    addBotLog(`ERROR: Failed to initialize .env files: ${err.message}`);
  }
}

async function ensurePythonSetup(): Promise<boolean> {
  // 1. Quick check if dependencies are already present
  try {
    await runCommandAsync("python3 -c 'import telethon, aiohttp, sqlalchemy, aiosqlite, dotenv, openai'");
    addBotLog("All Python dependencies are already installed. Booting bot...");
    isInstalling = false;
    return true;
  } catch {
    addBotLog("Python dependencies are missing. Starting installation...");
  }

  if (isInstalling) {
    let checkAttempts = 0;
    while (isInstalling && checkAttempts < 30) {
      await new Promise((r) => setTimeout(r, 1000));
      checkAttempts++;
    }
    try {
      await runCommandAsync("python3 -c 'import telethon, aiohttp, sqlalchemy, aiosqlite, dotenv, openai'");
      return true;
    } catch {
      // continue below
    }
  }

  isInstalling = true;
  addBotLog("System initialization: Checking Python and dependencies (asynchronously)...");

  try {
    // 1. Check if python3 is available
    let pythonVersion = "";
    try {
      pythonVersion = (await runCommandAsync("python3 --version")).trim();
      addBotLog(`Found Python: ${pythonVersion}`);
    } catch (err: any) {
      addBotLog(`ERROR: python3 is not available: ${err.message}`);
      isInstalling = false;
      return false;
    }

    // 2. Check if dependencies are already present
    try {
      await runCommandAsync("python3 -c 'import telethon, aiohttp, sqlalchemy, aiosqlite, dotenv, openai'");
      addBotLog("All Python dependencies are already installed. Booting bot...");
      isInstalling = false;
      return true;
    } catch {
      addBotLog("Python dependencies are missing. Starting installation...");
    }

    // 3. Check if pip is installed
    let hasPip = false;
    try {
      const pipVersion = (await runCommandAsync("python3 -m pip --version")).trim();
      addBotLog(`Found pip: ${pipVersion}`);
      hasPip = true;
    } catch (err) {
      addBotLog("pip is not installed. Installing python3-pip...");
    }

    if (!hasPip) {
      try {
        addBotLog("Running apt-get update...");
        await runCommandAsync("apt-get update");
        addBotLog("Installing python3-pip via apt...");
        await runCommandAsync("DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip");
        addBotLog("python3-pip installed successfully.");
      } catch (err: any) {
        addBotLog(`ERROR installing python3-pip: ${err.message}. Trying ensurepip...`);
        try {
          await runCommandAsync("python3 -m ensurepip");
          addBotLog("python3 -m ensurepip succeeded.");
        } catch (err2: any) {
          addBotLog(`ERROR: ensurepip also failed: ${err2.message}`);
        }
      }
    }

    // 4. Install required libraries
    addBotLog("Installing Python requirements via pip (telethon, aiohttp, sqlalchemy, aiosqlite, python-dotenv, openai)...");
    try {
      await runCommandAsync("pip3 install --break-system-packages telethon aiohttp sqlalchemy aiosqlite python-dotenv openai");
      addBotLog("Python packages installed successfully.");
      isInstalling = false;
      return true;
    } catch (err: any) {
      addBotLog(`pip3 install failed: ${err.message}. Retrying without system packages flag...`);
      try {
        await runCommandAsync("pip3 install telethon aiohttp sqlalchemy aiosqlite python-dotenv openai");
        addBotLog("Python packages installed successfully on second try.");
        isInstalling = false;
        return true;
      } catch (err2: any) {
        addBotLog(`ERROR: Python installation failed: ${err2.message}`);
        isInstalling = false;
        return false;
      }
    }
  } catch (globalErr: any) {
    addBotLog(`ERROR: Unexpected error during Python setup: ${globalErr.message}`);
    isInstalling = false;
    return false;
  }
}

async function setupAndStartBot() {
  const success = await ensurePythonSetup();
  if (!success) {
    addBotLog("ERROR: Python environment setup failed. Bot process cannot start.");
    return;
  }

  addBotLog("Starting Python Telegram Bot process (bot.py)...");

  // Determine env variables for child process
  const env = { ...process.env };

  // Spawn Python bot.py inside /telegram_ai_bot directory
  botProcess = spawn("python3", ["bot.py"], {
    cwd: path.join(process.cwd(), "telegram_ai_bot"),
    env: env
  });

  botProcess.stdout?.on("data", (data) => {
    addBotLog(data.toString());
  });

  botProcess.stderr?.on("data", (data) => {
    addBotLog(`ERROR: ${data.toString()}`);
  });

  botProcess.on("close", (code) => {
    addBotLog(`Bot process exited with code ${code}`);
    botProcess = null;
    
    // Auto restart if not manually triggered or restarting
    if (shouldBeRunning && !isRestarting) {
      addBotLog("Bot process stopped unexpectedly. Auto-restarting in 5 seconds...");
      setTimeout(() => {
        if (shouldBeRunning && !botProcess) {
          startBot();
        }
      }, 5000);
    }
  });

  botProcess.on("error", (err) => {
    addBotLog(`Failed to start Bot process: ${err.message}`);
  });
}

function startBot() {
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
  }

  // Write .env files on boot if missing
  initializeDotEnv();

  // Run the background setup check and boot sequence asynchronously
  setupAndStartBot().catch((err) => {
    addBotLog(`CRITICAL ERROR during setupAndStartBot: ${err.message}`);
  });
}

// Initial start of the bot
startBot();

// API routes
app.get("/api/bot-logs", (req, res) => {
  res.json({ logs: botLogs });
});

app.get("/api/bot-status", (req, res) => {
  res.json({
    status: botProcess ? "running" : "stopped",
    shouldBeRunning,
    config: {
      BOT_TOKEN: process.env.BOT_TOKEN || "",
      AI_API_KEY: process.env.AI_API_KEY || "",
      OWNER_ID: process.env.OWNER_ID || "",
      AI_BASE_URL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
      AI_MODEL: process.env.AI_MODEL || "gpt-4o-mini",
      TELEGRAM_API_ID: process.env.TELEGRAM_API_ID || "",
      TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH || "",
      TELEGRAM_PHONE: process.env.TELEGRAM_PHONE || "",
      isTokenSet: !!process.env.BOT_TOKEN,
      isAiKeySet: !!process.env.AI_API_KEY,
      isOwnerSet: !!process.env.OWNER_ID,
      isUserbotSet: !!(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH),
    }
  });
});

app.post("/api/bot-restart", (req, res) => {
  isRestarting = true;
  shouldBeRunning = true;
  addBotLog("Manual restart requested by developer console...");
  startBot();
  setTimeout(() => {
    isRestarting = false;
  }, 1000);
  res.json({ success: true, message: "Bot process restarting." });
});

app.post("/api/bot-stop", (req, res) => {
  shouldBeRunning = false;
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
  }
  addBotLog("Bot process stopped manually from the console.");
  res.json({ success: true });
});

app.post("/api/bot-start", (req, res) => {
  shouldBeRunning = true;
  addBotLog("Bot process start requested from the console.");
  startBot();
  res.json({ success: true });
});

app.post("/api/bot-config", (req, res) => {
  const { BOT_TOKEN, AI_API_KEY, OWNER_ID, AI_BASE_URL, AI_MODEL, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE } = req.body;

  if (BOT_TOKEN !== undefined) process.env.BOT_TOKEN = BOT_TOKEN;
  if (AI_API_KEY !== undefined) process.env.AI_API_KEY = AI_API_KEY;
  if (OWNER_ID !== undefined) process.env.OWNER_ID = OWNER_ID;
  if (AI_BASE_URL !== undefined) process.env.AI_BASE_URL = AI_BASE_URL;
  if (AI_MODEL !== undefined) process.env.AI_MODEL = AI_MODEL;
  if (TELEGRAM_API_ID !== undefined) process.env.TELEGRAM_API_ID = TELEGRAM_API_ID;
  if (TELEGRAM_API_HASH !== undefined) process.env.TELEGRAM_API_HASH = TELEGRAM_API_HASH;
  if (TELEGRAM_PHONE !== undefined) process.env.TELEGRAM_PHONE = TELEGRAM_PHONE;

  const envContent = `BOT_TOKEN=${process.env.BOT_TOKEN || ""}\n` +
                     `TELEGRAM_API_ID=${process.env.TELEGRAM_API_ID || ""}\n` +
                     `TELEGRAM_API_HASH=${process.env.TELEGRAM_API_HASH || ""}\n` +
                     `TELEGRAM_PHONE=${process.env.TELEGRAM_PHONE || ""}\n` +
                     `AI_API_KEY=${process.env.AI_API_KEY || ""}\n` +
                     `AI_BASE_URL=${process.env.AI_BASE_URL || "https://api.openai.com/v1"}\n` +
                     `AI_MODEL=${process.env.AI_MODEL || "gpt-4o-mini"}\n` +
                     `OWNER_ID=${process.env.OWNER_ID || ""}\n` +
                     `MAX_HISTORY_MESSAGES=${process.env.MAX_HISTORY_MESSAGES || "20"}\n`;

  try {
    // Write to both workspace root and telegram_ai_bot subdirectory so both python and node have direct access
    fs.writeFileSync(".env", envContent, "utf8");
    fs.writeFileSync(path.join(process.cwd(), "telegram_ai_bot", ".env"), envContent, "utf8");

    addBotLog("Configuration updated and saved to .env files.");

    if (shouldBeRunning) {
      isRestarting = true;
      startBot();
      setTimeout(() => {
        isRestarting = false;
      }, 1000);
    }
    res.json({ success: true });
  } catch (err: any) {
    addBotLog(`ERROR: Failed to save config: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Proxy endpoints for communicating with python userbot on localhost:8000
app.get("/api/userbot/status", async (req, res) => {
  try {
    const response = await fetch("http://localhost:8000/status");
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.json({ success: false, logged_in: false, error: "Python Userbot server disconnected." });
  }
});

app.post("/api/userbot/send-code", async (req, res) => {
  try {
    const response = await fetch("http://localhost:8000/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: "Python Userbot server is not running or busy." });
  }
});

app.post("/api/userbot/verify-code", async (req, res) => {
  try {
    const response = await fetch("http://localhost:8000/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: "Python Userbot server did not respond." });
  }
});

app.post("/api/userbot/logout", async (req, res) => {
  try {
    const response = await fetch("http://localhost:8000/logout", {
      method: "POST"
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: "Failed to log out from Python userbot." });
  }
});

app.get("/api/system-prompt", (req, res) => {
  const filePath = path.join(process.cwd(), "telegram_ai_bot", "prompts", "system_prompt.txt");
  if (fs.existsSync(filePath)) {
    try {
      const prompt = fs.readFileSync(filePath, "utf8");
      return res.json({ prompt });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.json({ prompt: "" });
});

app.post("/api/system-prompt", (req, res) => {
  const { prompt } = req.body;
  if (prompt === undefined) {
    return res.status(400).json({ error: "Prompt bo'sh bo'lishi mumkin emas." });
  }

  const filePath = path.join(process.cwd(), "telegram_ai_bot", "prompts", "system_prompt.txt");
  try {
    fs.writeFileSync(filePath, prompt, "utf8");
    addBotLog("System Prompt has been updated from the developer console.");
    res.json({ success: true });
  } catch (err: any) {
    addBotLog(`ERROR: Failed to save System Prompt: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/filter-settings", (req, res) => {
  const filterSettingsPath = path.join(process.cwd(), "telegram_ai_bot", "filter_settings.json");
  if (fs.existsSync(filterSettingsPath)) {
    try {
      const data = fs.readFileSync(filterSettingsPath, "utf8");
      const parsed = JSON.parse(data);
      return res.json({
        blacklist_enabled: parsed.blacklist_enabled ?? false,
        blocked_ids: parsed.blocked_ids ?? [],
        group_filter_enabled: parsed.group_filter_enabled ?? false,
        allowed_group_ids: parsed.allowed_group_ids ?? []
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.json({ blacklist_enabled: false, blocked_ids: [], group_filter_enabled: false, allowed_group_ids: [] });
});

app.post("/api/filter-settings", (req, res) => {
  const { blacklist_enabled, blocked_ids, group_filter_enabled, allowed_group_ids } = req.body;
  if (blacklist_enabled === undefined || !Array.isArray(blocked_ids) || group_filter_enabled === undefined || !Array.isArray(allowed_group_ids)) {
    return res.status(400).json({ error: "Noto'g'ri filtr parametrlari" });
  }

  const filterSettingsPath = path.join(process.cwd(), "telegram_ai_bot", "filter_settings.json");
  try {
    const settings = {
      blacklist_enabled,
      blocked_ids,
      group_filter_enabled,
      allowed_group_ids
    };
    fs.writeFileSync(filterSettingsPath, JSON.stringify(settings, null, 2), "utf8");
    addBotLog(`Filtr sozlamalari yangilandi. Taqiq: ${blacklist_enabled ? "YON" : "OCH"} (${blocked_ids.length} ta ID), Guruh: ${group_filter_enabled ? "YON" : "OCH"} (${allowed_group_ids.length} ta guruh)`);
    res.json({ success: true, settings });
  } catch (err: any) {
    addBotLog(`ERROR: Filtr sozlamalarini saqlashda xatolik: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/bot-stats", (req, res) => {
  const statsFilePath = path.join(process.cwd(), "telegram_ai_bot", "stats.json");
  if (fs.existsSync(statsFilePath)) {
    try {
      const data = fs.readFileSync(statsFilePath, "utf8");
      return res.json(JSON.parse(data));
    } catch (e) {
      // Fail silently and return default
    }
  }
  res.json({ users: 0, messages: 0, memory: 0, ai: 0 });
});

// SQLite database helper
function runQueryScript(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [path.join("telegram_ai_bot", "query_db.py"), ...args]);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Exited with code ${code}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err: any) {
        reject(new Error(`Failed to parse stdout: ${err.message}. Raw output: ${stdout}`));
      }
    });
  });
}

// Database APIs
app.get("/api/db/users", async (req, res) => {
  try {
    const data = await runQueryScript(["users"]);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/db/messages/:telegram_user_id", async (req, res) => {
  try {
    const { telegram_user_id } = req.params;
    const data = await runQueryScript(["messages", telegram_user_id]);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/db/memories", async (req, res) => {
  try {
    const data = await runQueryScript(["memories"]);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/db/memories/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await runQueryScript(["delete_memory", id]);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/db/memories/add", async (req, res) => {
  try {
    const { category, key, value } = req.body;
    if (!category || !key || !value) {
      return res.status(400).json({ success: false, error: "Missing required fields (category, key, value)" });
    }
    const data = await runQueryScript(["add_memory", category, key, value]);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Serve frontend assets and listen
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start Express-Vite server:", err);
});
