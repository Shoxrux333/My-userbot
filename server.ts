import express from "express";
import path from "path";
import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

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

async function startBot() {
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
  }

  // Load configuration from DB if available and update process.env BEFORE writing .env
  try {
    const dbConfigResult = await runQueryScript(["get_bot_config"]);
    if (dbConfigResult && dbConfigResult.success && dbConfigResult.config) {
      const cfg = dbConfigResult.config;
      if (cfg.bot_token) process.env.BOT_TOKEN = cfg.bot_token;
      if (cfg.ai_api_key) process.env.AI_API_KEY = cfg.ai_api_key;
      if (cfg.owner_id) process.env.OWNER_ID = cfg.owner_id;
      if (cfg.ai_base_url) process.env.AI_BASE_URL = cfg.ai_base_url;
      if (cfg.ai_model) process.env.AI_MODEL = cfg.ai_model;
      if (cfg.telegram_api_id) process.env.TELEGRAM_API_ID = cfg.telegram_api_id;
      if (cfg.telegram_api_hash) process.env.TELEGRAM_API_HASH = cfg.telegram_api_hash;
      if (cfg.telegram_phone) process.env.TELEGRAM_PHONE = cfg.telegram_phone;
      addBotLog("Bot va AI sozlamalari SQLite bazasidan yuklandi va qo'llanildi.");
    }
  } catch (err: any) {
    addBotLog(`Bazadan sozlamalarni yuklashda xatolik: ${err.message}`);
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
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", botStatus: botProcess ? "running" : "stopped" });
});

app.get("/api/bot-logs", (req, res) => {
  res.json({ logs: botLogs });
});

app.get("/api/bot-status", (req, res) => {
  dotenv.config({ override: true });
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

app.post("/api/bot-config", async (req, res) => {
  dotenv.config({ override: true });
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

    // Save to SQLite database
    try {
      await runQueryScript([
        "save_bot_config",
        process.env.BOT_TOKEN || "",
        process.env.AI_API_KEY || "",
        process.env.OWNER_ID || "",
        process.env.AI_BASE_URL || "https://api.openai.com/v1",
        process.env.AI_MODEL || "gpt-4o-mini",
        process.env.TELEGRAM_API_ID || "",
        process.env.TELEGRAM_API_HASH || "",
        process.env.TELEGRAM_PHONE || ""
      ]);
      addBotLog("Configuration successfully saved to SQLite database for persistent storage.");
    } catch (dbErr: any) {
      addBotLog(`WARNING: Failed to persist config to SQLite: ${dbErr.message}`);
    }

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
  const { api_id, api_hash, phone } = req.body;
  
  // Reload current env first to prevent overwriting other variables
  dotenv.config({ override: true });

  if (api_id !== undefined) process.env.TELEGRAM_API_ID = api_id;
  if (api_hash !== undefined) process.env.TELEGRAM_API_HASH = api_hash;
  if (phone !== undefined) process.env.TELEGRAM_PHONE = phone;

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
    fs.writeFileSync(".env", envContent, "utf8");
    fs.writeFileSync(path.join(process.cwd(), "telegram_ai_bot", ".env"), envContent, "utf8");
    addBotLog("Saved userbot credentials to .env files upon verification code request.");

    // Save to SQLite database
    try {
      await runQueryScript([
        "save_bot_config",
        process.env.BOT_TOKEN || "",
        process.env.AI_API_KEY || "",
        process.env.OWNER_ID || "",
        process.env.AI_BASE_URL || "https://api.openai.com/v1",
        process.env.AI_MODEL || "gpt-4o-mini",
        process.env.TELEGRAM_API_ID || "",
        process.env.TELEGRAM_API_HASH || "",
        process.env.TELEGRAM_PHONE || ""
      ]);
    } catch (dbErr: any) {
      addBotLog(`WARNING: Failed to persist userbot credentials to SQLite: ${dbErr.message}`);
    }
  } catch (err: any) {
    addBotLog(`ERROR saving credentials on send-code: ${err.message}`);
  }

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

// Lazy-loaded Gemini Client helper
function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
  if (!key) {
    throw new Error("Gemini yoki OpenAI API kaliti topilmadi. Iltimos, Sozlamalar -> Secrets panelida yoki bot sozlamalarida kalit kiriting.");
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      }
    }
  });
}

