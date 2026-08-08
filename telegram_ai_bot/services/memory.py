import logging
from sqlalchemy.ext.asyncio import AsyncSession
from database.repositories import MemoryRepository

logger = logging.getLogger(__name__)

class MemoryService:
    @staticmethod
    async def process_memory_update(session: AsyncSession, memory_update: dict) -> bool:
        """
        Processes memory update from AI response.
        Returns True if a memory was added or updated, False otherwise.
        """
        if not memory_update or not memory_update.get("should_save"):
            return False
            
        category = memory_update.get("category")
        key = memory_update.get("key")
        value = memory_update.get("value")
        
        if not category or not key or not value:
            logger.warning(f"Incomplete memory update parameters: {memory_update}")
            return False
            
        # Clean values
        category = str(category).strip().lower()
        key = str(key).strip().lower()
        value = str(value).strip()
        
        try:
            await MemoryRepository.add_or_update_memory(
                session=session,
                category=category,
                key=key,
                value=value
            )
            logger.info(f"Memory successfully processed and saved. Category: {category}, Key: {key}")
            return True
        except Exception as e:
            logger.error(f"Error saving personal memory: {e}", exc_info=True)
            return False
