from aiogram.types import ReplyKeyboardRemove, ReplyKeyboardMarkup
from aiogram.utils.keyboard import ReplyKeyboardBuilder

def get_owner_keyboard() -> ReplyKeyboardRemove:
    """
    Clears the main reply keyboard for the owner since administrative controls are now purely on the website.
    """
    return ReplyKeyboardRemove()

def get_cancel_keyboard() -> ReplyKeyboardRemove:
    """
    Clears the keyboard as well.
    """
    return ReplyKeyboardRemove()

