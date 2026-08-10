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
from database.models import PersonalMemory
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
                    {
                        "category": "shaxsiy",
                        "key": "ism",
                        "value": "Shoxrux Aminboyev"
                    },
                    {
                        "category": "qiziqishlar",
                        "key": "ai",
                        "value": "Shoxrux AI, Generative AI va prompt engineering bilan qiziqadi."
                    },
                    {
                        "category": "texnologiya",
                        "key": "backend",
                        "value": "Shoxrux Django REST Framework yordamida backend dasturlash bilan shug'ullanadi."
                    },
                    {
                        "category": "qiziqishlar",
                        "key": "psixologiya",
                        "value": "Shoxrux psixologiya kitoblariga qiziqadi va ularni o'qishni yaxshi ko'radi."
                    }
                ]
                
                for item in initial_data:
                    await MemoryRepository.add_or_update_memory(
                        session=session,
                        category=item["category"],
                        key=item["key"],
                        value=item["value"]
                    )
                logger.info("Dastlabki ma'lumotlar muvaffaqiyatli yuklandi.")
    except Exception as e:
        logger.error(f"Dastlabki ma'lumotlarni yuklashda xatolik: {e}", exc_info=True)

async def stats_exporter():
    """
    Background loop that writes stats to stats.json for the Node.js developer console.
    """
    from database.repositories import StatsRepository
    while True:
        try:
            async with AsyncSessionLocal() as session:
                stats = await StatsRepository.get_stats(session)
                with open("stats.json", "w") as f:
                    json.dump(stats, f)
        except Exception as e:
            logger.error(f"Error exporting stats to stats.json: {e}")
        await asyncio.sleep(10)