// Endpoint 1: Direct Memory Optimization using AI
app.post("/api/gemini/memory-optimize", async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) {
    return res.status(400).json({ success: false, error: "Matn bo'sh bo'lishi mumkin emas." });
  }

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: `Quyidagi foydalanuvchi yozgan shaxsiy ma'lumot yoki eslatmani tahlil qiling va uni tizimli shaxsiy xotira (memory) ko'rinishida shakllantiring.
Foydalanuvchi matni: "${rawText}"

Javobingizni faqat JSON formatida quyidagi strukturada qaytaring:
{
  "category": "Mavzuga mos toifa, masalan: 'shaxsiy', 'ish', 'soglik', 'reja', 'qiziqishlar' (kichik harflarda, max 1 so'z)",
  "key": "Qisqa va aniq kalit so'z, masalan: 'sevimli taom', 'uyg'onish vaqti' (kichik harflarda)",
  "value": "To'liq, aniq eslab qolinadigan fakt yoki qoida o'zbek tilida"
}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            key: { type: Type.STRING },
            value: { type: Type.STRING }
          },
          required: ["category", "key", "value"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("AI javob bera olmadi.");
    }

    const parsed = JSON.parse(resultText);
    const { category, key, value } = parsed;

    // Save to database using our script runner
    const dbResult = await runQueryScript(["add_memory", category, key, value]);
    res.json({
      success: true,
      category,
      key,
      value,
      dbResult
    });
  } catch (err: any) {
    addBotLog(`ERROR in memory-optimize: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 2: Memory Chat Conversational Agent
