import sqlite3
import json
import sys
import os

def get_db_path():
    return os.path.join(os.path.dirname(__file__), "bot.db")

def query_users():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, telegram_user_id, username, first_name, last_name, created_at, updated_at FROM users ORDER BY updated_at DESC")
        users = [dict(row) for row in cursor.fetchall()]
        print(json.dumps({"success": True, "users": users}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def query_messages(telegram_user_id):
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT id, telegram_user_id, role, content, created_at FROM messages WHERE telegram_user_id = ? ORDER BY created_at ASC",
            (telegram_user_id,)
        )
        messages = [dict(row) for row in cursor.fetchall()]
        print(json.dumps({"success": True, "messages": messages}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def query_memories():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, category, key, value, created_at, updated_at FROM personal_memory ORDER BY updated_at DESC")
        memories = [dict(row) for row in cursor.fetchall()]
        print(json.dumps({"success": True, "memories": memories}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def delete_memory(memory_id):
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM personal_memory WHERE id = ?", (memory_id,))
        conn.commit()
        print(json.dumps({"success": True, "message": "Memory deleted successfully"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def add_memory(category, key, value):
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO personal_memory (category, key, value, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
            (category, key, value)
        )
        conn.commit()
        print(json.dumps({"success": True, "message": "Memory added successfully"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def fix_message(message_id, new_content):
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE messages SET content = ? WHERE id = ?",
            (new_content, message_id)
        )
        conn.commit()
        print(json.dumps({"success": True, "message": "Message content updated successfully"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def init_settings_db():
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    try:
        cursor.execute("CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT)")
        conn.commit()
    except Exception as e:
        pass
    finally:
        conn.close()

def get_filter_settings():
    init_settings_db()
    
    settings_json_path = os.path.join(os.path.dirname(__file__), "filter_settings.json")
    
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT key, value FROM bot_settings WHERE key IN ('blacklist_enabled', 'blocked_ids', 'group_filter_enabled', 'allowed_group_ids')")
        rows = cursor.fetchall()
        db_settings = {row['key']: row['value'] for row in rows}
        
        # Check if we have complete settings in DB
        has_db_settings = len(db_settings) == 4
        
        blacklist_enabled = False
        blocked_ids = []
        group_filter_enabled = False
        allowed_group_ids = []
        
        if has_db_settings:
            blacklist_enabled = db_settings.get('blacklist_enabled') == 'true'
            group_filter_enabled = db_settings.get('group_filter_enabled') == 'true'
            try:
                blocked_ids = json.loads(db_settings.get('blocked_ids', '[]'))
            except:
                blocked_ids = []
            try:
                allowed_group_ids = json.loads(db_settings.get('allowed_group_ids', '[]'))
            except:
                allowed_group_ids = []
                
            # Self-healing: if filter_settings.json is missing or different, write it
            try:
                settings_obj = {
                    "blacklist_enabled": blacklist_enabled,
                    "blocked_ids": blocked_ids,
                    "group_filter_enabled": group_filter_enabled,
                    "allowed_group_ids": allowed_group_ids
                }
                with open(settings_json_path, "w", encoding="utf-8") as f:
                    json.dump(settings_obj, f, indent=2)
            except Exception as fe:
                pass
        else:
            # If DB is empty, try loading from JSON file
            if os.path.exists(settings_json_path):
                try:
                    with open(settings_json_path, "r", encoding="utf-8") as f:
                        parsed = json.load(f)
                    blacklist_enabled = parsed.get("blacklist_enabled", False)
                    blocked_ids = parsed.get("blocked_ids", [])
                    group_filter_enabled = parsed.get("group_filter_enabled", False)
                    allowed_group_ids = parsed.get("allowed_group_ids", [])
                    
                    # Save to DB so it persists
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blacklist_enabled', ?)", ('true' if blacklist_enabled else 'false',))
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blocked_ids', ?)", (json.dumps(blocked_ids),))
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('group_filter_enabled', ?)", ('true' if group_filter_enabled else 'false',))
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('allowed_group_ids', ?)", (json.dumps(allowed_group_ids),))
                    conn.commit()
                except Exception as je:
                    pass
            else:
                # Completely empty default state, write to both DB and file
                try:
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blacklist_enabled', 'false')")
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blocked_ids', '[]')")
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('group_filter_enabled', 'false')")
                    cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('allowed_group_ids', '[]')")
                    conn.commit()
                    
                    settings_obj = {
                        "blacklist_enabled": False,
                        "blocked_ids": [],
                        "group_filter_enabled": False,
                        "allowed_group_ids": []
                    }
                    with open(settings_json_path, "w", encoding="utf-8") as f:
                        json.dump(settings_obj, f, indent=2)
                except Exception as de:
                    pass
                    
        print(json.dumps({
            "success": True,
            "blacklist_enabled": blacklist_enabled,
            "blocked_ids": blocked_ids,
            "group_filter_enabled": group_filter_enabled,
            "allowed_group_ids": allowed_group_ids
        }))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def save_filter_settings(blacklist_enabled, blocked_ids_json, group_filter_enabled, allowed_group_ids_json):
    init_settings_db()
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    settings_json_path = os.path.join(os.path.dirname(__file__), "filter_settings.json")
    try:
        # Save to DB
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blacklist_enabled', ?)", (blacklist_enabled,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('blocked_ids', ?)", (blocked_ids_json,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('group_filter_enabled', ?)", (group_filter_enabled,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('allowed_group_ids', ?)", (allowed_group_ids_json,))
        conn.commit()
        
        # Parse to save to JSON file as well
        bl_enabled = blacklist_enabled == 'true'
        grp_enabled = group_filter_enabled == 'true'
        try:
            bl_ids = json.loads(blocked_ids_json)
        except:
            bl_ids = []
        try:
            grp_ids = json.loads(allowed_group_ids_json)
        except:
            grp_ids = []
            
        settings_obj = {
            "blacklist_enabled": bl_enabled,
            "blocked_ids": bl_ids,
            "group_filter_enabled": grp_enabled,
            "allowed_group_ids": grp_ids
        }
        with open(settings_json_path, "w", encoding="utf-8") as f:
            json.dump(settings_obj, f, indent=2)
            
        print(json.dumps({"success": True, "message": "Filter settings saved to DB and disk successfully"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def get_bot_config():
    init_settings_db()
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT key, value FROM bot_settings WHERE key IN ('bot_token', 'ai_api_key', 'owner_id', 'ai_base_url', 'ai_model', 'telegram_api_id', 'telegram_api_hash', 'telegram_phone')")
        rows = cursor.fetchall()
        config = {row['key']: row['value'] for row in rows}
        print(json.dumps({"success": True, "config": config}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

def save_bot_config(bot_token, ai_api_key, owner_id, ai_base_url, ai_model, telegram_api_id, telegram_api_hash, telegram_phone):
    init_settings_db()
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('bot_token', ?)", (bot_token,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ai_api_key', ?)", (ai_api_key,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('owner_id', ?)", (owner_id,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ai_base_url', ?)", (ai_base_url,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('ai_model', ?)", (ai_model,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('telegram_api_id', ?)", (telegram_api_id,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('telegram_api_hash', ?)", (telegram_api_hash,))
        cursor.execute("INSERT OR REPLACE INTO bot_settings (key, value) VALUES ('telegram_phone', ?)", (telegram_phone,))
        conn.commit()
        print(json.dumps({"success": True, "message": "Bot configuration saved to DB successfully"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No command specified"}))
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "users":
        query_users()
    elif cmd == "messages" and len(sys.argv) >= 3:
        query_messages(sys.argv[2])
    elif cmd == "memories":
        query_memories()
    elif cmd == "delete_memory" and len(sys.argv) >= 3:
        delete_memory(sys.argv[2])
    elif cmd == "add_memory" and len(sys.argv) >= 5:
        add_memory(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "fix_message" and len(sys.argv) >= 4:
        fix_message(sys.argv[2], sys.argv[3])
    elif cmd == "get_filter_settings":
        get_filter_settings()
    elif cmd == "save_filter_settings" and len(sys.argv) >= 6:
        save_filter_settings(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif cmd == "get_bot_config":
        get_bot_config()
    elif cmd == "save_bot_config" and len(sys.argv) >= 10:
        save_bot_config(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7], sys.argv[8], sys.argv[9])
    else:
        print(json.dumps({"success": False, "error": f"Invalid command or arguments: {cmd}"}))
