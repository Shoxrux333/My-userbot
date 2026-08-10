import json
import logging
import re
from openai import AsyncOpenAI
from config import AI_API_KEY, AI_BASE_URL, AI_MODEL

logger = logging.getLogger(__name__)

# --- AI client'ni har safar yaratish o'rniga bir marta saqlaymiz ---
_ai_client: AsyncOpenAI | None = None
_ai_client_key: str = ""
_ai_client_base: str = ""
_ai_client_model: str = ""


def _get_ai_client():
    """
    AI client'ni cache qiladi. API key o'zgarmaganda bir xil client ishlatiladi.
    Har safar AsyncOpenAI() yaratish — TCP connection ochishni talab qiladi, bu sekin.
    """
    global _ai_client, _ai_client_key, _ai_client_base, _ai_client_model

    api_key = AI_API_KEY
    if not api_key:
        return None, None, None

    base_url = AI_BASE_URL
    model = AI_MODEL

    # Auto-detect Google Gemini
    if api_key.strip().startswith("AIzaSy"):
        if "api.openai.com" in base_url or not base_url:
            base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        if model == "gpt-4o-mini" or not model:
            model = "gemini-2.5-flash"

    # Key o'zgarganmi tekshiramiz
    if _ai_client is not None and _ai_client_key == api_key and _ai_client_base == base_url:
        return _ai_client, base_url, model

    _ai_client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    _ai_client_key = api_key
    _ai_client_base = base_url
    _ai_client_model = model

    logger.info(f"AI client yangilandi: base_url={base_url}, model={model}")
    return _ai_client, base_url, model


def clean_json_response(text: str) -> str:
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        return match.group(1).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def parse_robust_json(text: str) -> dict:
    cleaned = clean_json_response(text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError as je:
        logger.warning(f"JSON parsing failed: {je}. Trying regex extraction...")

    # Regex Fallback
    reply = ""
    reply_match = re.search(r'"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', cleaned)
    if reply_match:
        reply = reply_match.group(1)
        reply = reply.replace('\"', '"').replace('\\n', '\n').replace('\\t', '\t').replace('\\\\', '\\')
    else:
        fb = re.search(r'"reply"\s*:\s*"(.*?)"', cleaned, re.DOTALL)
        if fb:
            reply = fb.group(1)
        else:
            temp = cleaned
            if temp.startswith('{') and temp.endswith('}'):
                temp = temp[1:-1].strip()
            reply = temp

    def extract_bool(pattern, text):
        m = re.search(pattern, text, re.IGNORECASE)
        return m.group(1).lower() == "true" if m else False

    def extract_str(pattern, text):
        m = re.search(pattern, text)
        if m and m.group(1):
            return m.group(1).replace('\"', '"').replace('\\n', '\n')
        return None

    return {
        "reply": reply,
        "notify_owner": extract_bool(r'"notify_owner"\s*:\s*(true|false)', cleaned),
        "notification": extract_str(r'"notification"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned),
        "memory_update": {
            "should_save": extract_bool(r'"should_save"\s*:\s*(true|false)', cleaned),
            "category": extract_str(r'"category"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned),
            "key": extract_str(r'"key"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned),
            "value": extract_str(r'"value"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
        },
        "prompt_update": {
            "should_update": extract_bool(r'"should_update"\s*:\s*(true|false)', cleaned),
            "new_system_prompt": extract_str(r'"new_system_prompt"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
        }
    }


async def generate_response(system_prompt: str, chat_history: list, user_message: str) -> dict:
    if not AI_API_KEY:
        return {
            "reply": "",
            "error_msg": "AI_API_KEY kiritilmagan!",
            "notify_owner": False,
            "notification": None,
            "memory_update": {"should_save": False, "category": None, "key": None, "value": None}
        }

    ai_client, base_url, model = _get_ai_client()
    if not ai_client:
        return {
            "reply": "",
            "error_msg": "AI client yaratilmadi.",
            "notify_owner": False,
            "notification": None,
            "memory_update": {"should_save": False, "category": None, "key": None, "value": None}
        }

    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    for msg in chat_history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": user_message})

    try:
        response = await ai_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.7,
            max_tokens=1500,
        )
        response_text = response.choices[0].message.content
        return parse_robust_json(response_text)
    except Exception as e:
        logger.error(f"AI API xatolik: {e}", exc_info=True)
        return {
            "reply": "",
            "error_msg": f"AI API xatolik: {str(e)}",
            "notify_owner": False,
            "notification": None,
            "memory_update": {"should_save": False, "category": None, "key": None, "value": None}
        }
