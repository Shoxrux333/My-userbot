from aiogram import Router, types
from aiogram.filters import CommandStart
from database.database import AsyncSessionLocal
from database.repositories import UserRepository
from keyboards.owner import get_owner_keyboard
from config import OWNER_ID
import logging

logger = logging.getLogger(__name__)
router = Router(name="start")

@router.message(CommandStart())
async def cmd_start(message: types.Message):
    user_id = message.from_user.id
    username = message.from_user.username
    first_name = message.from_user.first_name
    last_name = message.from_user.last_name

    logger.info(f"Start command received from {user_id} (@{username})")

    try:
        # Register user in DB
        async with AsyncSessionLocal() as session:
            await UserRepository.get_or_create_user(
                session=session,
                telegram_user_id=user_id,
                username=username,
                first_name=first_name,
                last_name=last_name
            )

        if user_id == OWNER_ID:
            await message.answer(
                f"Assalomu alaykum Shoxrux! Siz o'z profilingizdasiz.\n\n"
                "Men sizning shaxsiy AI yordamchingizman. Menga istalgan xabarni, savolni yoki yangi "
                "shaxsiy xotiralarni yozishingiz mumkin (ularni xotiramga saqlab boraman).",
                reply_markup=get_owner_keyboard()
            )
        else:
            await message.answer(
                "Assalomu alaykum! Men Shoxrux Aminboyevning shaxsiy AI vakiliman.\n\n"
                "Sizning savollaringiz, loyihalaringiz yoki hamkorlik takliflaringiz bo'lsa, yozib qoldirishingiz mumkin. "
                "Men xabaringizni tushunib, Shoxruxga tezda yetkazaman!",
                reply_markup=types.ReplyKeyboardRemove()
            )
    except Exception as e:
        logger.error(f"Error handling /start for user {user_id}: {e}", exc_info=True)
        await message.answer("Tizimga kirishda muammo yuz berdi. Iltimos, qaytadan urinib ko'ring.")
