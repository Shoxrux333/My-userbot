from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from database.models import User, Message, PersonalMemory
from datetime import datetime


class UserRepository:
    @staticmethod
    async def get_or_create_user(
        session: AsyncSession,
        telegram_user_id: int,
        username: str = None,
        first_name: str = None,
        last_name: str = None
    ) -> User:
        stmt = select(User).where(User.telegram_user_id == telegram_user_id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            user = User(
                telegram_user_id=telegram_user_id,
                username=username,
                first_name=first_name,
                last_name=last_name
            )
            session.add(user)
            # commit() tashqi tomondan qilinadi (bot.py da)
        else:
            # Faqat o'zgargan bo'lsa update qilamiz (ortiqcha commit yo'q)
            changed = False
            if user.username != username:
                user.username = username
                changed = True
            if user.first_name != first_name:
                user.first_name = first_name
                changed = True
            if user.last_name != last_name:
                user.last_name = last_name
                changed = True
            if changed:
                user.updated_at = datetime.utcnow()
        return user


class MessageRepository:
    @staticmethod
    async def save_message(
        session: AsyncSession,
        telegram_user_id: int,
        role: str,
        content: str
    ) -> Message:
        message = Message(
            telegram_user_id=telegram_user_id,
            role=role,
            content=content
        )
        session.add(message)
        # commit() tashqi tomondan yoki kerak joyda qilinadi
        return message

    @staticmethod
    async def get_chat_history(
        session: AsyncSession,
        telegram_user_id: int,
        limit: int = 20
    ):
        stmt = (
            select(Message)
            .where(Message.telegram_user_id == telegram_user_id)
            .order_by(desc(Message.created_at))
            .limit(limit)
        )
        result = await session.execute(stmt)
        messages = result.scalars().all()
        return list(reversed(messages))


class MemoryRepository:
    _cache = {
        "text": None,
        "count": 0,
    }
    _cache_ttl = 30.0  # 30 soniya
    _last_fetch: float = 0.0

    @classmethod
    def invalidate_cache(cls):
        """Xotira o'zgarganda cache'ni tozalash."""
        cls._cache["text"] = None
        cls._cache["count"] = 0

    @staticmethod
    async def get_all_memories(session: AsyncSession):
        stmt = select(PersonalMemory).order_by(PersonalMemory.category, PersonalMemory.key)
        result = await session.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def add_or_update_memory(
        session: AsyncSession,
        category: str,
        key: str,
        value: str
    ) -> PersonalMemory:
        stmt = select(PersonalMemory).where(
            (PersonalMemory.category == category) & 
            (PersonalMemory.key == key)
        )
        result = await session.execute(stmt)
        memory = result.scalar_one_or_none()

        if memory:
            memory.value = value
            memory.updated_at = datetime.utcnow()
        else:
            memory = PersonalMemory(
                category=category,
                key=key,
                value=value
            )
            session.add(memory)
        
        await session.commit()
        # Xotira o'zgargandan keyin cache'ni tozalash
        MemoryRepository.invalidate_cache()
        await session.refresh(memory)
        return memory

    @staticmethod
    async def get_memories_text(session: AsyncSession) -> str:
        import time
        now = time.monotonic()
        cache = MemoryRepository._cache

        # Cache hali yaroqlimi?
        if cache["text"] is not None and (now - MemoryRepository._last_fetch) < MemoryRepository._cache_ttl:
            return cache["text"]

        # DB dan yangilash
        memories = await MemoryRepository.get_all_memories(session)
        if not memories:
            result = "Shoxrux haqida shaxsiy xotiralar bazada hali mavjud emas."
        else:
            grouped = {}
            for m in memories:
                cat = m.category.capitalize()
                if cat not in grouped:
                    grouped[cat] = []
                grouped[cat].append(f"\u2022 {m.value}")
            
            text_parts = []
            for cat, items in grouped.items():
                text_parts.append(f"{cat}:")
                text_parts.extend(items)
                text_parts.append("")
            result = "\n".join(text_parts).strip()

        # Cache'ga saqlash
        cache["text"] = result
        cache["count"] = len(memories) if memories else 0
        MemoryRepository._last_fetch = now
        return result


class StatsRepository:
    @staticmethod
    async def get_stats(session: AsyncSession) -> dict:
        # Bitta so'rovda barcha statistikani olish (optimizatsiya)
        stmt_users = select(func.count(User.id))
        res_users = await session.execute(stmt_users)
        users_count = res_users.scalar() or 0

        stmt_msgs = select(func.count(Message.id))
        res_msgs = await session.execute(stmt_msgs)
        msgs_count = res_msgs.scalar() or 0

        stmt_mem = select(func.count(PersonalMemory.id))
        res_mem = await session.execute(stmt_mem)
        mem_count = res_mem.scalar() or 0

        stmt_ai = select(func.count(Message.id)).where(Message.role == "assistant")
        res_ai = await session.execute(stmt_ai)
        ai_count = res_ai.scalar() or 0

        return {
            "users": users_count,
            "messages": msgs_count,
            "memory": mem_count,
            "ai": ai_count
        }

    @staticmethod
    async def get_recent_conversations(session: AsyncSession, limit: int = 10):
        stmt = (
            select(Message, User)
            .join(User, User.telegram_user_id == Message.telegram_user_id)
            .order_by(desc(Message.created_at))
            .limit(limit * 2)
        )
        result = await session.execute(stmt)
        rows = result.all()
        
        chats = []
        seen_users = set()
        
        for msg, user in rows:
            if user.telegram_user_id not in seen_users:
                seen_users.add(user.telegram_user_id)
                hist_stmt = (
                    select(Message)
                    .where(Message.telegram_user_id == user.telegram_user_id)
                    .order_by(desc(Message.created_at))
                    .limit(4)
                )
                hist_res = await session.execute(hist_stmt)
                hist_msgs = list(reversed(hist_res.scalars().all()))
                
                chats.append({
                    "user": user,
                    "history": hist_msgs,
                    "last_active": msg.created_at
                })
                
                if len(chats) >= limit:
                    break
        return chats
