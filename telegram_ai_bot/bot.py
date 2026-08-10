import asyncio
import logging
import sys
import os
import json
from aiohttp import web
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError

from config import TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE, OWNER_ID, MAX_HISTORY_MESSAGES
from database.database import init_db, AsyncSessionLocal
from database.repositories import UserRepository, MessageRepository, MemoryRepository
from database.models import PersonalMemory, Message
from services.ai import generate_response
from services.memory import MemoryService
from prompts.system_prompt import get_system_prompt

# Set up logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Global variables
client = None
phone_code_hash_cache = {}
pending_credentials = {}
userbot_active = False

# --- Filter cache: faylni har safar diskdan o'qish o'rniga xotirada saqlaymiz ---
_filter_cache = {
    "data": None,
    "mtime": 0.0,
    "path": os.path.join(os.path.dirname(__file__), "filter_settings.json")
}

# --- Owner ID cache: get_me() ni faqat bir marta chaqiramiz ---
_cached_owner_id = None


def _load_filter_settings() -> dict | None:
    """
    filter_settings.json faylini faqat o'zgarganda qayta o'qiydi (mtime tekshiruv).
    Xotirada cache qilinadi — disk I/O deyarli yo'q.
    """
    path = _filter_cache["path"]
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None

    cached = _filter_cache
    if cached["data"] is not None and cached["mtime"] == mtime:
        return cached["data"]

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        _filter_cache["data"] = data
        _filter_cache["mtime"] = mtime
        return data
    except Exception as e:
        logger.error(f"Error loading filter_settings.json: {e}")
        return cached["data"]  # eski cache'ni qaytar (fayl nosoz bo'lsa ham ishlaydi)


def _to_int_set(lst) -> set[int]:
    """Ro'yxatni butun sonlar set'ga aylantirish."""
    result = set()
    for x in lst:
        try:
            result.add(int(x))
        except (ValueError, TypeError):
            pass
    return result


async def _get_my_owner_id(client_inst) -> int:
    """
    Owner ID ni aniqlash: avval env dan, keyin get_me() dan.
    Natijani cache qiladi — Telegram API ga faqat 1 marta so'rov.
    """
    global _cached_owner_id
    if _cached_owner_id is not None:
        return _cached_owner_id

    # ENV dan aniqlash
    if OWNER_ID and OWNER_ID != 0:
        _cached_owner_id = OWNER_ID
        return _cached_owner_id

    # get_me() orqali aniqlash
    try:
        me = await client_inst.get_me()
        if me:
            _cached_owner_id = me.id
            logger.info(f"Owner ID aniqlandi (get_me): {_cached_owner_id}")
            return _cached_owner_id
    except Exception as e:
        logger.warning(f"get_me() chaqirishda xatolik: {e}")

    # Hech qanday ID topilmasa, 0 qaytaramiz (owner aniqlanmadi)
    _cached_owner_id = 0
    return 0


def invalidate_filter_cache():
    """Web panel orqali filter o'zgarganda cache'ni tozalash."""
    _filter_cache["data"] = None
    _filter_cache["mtime"] = 0.0


async def seed_initial_memories():
    """
    Seeds initial memories about Shoxrux if the database memory table is empty.
    """
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
                        session=session,
                        category=item["category"],
                        key=item["key"],
                        value=item["value"]
                    )
                await session.commit()
                logger.info("Dastlabki ma'lumotlar muvaffaqiyatli yuklandi.")
    except Exception as e:
        logger.error(f"Dastlabki ma'lumotlarni yuklashda xatolik: {e}", exc_info=True)


