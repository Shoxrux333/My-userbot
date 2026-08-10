import os
from dotenv import load_dotenv

# Load .env file from current directory or parent directory
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
TELEGRAM_API_ID = os.getenv("TELEGRAM_API_ID", "")
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")
TELEGRAM_PHONE = os.getenv("TELEGRAM_PHONE", "")
AI_API_KEY = os.getenv("AI_API_KEY") or os.getenv("GEMINI_API_KEY") or ""
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")

try:
    OWNER_ID = int(os.getenv("OWNER_ID", "0"))
except ValueError:
    OWNER_ID = 0

try:
    MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "20"))
except ValueError:
    MAX_HISTORY_MESSAGES = 20

DB_FILE = "bot.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_FILE}"
