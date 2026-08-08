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
            await session.commit()
            await session.refresh(user)
        else:
            # Update info if changed
            if (user.username != username or 
                user.first_name != first_name or 
                user.last_name != last_name):
                user.username = username
                user.first_name = first_name
                user.last_name = last_name
                user.updated_at = datetime.utcnow()
                await session.commit()
                await session.refresh(user)
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
        await session.commit()
        await session.refresh(message)
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
        # Return in chronological order
        return list(reversed(messages))

class MemoryRepository:
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
        await session.refresh(memory)
        return memory

    @staticmethod
    async def get_memories_text(session: AsyncSession) -> str:
        memories = await MemoryRepository.get_all_memories(session)
        if not memories:
            return "Shoxrux haqida shaxsiy xotiralar bazada hali mavjud emas."
        
        # Group by category
        grouped = {}
        for m in memories:
            cat = m.category.capitalize()
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append(f"• {m.value}")
        
        text_parts = []
        for cat, items in grouped.items():
            text_parts.append(f"{cat}:")
            text_parts.extend(items)
            text_parts.append("") # Empty line
        
        return "\n".join(text_parts).strip()

class StatsRepository:
    @staticmethod
    async def get_stats(session: AsyncSession) -> dict:
        # Get users count
        stmt_users = select(func.count(User.id))
        res_users = await session.execute(stmt_users)
        users_count = res_users.scalar() or 0

        # Get total messages count
        stmt_msgs = select(func.count(Message.id))
        res_msgs = await session.execute(stmt_msgs)
        msgs_count = res_msgs.scalar() or 0

        # Get personal memory count
        stmt_mem = select(func.count(PersonalMemory.id))
        res_mem = await session.execute(stmt_mem)
        mem_count = res_mem.scalar() or 0

        # Get AI responses count (messages with role == 'assistant')
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
        # Fetch recent messages with unique telegram_user_id along with user usernames
        stmt = (
            select(Message, User)
            .join(User, User.telegram_user_id == Message.telegram_user_id)
            .order_by(desc(Message.created_at))
            .limit(limit * 2) # Fetch enough messages
        )
        result = await session.execute(stmt)
        rows = result.all()
        
        # Group messages by user
        chats = []
        seen_users = set()
        
        for msg, user in rows:
            if user.telegram_user_id not in seen_users:
                seen_users.add(user.telegram_user_id)
                # Fetch recent history for this specific user
                hist_stmt = (
                    select(Message)
                    .where(Message.telegram_user_id == user.telegram_user_id)
                    .order_by(desc(Message.created_at))
                    .limit(4) # Last 4 messages for preview
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
