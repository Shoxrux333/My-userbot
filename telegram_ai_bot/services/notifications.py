import logging
from aiogram import Bot
from config import OWNER_ID

logger = logging.getLogger(__name__)

class NotificationService:
    @staticmethod
    async def notify_owner(
        bot: Bot,
        user_fullname: str,
        user_username: str,
        notification_text: str
    ) -> bool:
        """
        Sends a notification to the owner about an important message.
        """
        if not OWNER_ID:
            logger.warning("OWNER_ID is not configured. Cannot send notification.")
            return False
            
        username_str = f"@{user_username}" if user_username else "username yo'q"
        
        message_text = (
            f"📩 *Sizga yangi muhim xabar keldi*\n\n"
            f"👤 *Foydalanuvchi:* {user_fullname} ({username_str})\n\n"
            f"💬 *Tafsilotlar:* {notification_text}"
        )
        
        try:
            await bot.send_message(
                chat_id=OWNER_ID,
                text=message_text,
                parse_mode="Markdown"
            )
            logger.info(f"Notification successfully sent to owner {OWNER_ID}")
            return True
        except Exception as e:
            logger.error(f"Failed to send notification to owner {OWNER_ID}: {e}", exc_info=True)
            return False
