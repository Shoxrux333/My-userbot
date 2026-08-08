from aiogram import Router, F, types
from database.database import AsyncSessionLocal
from database.repositories import UserRepository, MessageRepository, MemoryRepository
from services.ai import generate_response
from services.memory import MemoryService
from services.notifications import NotificationService
from prompts.system_prompt import get_system_prompt
from config import OWNER_ID, MAX_HISTORY_MESSAGES
import logging

logger = logging.getLogger(__name__)
router = Router(name="chat")

@router.message(F.text)
async def handle_user_message(message: types.Message):
    user_id = message.from_user.id
    username = message.from_user.username
    first_name = message.from_user.first_name
    last_name = message.from_user.last_name
    message_text = message.text.strip()

    if not message_text:
        return

    # Ignore commands (they are handled by other routers)
    if message_text.startswith("/"):
        return

    # Send a typing indicator while AI is processing
    await message.bot.send_chat_action(chat_id=message.chat.id, action="typing")

    try:
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
                chat_history=chat_history[:-1], # pass history before saving current msg to avoid double listing
                user_message=message_text
            )

            reply = response.get("reply", "")
            notify_owner = response.get("notify_owner", False)
            notification = response.get("notification")
            memory_update = response.get("memory_update", {})

            # 7. Save incoming assistant message to history
            if reply:
                await MessageRepository.save_message(
                    session=session,
                    telegram_user_id=user_id,
                    role="assistant",
                    content=reply
                )

            # 8. Send reply to user
            # We replace asterisks or escape as fallback if markdown is malformed,
            # but usually standard answers are clean or can use markdown if simple.
            try:
                await message.answer(reply, parse_mode="Markdown")
            except Exception as markdown_err:
                logger.warning(f"Failed to send with Markdown, falling back to plain text: {markdown_err}")
                await message.answer(reply)

            # 9. Handle on-the-fly memory extraction (only if sender is OWNER_ID)
            if user_id == OWNER_ID and memory_update and memory_update.get("should_save"):
                saved = await MemoryService.process_memory_update(session, memory_update)
                if saved:
                    category = memory_update.get('category', 'noma\'lum')
                    key = memory_update.get('key', 'noma\'lum')
                    val = memory_update.get('value', message_text)
                    await message.answer(
                        f"🧠 *Tizim:* Shaxsiy xotirangizga yangi ma'lumot saqlandi!\n"
                        f"📁 Kategoriya: `{category}`\n"
                        f"🔑 Kalit: `{key}`\n"
                        f"📝 Fakt: _{val}_",
                        parse_mode="Markdown"
                    )

            # 9.5 Handle automatic system prompt modification (only if sender is OWNER_ID)
            prompt_update = response.get("prompt_update", {})
            if user_id == OWNER_ID and prompt_update and prompt_update.get("should_update"):
                new_prompt = prompt_update.get("new_system_prompt")
                if new_prompt:
                    from prompts.system_prompt import PROMPT_FILE_PATH
                    try:
                        with open(PROMPT_FILE_PATH, "w", encoding="utf-8") as f:
                            f.write(new_prompt)
                        await message.answer(
                            "🧠 *Tizim:* Sening buyrug'ing bo'yicha bot tizim ko'rsatmalari (System Prompt) muvaffaqiyatli yangilandi va saqlandi!",
                            parse_mode="Markdown"
                        )
                    except Exception as pe:
                        logger.error(f"Failed to update system prompt file: {pe}")
                        await message.answer(f"⚠️ *Tizim:* Tizim ko'rsatmasini saqlashda xato: {pe}", parse_mode="Markdown")

            # 10. Handle owner notifications (from ordinary users)
            if notify_owner and notification and user_id != OWNER_ID:
                fullname = f"{first_name or ''} {last_name or ''}".strip() or "Ismsiz foydalanuvchi"
                await NotificationService.notify_owner(
                    bot=message.bot,
                    user_fullname=fullname,
                    user_username=username,
                    notification_text=notification
                )

    except Exception as e:
        logger.error(f"Error in chat handler for user {user_id}: {e}", exc_info=True)
        await message.answer(
            "Hozircha javob berishda texnik muammo bo‘ldi, birozdan keyin yana yozib ko‘ring."
        )
