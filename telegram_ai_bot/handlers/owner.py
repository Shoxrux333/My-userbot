from aiogram import Router, F, types
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from database.database import AsyncSessionLocal
from database.repositories import UserRepository, MemoryRepository, StatsRepository
from services.ai import generate_response
from services.memory import MemoryService
from prompts.system_prompt import get_system_prompt
from keyboards.owner import get_owner_keyboard, get_cancel_keyboard
from config import OWNER_ID
import logging

logger = logging.getLogger(__name__)
router = Router(name="owner")

class OwnerStates(StatesGroup):
    waiting_for_memory = State()

# Helper filter to ensure only OWNER can access
def is_owner(message: types.Message) -> bool:
    return message.from_user.id == OWNER_ID

@router.message(F.text == "❌ Bekor qilish", is_owner)
async def cancel_action(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Amal bekor qilindi.",
        reply_markup=get_owner_keyboard()
    )

@router.message(F.text == "➕ Ma'lumot qo‘shish", is_owner)
async def add_memory_start(message: types.Message, state: FSMContext):
    await state.set_state(OwnerStates.waiting_for_memory)
    await message.answer(
        "Qanday ma'lumot qo‘shamiz?\n\n*Masalan:* 'Men psixologiya kitoblarini yaxshi ko‘raman va ko‘p o‘qiyman.'",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )

@router.message(OwnerStates.waiting_for_memory, is_owner)
async def add_memory_process(message: types.Message, state: FSMContext):
    text = message.text.strip()
    if not text:
        await message.answer("Iltimos, matn ko'rinishida xabar yuboring.")
        return

    # Send a typing indicator
    await message.bot.send_chat_action(chat_id=message.chat.id, action="typing")
    
    try:
        async with AsyncSessionLocal() as session:
            memories_text = await MemoryRepository.get_memories_text(session)
            system_prompt = get_system_prompt(memories_text)
            
            # Formulate instruction to AI to extract memory
            owner_instruction = (
                f"Tizim xabari: Quyidagi gap Shoxrux Aminboyev (Owner) tomonidan uning shaxsiy "
                f"xotirasiga (personal_memory) saqlash uchun yuborildi. Ushbu gapni tushunib, "
                f"fakt qilib shakllantiring va JSON formatida 'memory_update' qismini to'ldiring. "
                f"'should_save' qiymati true bo'lsin. 'reply' maydonida esa '✅ Ma'lumot saqlandi.' "
                f"deb javob bering.\n\n"
                f"Shoxruxning gapi: {text}"
            )

            response = await generate_response(
                system_prompt=system_prompt,
                chat_history=[],
                user_message=owner_instruction
            )
            
            memory_update = response.get("memory_update", {})
            if memory_update and memory_update.get("should_save"):
                # Save to database
                saved = await MemoryService.process_memory_update(session, memory_update)
                if saved:
                    reply_text = response.get("reply", "✅ Ma'lumot saqlandi.")
                    # Let's show what was saved to the owner
                    category = memory_update.get('category', 'Noma\'lum')
                    key = memory_update.get('key', 'Noma\'lum')
                    val = memory_update.get('value', text)
                    
                    full_reply = (
                        f"{reply_text}\n\n"
                        f"*Saqlangan ma'lumot:* \n"
                        f"📁 Kategoriya: `{category}`\n"
                        f"🔑 Kalit so'z: `{key}`\n"
                        f"📝 Qiymat: _{val}_"
                    )
                    await message.answer(full_reply, reply_markup=get_owner_keyboard(), parse_mode="Markdown")
                else:
                    await message.answer("Ma'lumotni saqlashda xatolik yuz berdi.", reply_markup=get_owner_keyboard())
            else:
                await message.answer(
                    "AI ushbu xabardan aniq fakt ajrata olmadi. Iltimos, aniqroq yozing.",
                    reply_markup=get_owner_keyboard()
                )
                
        await state.clear()
    except Exception as e:
        logger.error(f"Error processing memory addition: {e}", exc_info=True)
        await message.answer("Tizimda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.", reply_markup=get_owner_keyboard())
        await state.clear()

@router.message(F.text == "🧠 Xotiralar", is_owner)
async def list_memories(message: types.Message):
    try:
        async with AsyncSessionLocal() as session:
            memories = await MemoryRepository.get_all_memories(session)
            
            if not memories:
                await message.answer("Hozircha xotiralar bazasi bo'sh.")
                return
                
            # Group by category
            grouped = {}
            for m in memories:
                cat = m.category.capitalize()
                if cat not in grouped:
                    grouped[cat] = []
                grouped[cat].append(f"• `{m.key}`: {m.value}")
                
            response_parts = ["🧠 *SHAXSIY XOTIRALAR BAZASI*\n"]
            for cat, items in grouped.items():
                response_parts.append(f"📁 *{cat}:*")
                response_parts.extend(items)
                response_parts.append("") # Empty line
                
            full_text = "\n".join(response_parts).strip()
            
            # Telegram has a 4096 character limit per message
            if len(full_text) > 4000:
                for i in range(0, len(full_text), 4000):
                    await message.answer(full_text[i:i+4000], parse_mode="Markdown")
            else:
                await message.answer(full_text, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error listing memories: {e}", exc_info=True)
        await message.answer("Xotiralarni yuklashda xatolik yuz berdi.")

@router.message(F.text == "💬 Suhbatlar", is_owner)
async def list_conversations(message: types.Message):
    try:
        async with AsyncSessionLocal() as session:
            recent_chats = await StatsRepository.get_recent_conversations(session, limit=10)
            
            if not recent_chats:
                await message.answer("Hozircha hech qanday suhbatlar mavjud emas.")
                return
                
            response_text = "💬 *Oxirgi faol suhbatlar:*\n\n"
            
            for chat in recent_chats:
                user = chat["user"]
                history = chat["history"]
                username_str = f"@{user.username}" if user.username else "username yo'q"
                fullname = f"{user.first_name or ''} {user.last_name or ''}".strip() or "Ism yo'q"
                
                response_text += f"👤 *{fullname}* ({username_str})\n"
                response_text += f"🕐 *Oxirgi faollik:* {chat['last_active'].strftime('%Y-%m-%d %H:%M:%S')}\n"
                
                # Show last messages
                for msg in history:
                    role_label = "User" if msg.role == "user" else "AI"
                    response_text += f"  *{role_label}:* {msg.content[:100]}\n"
                response_text += "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n"
                
            if len(response_text) > 4000:
                for i in range(0, len(response_text), 4000):
                    await message.answer(response_text[i:i+4000], parse_mode="Markdown")
            else:
                await message.answer(response_text, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error fetching recent chats: {e}", exc_info=True)
        await message.answer("Suhbatlar ro'yxatini olishda xatolik yuz berdi.")

@router.message(F.text == "📊 Statistika", is_owner)
async def show_stats(message: types.Message):
    try:
        async with AsyncSessionLocal() as session:
            stats = await StatsRepository.get_stats(session)
            
            text = (
                "📊 *BOT FOYDALANISH STATISTIKASI*\n\n"
                f"👥 *Foydalanuvchilar soni:* {stats['users']}\n"
                f"💬 *Jami xabarlar soni:* {stats['messages']}\n"
                f"🤖 *AI javoblar soni:* {stats['ai']}\n"
                f"🧠 *Xotiralar soni:* {stats['memory']}\n"
            )
            await message.answer(text, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Error showing stats: {e}", exc_info=True)
        await message.answer("Statistikani yuklashda xatolik yuz berdi.")
