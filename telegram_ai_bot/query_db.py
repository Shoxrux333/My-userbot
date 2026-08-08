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
    else:
        print(json.dumps({"success": False, "error": f"Invalid command or arguments: {cmd}"}))