app.post("/api/gemini/memory-chat", async (req, res) => {
  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, error: "Xabar bo'sh bo'lishi mumkin emas." });
  }

  try {
    // Fetch current memories to pass as context
    const currentMemories = await runQueryScript(["memories"]);
    const memoriesStr = JSON.stringify(currentMemories?.memories || [], null, 2);

    const ai = getGeminiClient();

    // Format chat history
    const formattedHistory = (history || []).map((h: any) => `${h.role === "user" ? "Foydalanuvchi" : "AI"}: ${h.content}`).join("\n");

    const prompt = `Siz shaxsiy xotiralarni boshqaruvchi aqlli va samimiy AI yordamchisiz (xuddi Claude's memory xususiyati kabi).
Foydalanuvchi siz bilan gaplashib yangi ma'lumotlarni xotiraga qo'shishi, borlarini o'zgartirishi yoki ko'rishi mumkin.

Foydalanuvchining hozirgi xotira bazasi:
${memoriesStr}

Suhbat tarixi:
${formattedHistory}

Foydalanuvchining yangi xabari: "${message}"

Vazifangiz:
1. Foydalanuvchining xabariga samimiy, qisqa va aniq qilingan o'zbek tilida javob bering.
2. Agar foydalanuvchi yangi ma'lumot bergan bo'lsa (yoki biror ma'lumotni eslab qolishni so'rasa), uni xotira bazasiga qo'shish uchun mos category, key va value qiymatlarini aniqlang va "new_memory" maydonida qaytaring.
3. Agar foydalanuvchi faqat gaplashayotgan bo'lsa yoki savol berayotgan bo'lsa, "new_memory" maydonini null qiling.

Javobni faqat JSON formatida qaytaring:
{
  "reply": "Foydalanuvchiga yuboriladigan samimiy javob matni o'zbek tilida.",
  "new_memory": {
    "category": "shaxsiy / ish / soglik / reja va hk.",
    "key": "kalit so'z",
    "value": "eslab qolinadigan fakt yoki eslatma"
  } // yoki null
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            new_memory: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                key: { type: Type.STRING },
                value: { type: Type.STRING }
              },
              required: ["category", "key", "value"]
            }
          },
          required: ["reply"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("AI javob bera olmadi.");
    }

    const parsed = JSON.parse(resultText);
    let dbResult = null;
    if (parsed.new_memory && parsed.new_memory.category && parsed.new_memory.key && parsed.new_memory.value) {
      dbResult = await runQueryScript([
        "add_memory",
        parsed.new_memory.category.toLowerCase(),
        parsed.new_memory.key.toLowerCase(),
        parsed.new_memory.value
      ]);
    }

    res.json({
      success: true,
      reply: parsed.reply,
      newMemory: parsed.new_memory,
      dbResult
    });
  } catch (err: any) {
    addBotLog(`ERROR in memory-chat: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 3: AI-based ID filtering
app.post("/api/gemini/parse-ids", async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) {
    return res.status(400).json({ success: false, error: "Matn kiritilmadi." });
  }

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Siz Telegram ID raqamlarini matndan ajratib beruvchi aqlli yordamchisiz.
Sizga foydalanuvchi turli xil matnlar, guruh xabarlari yoki shunchaki ID ro'yxatini beradi. Sizning vazifangiz ushbu matndan barcha Telegram ID raqamlarini (masalan: 1234567, -10012345678, -456789123 va hk) aniqlash va guruhlashdan iborat.
Agar matnda ularning bloklangan/spam/taqiqlanganligi aytilgan bo'lsa (masalan: "spam", "blokla", "taqiqlanganlar", "blacklist"), ularni blacklisted_ids ro'yxatiga qo'shing.
Agar guruhlarga taalluqliligi aytilgan bo'lsa (masalan: "guruhlar", "ruxsat berilgan", "oq ro'yxat", "whitelist"), ularni whitelisted_group_ids ro'yxatiga qo'shing.
Agar aniq bo'lmasa, ularni unspecified_ids ro'yxatiga qo'ying.

Matn: "${rawText}"

Javobni faqat ushbu JSON formatida qaytaring:
{
  "blacklisted_ids": ["ID_1", "ID_2"],
  "whitelisted_group_ids": ["ID_3", "ID_4"],
  "unspecified_ids": ["ID_5", "ID_6"]
}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            blacklisted_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            whitelisted_group_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            unspecified_ids: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["blacklisted_ids", "whitelisted_group_ids", "unspecified_ids"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("AI tahlil qila olmadi.");
    }

    const parsed = JSON.parse(resultText);
    res.json({ success: true, ...parsed });
  } catch (err: any) {
    addBotLog(`ERROR in parse-ids AI: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
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

app.get("/api/filter-settings", async (req, res) => {
  try {
    const data = await runQueryScript(["get_filter_settings"]);
    if (data && data.success) {
      return res.json({
        blacklist_enabled: data.blacklist_enabled,
        blocked_ids: data.blocked_ids,
        group_filter_enabled: data.group_filter_enabled,
        allowed_group_ids: data.allowed_group_ids
      });
    } else {
      throw new Error((data && data.error) || "Failed to fetch settings from DB");
    }
  } catch (err: any) {
    // Fallback to local file read if query fails
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
  }
});

app.post("/api/filter-settings", async (req, res) => {
  const { blacklist_enabled, blocked_ids, group_filter_enabled, allowed_group_ids } = req.body;
  if (blacklist_enabled === undefined || !Array.isArray(blocked_ids) || group_filter_enabled === undefined || !Array.isArray(allowed_group_ids)) {
    return res.status(400).json({ error: "Noto'g'ri filtr parametrlari" });
  }

  try {
    const bl_enabled_str = blacklist_enabled ? "true" : "false";
    const grp_enabled_str = group_filter_enabled ? "true" : "false";
    const blocked_ids_json = JSON.stringify(blocked_ids);
    const allowed_group_ids_json = JSON.stringify(allowed_group_ids);

    const dbResult = await runQueryScript([
      "save_filter_settings",
      bl_enabled_str,
      blocked_ids_json,
      grp_enabled_str,
      allowed_group_ids_json
    ]);

    if (dbResult && dbResult.success) {
      addBotLog(`Filtr sozlamalari bazada va diskda yangilandi. Taqiq: ${blacklist_enabled ? "YON" : "OCH"} (${blocked_ids.length} ta ID), Guruh: ${group_filter_enabled ? "YON" : "OCH"} (${allowed_group_ids.length} ta guruh)`);
      res.json({ success: true, settings: { blacklist_enabled, blocked_ids, group_filter_enabled, allowed_group_ids } });
    } else {
      throw new Error((dbResult && dbResult.error) || "Failed to save settings to DB");
    }
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