def save_credentials_to_dotenv(api_id, api_hash, phone):
    # Paths relative to telegram_ai_bot running folder
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

            # Check ID filters (Blacklist & Group Whitelist)
            try:
                settings_path = os.path.join(os.path.dirname(__file__), "filter_settings.json")
                if os.path.exists(settings_path):
                    with open(settings_path, "r", encoding="utf-8") as f:
                        filter_data = json.load(f)
                    
                    blacklist_enabled = filter_data.get("blacklist_enabled", False)
                    blocked_ids = filter_data.get("blocked_ids", [])
                    group_filter_enabled = filter_data.get("group_filter_enabled", False)
                    allowed_group_ids = filter_data.get("allowed_group_ids", [])

                    # Convert lists of strings/numbers to integers
                    def to_ints(lst):
                        res = []
                        for x in lst:
                            try:
                                res.append(int(x))
                            except ValueError:
                                pass
                        return res

                    blocked_ids_ints = to_ints(blocked_ids)
                    allowed_group_ids_ints = to_ints(allowed_group_ids)

                    # Determine if sender is me (the owner)
                    is_owner = (user_id == OWNER_ID)
                    try:
                        me = await client_inst.get_me()
                        if me and user_id == me.id:
                            is_owner = True
                    except Exception:
                        pass

                    # 1. Blacklist check (never blocks Owner)
                    if blacklist_enabled and not is_owner:
                        if user_id in blocked_ids_ints or event.chat_id in blocked_ids_ints:
                            fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz"
                            logger.info(f"ID Filter: Blocked message from {fullname} (ID: {user_id}, Chat: {event.chat_id}) - blacklisted")
                            return

                    # 2. Group filter check
                    if not event.is_private:
                        if not group_filter_enabled:
                            # If group filter is disabled, do not respond in groups/channels at all
                            return
                        else:
                            # Group filter is enabled, check if current group chat_id is allowed
                            if event.chat_id not in allowed_group_ids_ints:
                                logger.info(f"ID Filter: Ignored message in unauthorized group (ID: {event.chat_id})")
                                return
            except Exception as fe:
                logger.error(f"Error checking filters: {fe}")

            # Ignore commands in PM unless they are something specific
            if message_text.startswith("/"):
                return

            # Show typing action
            async with client_inst.action(event.chat_id, 'typing'):
                async with AsyncSessionLocal() as session:
                    # 1. Register or update the user
                    user = await UserRepository.get_or_create_user(
                        session=session,
                        telegram_user_id=user_id,
                        username=username,
                        first_name=first_name,
                        last_name=last_name
                    )

                    # 2. Save incoming user message
                    await MessageRepository.save_message(
                        session=session,
                        telegram_user_id=user_id,
                        role="user",
                        content=message_text
                    )

                    # 3. Get recent chat history
                    chat_history = await MessageRepository.get_chat_history(
                        session=session,
                        telegram_user_id=user_id,
                        limit=MAX_HISTORY_MESSAGES
                    )

                    # 4. Get all memories as text
                    memories_text = await MemoryRepository.get_memories_text(session)

                    # 5. Build dynamic system prompt
                    system_prompt = get_system_prompt(memories_text)

                    # 6. Call AI API
                    response = await generate_response(
                        system_prompt=system_prompt,
                        chat_history=chat_history[:-1], # pass history before saving current msg
                        user_message=message_text
                    )

                    reply = response.get("reply", "")
                    error_msg = response.get("error_msg", "")
                    notify_owner = response.get("notify_owner", False)
                    notification = response.get("notification")
                    memory_update = response.get("memory_update", {})

                    # Retrieve my own ID (owner) to see if we can trigger prompt/memory updates
                    try:
                        me = await client_inst.get_me()
                        my_id = me.id if me else OWNER_ID
                    except Exception:
                        my_id = OWNER_ID

                    # If there was an AI error (e.g. missing/invalid API key or parsing failure)
                    if error_msg:
                        reply = "" # Ensure we never reply to other users with raw errors
                        fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz foydalanuvchi"
                        username_str = f"@{username}" if username else "username yo'q"
                        owner_error_log = (
                            f"⚠️ *Xabar qayta ishlashda xatolik yuz berdi:*\n"
                            f"👤 Kimdan: {fullname} ({username_str}, ID: `{user_id}`)\n"
                            f"📝 Yozgan xabari: _{message_text}_\n\n"
                            f"❌ *Xatolik:* `{error_msg}`\n"
                            f"💡 _Eslatma: Ushbu xatolik faqat o'zingizga (Saqlangan xabarlar) yuborildi, boshqa foydalanuvchilar buni ko'rmaydi._"
                        )
                        try:
                            await client_inst.send_message("me", owner_error_log, parse_mode="md")
                        except Exception as se:
                            logger.error(f"Failed to send error notification to Saved Messages: {se}")

                    # If notifying owner because the bot doesn't know the answer or for other reasons,
                    # force reply to be empty so the bot does not reply to the user.
                    if notify_owner and user_id != my_id:
                        reply = ""

                    # 7. Save incoming assistant message to history
                    if reply and reply.strip():
                        await MessageRepository.save_message(
                            session=session,
                            telegram_user_id=user_id,
                            role="assistant",
                            content=reply
                        )
                        # Send reply using Telethon
                        await event.reply(reply, parse_mode="md")

                    # 8. Handle on-the-fly memory extraction (only if sender is owner)
                    if user_id == my_id and memory_update and memory_update.get("should_save"):
                        saved = await MemoryService.process_memory_update(session, memory_update)
                        if saved:
                            category = memory_update.get('category', 'noma\'lum')
                            key = memory_update.get('key', 'noma\'lum')
                            val = memory_update.get('value', message_text)
                            await event.reply(
                                f"🧠 *Tizim:* Shaxsiy xotirangizga yangi ma'lumot saqlandi!\n"
                                f"📁 Kategoriya: `{category}`\n"
                                f"🔑 Kalit: `{key}`\n"
                                f"📝 Fakt: _{val}_",
                                parse_mode="md"
                              )

                    # 9. Handle automatic system prompt modification (only if sender is owner)
                    prompt_update = response.get("prompt_update", {})
                    if user_id == my_id and prompt_update and prompt_update.get("should_update"):
                        new_prompt = prompt_update.get("new_system_prompt")
                        if new_prompt:
                            from prompts.system_prompt import PROMPT_FILE_PATH
                            try:
                                with open(PROMPT_FILE_PATH, "w", encoding="utf-8") as f:
                                    f.write(new_prompt)
                                await event.reply(
                                    "🧠 *Tizim:* Sening buyrug'ing bo'yicha bot tizim ko'rsatmalari (System Prompt) muvaffaqiyatli yangilandi va saqlandi!",
                                    parse_mode="md"
                                )
                            except Exception as pe:
                                logger.error(f"Failed to update system prompt file: {pe}")

                    # 10. Handle owner notifications (from ordinary users) -> sent to Saved Messages
                    if notify_owner and notification and user_id != my_id:
                        fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz foydalanuvchi"
                        notify_msg = (
                            f"🔔 *Yangi Bildirishnoma (Foydalanuvchi: {fullname} @{username or ''}):*\n"
                            f"{notification}"
                        )
                        await client_inst.send_message("me", notify_msg, parse_mode="md")

        except Exception as e:
            logger.error(f"Error in chat handler for user: {e}", exc_info=True)
            try:
                # Notify owner in Saved Messages about the unhandled exception
                err_msg = (
                    f"🚨 *Bot tizimida kutilmagan xatolik yuz berdi!*\n"
                    f"❌ Xatolik tafsiloti: `{str(e)}`"
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

    # Also check from env
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

        # Disconnect existing client if any
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
    global client, phone_code_hash_cache, pending_credentials, userbot_active
    try:
        data = await request.json()
        code = data.get("code", "").strip()
        password = data.get("password", "").strip()

        if not code:
            return web.json_response({"success": False, "error": "Verification code is required"}, status=400)

        if not pending_credentials or not client:
            return web.json_response({"success": False, "error": "No pending connection. Please request code first."}, status=400)

        phone = pending_credentials["phone"]
        api_id = pending_credentials["api_id"]
        api_hash = pending_credentials["api_hash"]
        phone_code_hash = phone_code_hash_cache.get(phone)

        logger.info(f"Signing in for {phone} with code {code}...")
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            if not password:
                return web.json_response({
                    "success": False, 
                    "password_required": True, 
                    "error": "Ikki bosqichli parol (2FA) talab qilinadi!"
                })
            logger.info("2FA password required, singing in with password...")
            await client.sign_in(password=password)

        # If we got here, sign-in is successful!
        # Save credentials to config files
        save_credentials_to_dotenv(api_id, api_hash, phone)

        # Clear temp variables
        pending_credentials = {}

        # Set up handler and turn userbot active
        register_message_handlers(client)
        userbot_active = True

        logger.info("Userbot successfully authorized and message listener started!")
        return web.json_response({
            "success": True,
            "message": "Userbot muvaffaqiyatli ishga tushirildi va shaxsiy hisobingizga ulandi!"
        })
    except Exception as e:
        logger.error(f"Error in http_verify_code: {e}", exc_info=True)
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

        # Remove session files
        for f in ["userbot.session", "userbot.session-journal"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

        # Clean credentials from .env
        save_credentials_to_dotenv("", "", "")

        logger.info("Userbot logged out and session files cleared.")
        return web.json_response({"success": True, "message": "Userbot tizimdan chiqarildi."})
    except Exception as e:
        logger.error(f"Error in http_logout: {e}", exc_info=True)
        return web.json_response({"success": False, "error": str(e)}, status=500)


async def main():
    global client, userbot_active

    logger.info("Database va jadvallarni tekshirish...")
    # Initialize DB (creates files/tables if not exist)
    await init_db()
    
    # Pre-seed initial database memories
    await seed_initial_memories()

    # Start the stats exporter task in background
    asyncio.create_task(stats_exporter())

    # Try auto-login if credentials exist in env
    if TELEGRAM_API_ID and TELEGRAM_API_HASH:
        try:
            api_id = int(TELEGRAM_API_ID)
            api_hash = TELEGRAM_API_HASH
            logger.info(f"Auto-connecting userbot session (API ID: {api_id})...")
            client = TelegramClient('userbot', api_id, api_hash)
            await client.connect()

            if await client.is_user_authorized():
                register_message_handlers(client)
                userbot_active = True
                logger.info("Userbot session automatically authorized!")
            else:
                logger.info("Userbot session exists but is not authorized yet. Waiting for web login.")
        except Exception as e:
            logger.error(f"Failed to auto-start userbot: {e}")

    # Set up aiohttp server for internal node.js queries
    app = web.Application()
    app.router.add_get('/status', http_get_status)
    app.router.add_post('/send-code', http_send_code)
    app.router.add_post('/verify-code', http_verify_code)
    app.router.add_post('/logout', http_logout)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8000)
    await site.start()
    logger.info("Internal communication API started on http://localhost:8000")

    # Keep running forever
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
