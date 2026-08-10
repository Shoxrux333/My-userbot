import asyncio
import logging
import sys
import os
import json
from collections import deque
from aiohttp import web
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE, OWNER_ID
from database.database import init_db, AsyncSessionLocal
from database.repositories import MemoryRepository
from services.ai import generate_response
from services.memory import MemoryService
from prompts.system_prompt import get_system_prompt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# ── Globals ──
client = None
phone_code_hash_cache = {}
pending_credentials = {}
userbot_active = False

# ── Lightweight in-memory context: max 4 messages per user ──
# Format: {user_id: deque(maxlen=4) of {"role": "user"|"assistant", "content": str}}
_user_contexts: dict[int, deque] = {}
MAX_CONTEXT = 4

# ── User ID blacklist (loaded from filter_settings.json) ──
_blocked_ids: set[int] = set()
_filter_mtime: float = 0.0
FILTER_SETTINGS_PATH = os.path.join(os.path.dirname(__file__), "filter_settings.json")


def _load_blocked_ids():
    """Load blocked user IDs from filter_settings.json (no DB, no API calls)."""
    global _blocked_ids, _filter_mtime
    try:
        if not os.path.exists(FILTER_SETTINGS_PATH):
            _blocked_ids = set()
            return
        mtime = os.path.getmtime(FILTER_SETTINGS_PATH)
        if mtime == _filter_mtime:
            return  # No change
        _filter_mtime = mtime
        with open(FILTER_SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        ids = data.get("blocked_ids", [])
        _blocked_ids = set()
        for x in ids:
            try:
                _blocked_ids.add(int(str(x).strip()))
            except (ValueError, TypeError):
                pass
        if _blocked_ids:
            logger.info(f"Blacklist yangilandi: {_blocked_ids}")
    except Exception as e:
        logger.error(f"Filter sozlamalarini o'qishda xato: {e}")


def _get_context(user_id: int) -> deque:
    """Get or create in-memory context deque for a user."""
    if user_id not in _user_contexts:
        _user_contexts[user_id] = deque(maxlen=MAX_CONTEXT)
    return _user_contexts[user_id]


def _get_owner_id(client_inst) -> int:
    """Get owner ID: from config or auto-detect from session (cached)."""
    if OWNER_ID and OWNER_ID != 0:
        return OWNER_ID
    try:
        me = client_inst._self_cached
        if me:
            return me.id
    except Exception:
        pass
    return 0


async def seed_initial_memories():
    """Seed initial memories if DB is empty."""
    try:
        async with AsyncSessionLocal() as session:
            memories = await MemoryRepository.get_all_memories(session)
            if not memories:
                logger.info("Xotiralar bazasi bo'sh. Dastlabki ma'lumotlar yuklanmoqda...")
                initial_data = [
                    {"category": "shaxsiy", "key": "ism", "value": "Shoxrux Aminboyev"},
                    {"category": "qiziqishlar", "key": "ai", "value": "Shoxrux AI, Generative AI va prompt engineering bilan qiziqadi."},
                    {"category": "texnologiya", "key": "backend", "value": "Shoxrux Django REST Framework yordamida backend dasturlash bilan shug'ullanadi."},
                    {"category": "qiziqishlar", "key": "psixologiya", "value": "Shoxrux psixologiya kitoblariga qiziqadi va ularni o'qishni yaxshi ko'radi."}
                ]
                for item in initial_data:
                    await MemoryRepository.add_or_update_memory(
                        session=session, category=item["category"],
                        key=item["key"], value=item["value"]
                    )
                logger.info("Dastlabki ma'lumotlar muvaffaqiyatli yuklandi.")
    except Exception as e:
        logger.error(f"Dastlabki ma'lumotlarni yuklashda xatolik: {e}", exc_info=True)


async def stats_exporter():
    """Background loop writing stats to stats.json."""
    from database.repositories import StatsRepository
    while True:
        try:
            async with AsyncSessionLocal() as session:
                stats = await StatsRepository.get_stats(session)
                with open("stats.json", "w") as f:
                    json.dump(stats, f)
        except Exception as e:
            logger.error(f"Stats export error: {e}")
        await asyncio.sleep(30)


def save_credentials_to_dotenv(api_id, api_hash, phone):
    paths = [".env", "../.env"]
    for p in paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                new_lines = []
                keys_updated = set()
                for line in lines:
                    stripped = line.strip()
                    if not stripped:
                        new_lines.append(line)
                        continue
                    parts = stripped.split("=", 1)
                    key = parts[0].strip()
                    if key == "TELEGRAM_API_ID":
                        new_lines.append(f"TELEGRAM_API_ID={api_id}\n")
                        keys_updated.add(key)
                    elif key == "TELEGRAM_API_HASH":
                        new_lines.append(f"TELEGRAM_API_HASH={api_hash}\n")
                        keys_updated.add(key)
                    elif key == "TELEGRAM_PHONE":
                        new_lines.append(f"TELEGRAM_PHONE={phone}\n")
                        keys_updated.add(key)
                    else:
                        new_lines.append(line)
                if "TELEGRAM_API_ID" not in keys_updated:
                    new_lines.append(f"TELEGRAM_API_ID={api_id}\n")
                if "TELEGRAM_API_HASH" not in keys_updated:
                    new_lines.append(f"TELEGRAM_API_HASH={api_hash}\n")
                if "TELEGRAM_PHONE" not in keys_updated:
                    new_lines.append(f"TELEGRAM_PHONE={phone}\n")
                with open(p, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
                logger.info(f"Credentials saved to {p}")
            except Exception as e:
                logger.error(f"Error writing {p}: {e}")


# ══════════════════════════════════════════════════════════════
#  MESSAGE HANDLER — PRIVATE MESSAGES ONLY, ZERO GROUP TRAFFIC
# ══════════════════════════════════════════════════════════════

def register_message_handlers(client_inst):
    """
    Register handler that ONLY receives private (DM) messages.
    Groups/channels are completely invisible — Telethon won't even
    download or emit events for them.
    """

    @client_inst.on(events.NewMessage(incoming=True, func=lambda e: e.is_private))
    async def handle_private_message(event):
        # ── 1. Sender ID (no API call) ──
        user_id = event.sender_id
        if not user_id:
            return

        # ── 2. Owner ID (cached) ──
        owner_id = _get_owner_id(client_inst)

        # ── 3. Blacklist check (reload file only if mtime changed) ──
        _load_blocked_ids()
        if _blocked_ids and user_id in _blocked_ids and user_id != owner_id:
            logger.info(f"Blacklisted user ignored: {user_id}")
            return

        # ── 4. Get text ──
        message_text = (event.text or "").strip()
        if not message_text:
            return

        # ── 5. Skip commands ──
        if message_text.startswith("/"):
            return

        # ── 6. In-memory context ──
        ctx = _get_context(user_id)
        ctx.append({"role": "user", "content": message_text})

        # ── 7. Show typing ──
        async with client_inst.action(event.chat_id, 'typing'):
            try:
                # Load system prompt with memories (rarely changes, light)
                async with AsyncSessionLocal() as session:
                    memories_text = await MemoryRepository.get_memories_text(session)
                system_prompt = get_system_prompt(memories_text)

                # Build chat history from in-memory context (max 4 msgs)
                chat_history = []
                for m in ctx:
                    chat_history.append(type('Obj', (), {'role': m['role'], 'content': m['content']})())

                # Call AI
                response = await generate_response(
                    system_prompt=system_prompt,
                    chat_history=chat_history[:-1],
                    user_message=message_text
                )

                reply = response.get("reply", "")
                error_msg = response.get("error_msg", "")
                notify_owner = response.get("notify_owner", False)
                notification = response.get("notification")
                memory_update = response.get("memory_update", {})

                # ── Handle AI errors silently ──
                if error_msg:
                    reply = ""
                    try:
                        await client_inst.send_message(
                            "me",
                            f"⚠️ AI xatolik (user {user_id}): `{error_msg}`",
                            parse_mode="md"
                        )
                    except Exception:
                        pass

                # ── Don't reply to non-owner if AI says notify ──
                if notify_owner and user_id != owner_id:
                    reply = ""

                # ── Send reply ──
                if reply and reply.strip():
                    await event.reply(reply, parse_mode="md")
                    ctx.append({"role": "assistant", "content": reply})

                # ── Memory extraction (owner only) ──
                if user_id == owner_id and memory_update and memory_update.get("should_save"):
                    async with AsyncSessionLocal() as session:
                        saved = await MemoryService.process_memory_update(session, memory_update)
                        if saved:
                            cat = memory_update.get('category', '?')
                            key = memory_update.get('key', '?')
                            val = memory_update.get('value', '')
                            await event.reply(
                                f"🧠 *Xotira saqlandi!*\n📁 Kategoriya: `{cat}`\n🔑 Kalit: `{key}`\n📝 {val}",
                                parse_mode="md"
                            )

                # ── System prompt update (owner only) ──
                prompt_update = response.get("prompt_update", {})
                if user_id == owner_id and prompt_update and prompt_update.get("should_update"):
                    new_prompt = prompt_update.get("new_system_prompt")
                    if new_prompt:
                        from prompts.system_prompt import PROMPT_FILE_PATH
                        try:
                            with open(PROMPT_FILE_PATH, "w", encoding="utf-8") as f:
                                f.write(new_prompt)
                            await event.reply("🧠 System prompt yangilandi!", parse_mode="md")
                        except Exception as pe:
                            logger.error(f"Prompt update failed: {pe}")

                # ── Owner notification from users ──
                if notify_owner and notification and user_id != owner_id:
                    try:
                        await client_inst.send_message(
                            "me",
                            f"🔔 Yangi bildirishnoma (user {user_id}):\n{notification}",
                            parse_mode="md"
                        )
                    except Exception:
                        pass

            except Exception as e:
                logger.error(f"Handler error: {e}", exc_info=True)
                try:
                    await client_inst.send_message("me", f"🚨 Bot xatolik: `{str(e)}`", parse_mode="md")
                except Exception:
                    pass


# ══════════════════════════════════════════════════════════════
#  HTTP REST API — for Node.js proxy (port 8000)
# ══════════════════════════════════════════════════════════════

async def http_get_status(request):
    global client, userbot_active
    logged_in = False
    phone = ""
    api_id = ""
    me_info = None

    if client:
        try:
            if not client.is_connected():
                await client.connect()
            logged_in = await client.is_user_authorized()
            if logged_in:
                me = await client.get_me()
                phone = getattr(me, 'phone', '')
                me_info = {
                    "id": me.id,
                    "first_name": me.first_name,
                    "last_name": me.last_name,
                    "username": me.username,
                    "phone": phone
                }
        except Exception as e:
            logger.error(f"Status check error: {e}")
            logged_in = False

    if not phone and TELEGRAM_PHONE:
        phone = TELEGRAM_PHONE
    if not api_id and TELEGRAM_API_ID:
        api_id = TELEGRAM_API_ID

    return web.json_response({
        "success": True,
        "logged_in": logged_in,
        "phone": phone,
        "api_id": api_id,
        "userbot_active": userbot_active and logged_in,
        "me": me_info
    })


async def http_send_code(request):
    global client, phone_code_hash_cache, pending_credentials
    try:
        data = await request.json()
        api_id_str = str(data.get("api_id", "")).strip()
        api_hash = data.get("api_hash", "").strip()
        phone = data.get("phone", "").strip()

        if not api_id_str or not api_hash or not phone:
            return web.json_response({"success": False, "error": "API_ID, API_HASH and Phone are required"}, status=400)

        api_id = int(api_id_str)

        if client:
            await client.disconnect()

        logger.info(f"Connecting to Telegram for {phone} (API ID: {api_id})...")
        client = TelegramClient('userbot', api_id, api_hash)
        await client.connect()

        logger.info(f"Requesting sign-in code for {phone}...")
        send_code_result = await client.send_code_request(phone)

        phone_code_hash_cache[phone] = send_code_result.phone_code_hash
        pending_credentials = {"api_id": api_id, "api_hash": api_hash, "phone": phone}

        return web.json_response({"success": True, "message": "Tasdiqlash kodi Telegram'ga yuborildi."})
    except Exception as e:
        logger.error(f"http_send_code error: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def http_verify_code(request):
    global client, phone_code_hash_cache, pending_credentials, userbot_active
    try:
        data = await request.json()
        code = data.get("code", "").strip()
        password = data.get("password", "").strip()

        if not code:
            return web.json_response({"success": False, "error": "Verification code is required"}, status=400)
        if not pending_credentials or not client:
            return web.json_response({"success": False, "error": "No pending connection."}, status=400)

        phone = pending_credentials["phone"]
        phone_code_hash = phone_code_hash_cache.get(phone)

        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not password:
                return web.json_response({"success": False, "password_required": True, "error": "2FA talab qilinadi!"})
            await client.sign_in(password=password)

        save_credentials_to_dotenv(pending_credentials["api_id"], pending_credentials["api_hash"], phone)
        pending_credentials = {}

        register_message_handlers(client)
        userbot_active = True

        logger.info("Userbot authorized and running!")
        return web.json_response({"success": True, "message": "Userbot muvaffaqiyatli ishga tushirildi!"})
    except Exception as e:
        logger.error(f"http_verify_code error: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def http_logout(request):
    global client, userbot_active
    try:
        if client:
            try:
                await client.log_out()
            except Exception:
                pass
            await client.disconnect()
            client = None
        userbot_active = False

        for f in ["userbot.session", "userbot.session-journal"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

        save_credentials_to_dotenv("", "", "")
        logger.info("Userbot logged out.")
        return web.json_response({"success": True, "message": "Userbot tizimdan chiqarildi."})
    except Exception as e:
        logger.error(f"http_logout error: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════

async def main():
    global client, userbot_active

    logger.info("Database va jadvallarni tekshirish...")
    await init_db()
    await seed_initial_memories()
    asyncio.create_task(stats_exporter())

    # Auto-login if credentials exist
    if TELEGRAM_API_ID and TELEGRAM_API_HASH:
        try:
            api_id = int(TELEGRAM_API_ID)
            api_hash = TELEGRAM_API_HASH
            logger.info(f"Auto-connecting userbot (API ID: {api_id})...")
            client = TelegramClient('userbot', api_id, api_hash)
            await client.connect()

            if await client.is_user_authorized():
                register_message_handlers(client)
                userbot_active = True
                logger.info("Userbot auto-authorized!")
            else:
                logger.info("Session not authorized. Waiting for web login.")
        except Exception as e:
            logger.error(f"Auto-start failed: {e}")

    # aiohttp server for Node.js proxy
    app = web.Application()
    app.router.add_get('/status', http_get_status)
    app.router.add_post('/send-code', http_send_code)
    app.router.add_post('/verify-code', http_verify_code)
    app.router.add_post('/logout', http_logout)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8000)
    await site.start()
    logger.info("Internal API started on http://localhost:8000")

    try:
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        logger.info("Stopping...")
    finally:
        if client:
            await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot to'xtatildi.")