async def stats_exporter():
    """
    Background loop — stats.json ni yangilash.
    Optimizatsiya: 60 soniya interval (10 o'rniga), bitta combined so'rov.
    """
    from sqlalchemy import select, func
    from database.models import User, Message, PersonalMemory

    while True:
        try:
            async with AsyncSessionLocal() as session:
                # Bitta so'rovda barcha statistikani olish
                from sqlalchemy import case
                ai_count_expr = func.count(
                    case((Message.role == "assistant", 1))
                ).label("ai_count")

                stmt = select(
                    func.count(User.id).label("users"),
                    func.coalesce(ai_count_expr, 0).label("ai"),
                    func.count(Message.id).label("messages"),
                    func.count(PersonalMemory.id).label("memory")
                )
                result = await session.execute(stmt)
                row = result.one()

                stats = {
                    "users": row.users or 0,
                    "messages": row.messages or 0,
                    "memory": row.memory or 0,
                    "ai": row.ai or 0
                }

                stats_path = os.path.join(os.path.dirname(__file__), "stats.json")
                with open(stats_path, "w") as f:
                    json.dump(stats, f)
        except Exception as e:
            logger.error(f"Error exporting stats: {e}")
        await asyncio.sleep(60)


def save_credentials_to_dotenv(api_id, api_hash, phone):
    paths = [".env", "../.env"]
    for path in paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
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
                    
                with open(path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
                logger.info(f"Saved userbot credentials to {path}")
            except Exception as e:
                logger.error(f"Error writing to {path}: {e}")


# Register Telethon Message Handler
def register_message_handlers(client_inst):
    @client_inst.on(events.NewMessage(incoming=True))
    async def handle_user_message(event):
        try:
            sender = await event.get_sender()
            if not sender:
                return

            user_id = sender.id
            username = getattr(sender, 'username', None)
            first_name = getattr(sender, 'first_name', None)
            last_name = getattr(sender, 'last_name', None)
            message_text = event.text or ""
            message_text = message_text.strip()

            if not message_text:
                return

            # --- ID Filter: cache'dan o'qiladi, disk I/O yo'q ---
            try:
                filter_data = _load_filter_settings()

                if filter_data is not None:
                    blacklist_enabled = filter_data.get("blacklist_enabled", False)
                    blocked_ids = filter_data.get("blocked_ids", [])
                    group_filter_enabled = filter_data.get("group_filter_enabled", False)
                    allowed_group_ids = filter_data.get("allowed_group_ids", [])

                    blocked_set = _to_int_set(blocked_ids)
                    allowed_set = _to_int_set(allowed_group_ids)

                    # Owner ID ni cache'dan olamiz (har safar get_me() chaqirmaymiz)
                    my_id = await _get_my_owner_id(client_inst)
                    is_owner = (user_id == my_id)

                    # 1. Blacklist (owner hech qachon bloklanmaydi)
                    if blacklist_enabled and not is_owner:
                        if user_id in blocked_set or event.chat_id in blocked_set:
                            fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz"
                            logger.info(f"ID Filter: Blocked {fullname} (ID: {user_id}, Chat: {event.chat_id})")
                            return

                    # 2. Group filter
                    if not event.is_private:
                        if not group_filter_enabled:
                            # Group filter o'chirilgan = guruhlarda javob berilmasin
                            return
                        elif allowed_set:
                            # Ruxsat etilgan guruhlar ro'yxati bo'sh bo'lmasa, faqat o'shanda tekshir
                            if event.chat_id not in allowed_set:
                                logger.info(f"ID Filter: Unauthorized group (ID: {event.chat_id})")
                                return
                        # allowed_set bo'sh va group_filter_enabled=True =>
                        # HAMMA guruhlarga ruxsat (safiya whitelist, hech narsa bloklanmaydi)

            except Exception as fe:
                logger.error(f"Error checking filters: {fe}")

            # Ignore commands
            if message_text.startswith("/"):
                return

            # Show typing action
            async with client_inst.action(event.chat_id, 'typing'):
                async with AsyncSessionLocal() as session:
                    # 1. Register or update user
                    user = await UserRepository.get_or_create_user(
                        session=session,
                        telegram_user_id=user_id,
                        username=username,
                        first_name=first_name,
                        last_name=last_name
                    )

                    # 2. Save user message (commit keyin qilinadi)
                    user_msg = Message(
                        telegram_user_id=user_id,
                        role="user",
                        content=message_text
                    )
                    session.add(user_msg)

                    # 3. Get recent chat history
                    chat_history = await MessageRepository.get_chat_history(
                        session=session,
                        telegram_user_id=user_id,
                        limit=MAX_HISTORY_MESSAGES
                    )

                    # 4. Get memories (cache'dan yoki DB dan)
                    memories_text = await MemoryRepository.get_memories_text(session)

                    # 5. Build system prompt
                    system_prompt = get_system_prompt(memories_text)

                    # --- DB commit: user + message birgalikda saqlanadi ---
                    await session.commit()

                    # 6. Call AI API
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

                    # Owner ID (cached)
                    my_id = await _get_my_owner_id(client_inst)

                    # AI error handling
                    if error_msg:
                        reply = ""
                        fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz foydalanuvchi"
                        username_str = f"@{username}" if username else "username yo'q"
                        owner_error_log = (
                            f"\u26a0\ufe0f *Xabar qayta ishlashda xatolik yuz berdi:*\n"
                            f"\ud83d\udc64 Kimdan: {fullname} ({username_str}, ID: `{user_id}`)\n"
                            f"\ud83d\udcdd Yozgan xabari: _{message_text}_\n\n"
                            f"\u274c *Xatolik:* `{error_msg}`\n"
                            f"\ud83d\udca1 _Eslatma: Ushbu xatolik faqat o'zingizga yuborildi._"
                        )
                        try:
                            await client_inst.send_message("me", owner_error_log, parse_mode="md")
                        except Exception as se:
                            logger.error(f"Failed to send error notification: {se}")

                    # Notify owner => reply bo'sh
                    if notify_owner and user_id != my_id:
                        reply = ""

                    # 7. Save assistant reply + commit
                    if reply and reply.strip():
                        await MessageRepository.save_message(
                            session=session,
                            telegram_user_id=user_id,
                            role="assistant",
                            content=reply
                        )
                        await session.commit()
                        await event.reply(reply, parse_mode="md")

                    # 8. Memory extraction (owner only)
                    if user_id == my_id and memory_update and memory_update.get("should_save"):
                        # Yangi session — commit alohida
                        async with AsyncSessionLocal() as mem_session:
                            saved = await MemoryService.process_memory_update(mem_session, memory_update)
                        if saved:
                            category = memory_update.get('category', "noma'lum")
                            key = memory_update.get('key', "noma'lum")
                            val = memory_update.get('value', message_text)
                            await event.reply(
                                f"\ud83e\udde0 *Tizim:* Shaxsiy xotirangizga yangi ma'lumot saqlandi!\n"
                                f"\ud83d\udcc1 Kategoriya: `{category}`\n"
                                f"\ud83d\udd11 Kalit: `{key}`\n"
                                f"\ud83d\udcdd Fakt: _{val}_",
                                parse_mode="md"
                            )

                    # 9. System prompt update (owner only)
                    prompt_update = response.get("prompt_update", {})
                    if user_id == my_id and prompt_update and prompt_update.get("should_update"):
                        new_prompt = prompt_update.get("new_system_prompt")
                        if new_prompt:
                            from prompts.system_prompt import PROMPT_FILE_PATH
                            try:
                                with open(PROMPT_FILE_PATH, "w", encoding="utf-8") as f:
                                    f.write(new_prompt)
                                await event.reply(
                                    "\ud83e\udde0 *Tizim:* System prompt muvaffaqiyatli yangilandi!",
                                    parse_mode="md"
                                )
                            except Exception as pe:
                                logger.error(f"Failed to update system prompt: {pe}")

                    # 10. Owner notifications
                    if notify_owner and notification and user_id != my_id:
                        fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz foydalanuvchi"
                        notify_msg = (
                            f"\ud83d\udd14 *Yangi Bildirishnoma ({fullname} @{username or ''}):*\n"
                            f"{notification}"
                        )
                        await client_inst.send_message("me", notify_msg, parse_mode="md")

        except Exception as e:
            logger.error(f"Error in chat handler: {e}", exc_info=True)
            try:
                err_msg = (
                    f"\ud83d\udea8 *Bot tizimida kutilmagan xatolik!*\n"
                    f"\u274c Xatolik: `{str(e)}`"
                )
                await client_inst.send_message("me", err_msg, parse_mode="md")
            except Exception:
                pass


# HTTP REST API Handlers for Node.js server
async def http_get_status(request):
    global client, userbot_active
    logged_in = False
    phone = ""
    api_id = ""
    me_info = None

    if client:
        try:
            connected = client.is_connected()
            if not connected:
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
            logger.error(f"Error checking status: {e}")
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
        pending_credentials = {
            "api_id": api_id,
            "api_hash": api_hash,
            "phone": phone
        }

        return web.json_response({
            "success": True,
            "message": "Tasdiqlash kodi Telegram'ga yuborildi. Kodni quyida kiriting."
        })
    except Exception as e:
        logger.error(f"Error in http_send_code: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)

async def http_verify_code(request):
    global client, phone_code_hash_cache, pending_credentials, userbot_active, _cached_owner_id
    try:
        data = await request.json()
        code = data.get("code", "").strip()
        password = data.get("password", "").strip()

        if not code:
            return web.json_response({"success": False, "error": "Verification code is required"}, status=400)

        if not pending_credentials or not client:
            return web.json_response({"success": False, "error": "No pending connection."}, status=400)

        phone = pending_credentials["phone"]
        api_id = pending_credentials["api_id"]
        api_hash = pending_credentials["api_hash"]
        phone_code_hash = phone_code_hash_cache.get(phone)

        logger.info(f"Signing in for {phone}...")
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not password:
                return web.json_response({
                    "success": False, 
                    "password_required": True, 
                    "error": "Ikki bosqichli parol (2FA) talab qilinadi!"
                })
            logger.info("2FA password required, signing in...")
            await client.sign_in(password=password)

        save_credentials_to_dotenv(api_id, api_hash, phone)
        pending_credentials = {}

        # Owner ID ni hozir aniqlab olamiz (keyin har safar get_me() chaqirilmaydi)
        try:
            me = await client.get_me()
            if me:
                _cached_owner_id = me.id
                logger.info(f"Owner ID cache'landi: {_cached_owner_id}")
        except Exception:
            pass

        register_message_handlers(client)
        userbot_active = True

        logger.info("Userbot successfully authorized and message listener started!")
        return web.json_response({
            "success": True,
            "message": "Userbot muvaffaqiyatli ishga tushirildi!"
        })
    except Exception as e:
        logger.error(f"Error in http_verify_code: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)

async def http_logout(request):
    global client, userbot_active, _cached_owner_id
    try:
        if client:
            try:
                await client.log_out()
            except Exception:
                pass
            await client.disconnect()
            client = None
        
        userbot_active = False
        _cached_owner_id = None

        for fname in ["userbot.session", "userbot.session-journal"]:
            if os.path.exists(fname):
                try:
                    os.remove(fname)
                except Exception:
                    pass

        save_credentials_to_dotenv("", "", "")

        logger.info("Userbot logged out.")
        return web.json_response({"success": True, "message": "Userbot tizimdan chiqarildi."})
    except Exception as e:
        logger.error(f"Error in http_logout: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def main():
    global client, userbot_active

    logger.info("Database va jadvallarni tekshirish...")
    await init_db()
    await seed_initial_memories()

    asyncio.create_task(stats_exporter())

    if TELEGRAM_API_ID and TELEGRAM_API_HASH:
        try:
            api_id = int(TELEGRAM_API_ID)
            api_hash = TELEGRAM_API_HASH
            logger.info(f"Auto-connecting userbot session (API ID: {api_id})...")
            client = TelegramClient('userbot', api_id, api_hash)
            await client.connect()

            if await client.is_user_authorized():
                # Owner ID ni bir marta aniqlab olamiz
                try:
                    me = await client.get_me()
                    if me:
                        _cached_owner_id = me.id
                        logger.info(f"Owner ID aniqlandi: {_cached_owner_id}")
                except Exception:
                    pass

                register_message_handlers(client)
                userbot_active = True
                logger.info("Userbot session automatically authorized!")
            else:
                logger.info("Session not authorized. Waiting for web login.")
        except Exception as e:
            logger.error(f"Failed to auto-start userbot: {e}")

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
