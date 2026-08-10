import json
import logging
import re
from openai import AsyncOpenAI
from config import AI_API_KEY, AI_BASE_URL, AI_MODEL

logger = logging.getLogger(__name__)

# ── Singleton AI client (reused across all messages) ──
_ai_client: AsyncOpenAI | None = None
_ai_model: str = ""
_ai_base_url: str = ""


def _get_ai_client():
    """Return a singleton AsyncOpenAI client with current config."""
    global _ai_client, _ai_model, _ai_base_url
    key = AI_API_KEY
    base_url = AI_BASE_URL
    model = AI_MODEL

    # Auto-detect Gemini key
    if key.strip().startswith("AIzaSy"):
        if "api.openai.com" in base_url or not base_url:
            base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        if model == "gpt-4o-mini" or not model:
            model = "gemini-2.5-flash"

    if _ai_client is None or base_url != _ai_base_url or model != _ai_model:
        _ai_client = AsyncOpenAI(api_key=key, base_url=base_url)
        _ai_model = model
        _ai_base_url = base_url
        logger.info(f"AI client created: base_url={base_url}, model={model}")

    return _ai_client, model


def clean_json_response(text: str) -> str:
    """
    Cleans markdown wrappers and code block formatting from the text
    to extract a valid JSON string, handling incomplete code blocks.
    """
    text = text.strip()
    # Match markdown code block ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        return match.group(1).strip()
    
    # If no closing block, strip leading ```json or ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def parse_robust_json(text: str) -> dict:
    """
    Tries to parse the AI response as JSON.
    If it fails, uses regex to extract individual fields gracefully,
    even if the JSON response was truncated.
    """
    cleaned = clean_json_response(text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError as je:
        logger.warning(f"Standard JSON parsing failed: {je}. Attempting robust regex extraction...")

    # Regex Fallback Extraction
    # 1. Try to extract "reply"
    # Matches "reply": "value" handling double quotes and simple escaping
    reply_match = re.search(r'"reply"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', cleaned)
    reply = ""
    if reply_match:
        reply = reply_match.group(1)
        # Unescape some common JSON characters
        reply = reply.replace('\\"', '"').replace('\\n', '\n').replace('\\t', '\t').replace('\\\\', '\\')
    else:
        # Fallback if quotes are weird or string contains unescaped newlines
        reply_match_fallback = re.search(r'"reply"\s*:\s*"(.*?)"', cleaned, re.DOTALL)
        if reply_match_fallback:
            reply = reply_match_fallback.group(1)
        else:
            # If no reply key is found but we have non-empty text, use the cleaned text as a last resort
            # but strip any outer JSON curly braces if present
            temp_text = cleaned
            if temp_text.startswith('{') and temp_text.endswith('}'):
                temp_text = temp_text[1:-1].strip()
            reply = temp_text

    # 2. Try to extract notify_owner
    notify_match = re.search(r'"notify_owner"\s*:\s*(true|false)', cleaned, re.IGNORECASE)
    notify_owner = False
    if notify_match:
        notify_owner = notify_match.group(1).lower() == "true"
        
    # 3. Try to extract notification
    notification_match = re.search(r'"notification"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
    notification = None
    if notification_match and notification_match.group(1):
        notification = notification_match.group(1).replace('\\"', '"').replace('\\n', '\n')
        
    # 4. Try to extract memory_update fields
    should_save_match = re.search(r'"should_save"\s*:\s*(true|false)', cleaned, re.IGNORECASE)
    should_save = False
    if should_save_match:
        should_save = should_save_match.group(1).lower() == "true"
        
    category_match = re.search(r'"category"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
    category = category_match.group(1) if category_match else None
    
    key_match = re.search(r'"key"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
    key = key_match.group(1) if key_match else None
    
    value_match = re.search(r'"value"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
    value = value_match.group(1) if value_match else None
    
    # 5. Try to extract prompt_update fields
    should_update_match = re.search(r'"should_update"\s*:\s*(true|false)', cleaned, re.IGNORECASE)
    should_update = False
    if should_update_match:
        should_update = should_update_match.group(1).lower() == "true"
        
    new_prompt_match = re.search(r'"new_system_prompt"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|null)', cleaned)
    new_prompt = new_prompt_match.group(1) if new_prompt_match else None

    return {
        "reply": reply,
        "notify_owner": notify_owner,
        "notification": notification,
        "memory_update": {
            "should_save": should_save,
            "category": category,
            "key": key,
            "value": value
        },
        "prompt_update": {
            "should_update": should_update,
            "new_system_prompt": new_prompt
        }
    }

async def generate_response(system_prompt: str, chat_history: list, user_message: str) -> dict:
    """
    Generates response from the AI using OpenAI-compatible client.
    chat_history: list of objects with .role and .content
    user_message: current message content
    """
    if not AI_API_KEY:
        logger.warning("AI_API_KEY topilmadi.")
        return {
            "reply": "",
            "error_msg": "AI API kaliti kiritilmagan!",
            "notify_owner": False,
            "notification": None,
            "memory_update": {"should_save": False, "category": None, "key": None, "value": None}
        }

    ai_client, model = _get_ai_client()

    # Build messages list
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
        parsed_data = parse_robust_json(response_text)
        return parsed_data

    except Exception as e:
        logger.error(f"AI API xatolik: {e}")
        return {
            "reply": "",
            "error_msg": f"AI API xatolik: {str(e)}",
            "notify_owner": False,
            "notification": None,
            "memory_update": {"should_save": False, "category": None, "key": None, "value": None}
        }
