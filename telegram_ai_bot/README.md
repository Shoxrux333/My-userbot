# Shoxrux Aminboyev - Shaxsiy AI Vakili (Telegram Bot)

Ushbu loyiha Shoxrux Aminboyev nomidan boshqa foydalanuvchilar bilan muloqot qiladigan, uning shaxsiy xotiralariga (SQL-baza) tayanib javob beradigan va muhim suhbatlar haqida unga bildirishnoma (notification) yuboradigan **Sun'iy Intellektli Telegram Bot** hisoblanadi.

## 🚀 Texnologiyalar
- **Python 3.11+**
- **Aiogram 3.x** (Telegram Bot framework, eng oxirgi sintaksisda)
- **SQLAlchemy 2.x (Async)** (Ma'lumotlar bazasi bilan asinxron ishlash)
- **aiosqlite** (Asinxron SQLite drayveri)
- **OpenAI-compatible AI API** (Har qanday OpenAI formatidagi sun'iy intellekt xizmatlari)
- **python-dotenv** (Atrof-muhit o'zgaruvchilarini yuklash)

---

## 📂 Loyiha Strukturasi
```text
telegram_ai_bot/
│
├── bot.py                # Asosiy ishga tushirish fayli
├── config.py             # Sozlamalar va .env o'qish
├── requirements.txt      # Kerakli kutubxonalar
├── .env                  # Maxfiy tokenlar (.gitignore ichida)
├── .gitignore            # Git kuzatmaydigan fayllar
├── README.md             # Loyiha hujjatlari
│
├── database/             # Ma'lumotlar bazasi moduli
│   ├── __init__.py
│   ├── database.py       # DB ulanish (Async engine, Session)
│   ├── models.py         # SQLAlchemy modellari (User, Message, PersonalMemory)
│   └── repositories.py   # Ma'lumotlar ustida amallar (CRUD)
│
├── handlers/             # Telegram xabarlarini qayta ishlash
│   ├── __init__.py
│   ├── start.py          # /start va foydalanuvchilarni ro'yxatdan o'tkazish
│   ├── chat.py           # Foydalanuvchilar va AI suhbati, xotira tahlili
│   └── owner.py          # Shoxrux (Owner) uchun maxsus admin paneli
│
├── keyboards/            # Telegram tugmalari
│   ├── __init__.py
│   └── owner.py          # Admin paneli va bekor qilish tugmalari
│
├── services/             # Tashqi xizmatlar bilan ishlash
│   ├── __init__.py
│   ├── ai.py             # OpenAI-compatible API chaqiruvi va JSON parsi
│   ├── memory.py         # Shaxsiy xotirani yangilash va boshqarish
│   └── notifications.py  # Shoxruxdan qaror talab qilinganda unga xabar yuborish
│
└── prompts/              # Tizim ko'rsatmalari (System Prompt)
    ├── __init__.py
    └── system_prompt.py  # Sun'iy intellektning roli, uslubi va ko'rsatmalari
```

---

## 🛠️ O'rnatish va Ishga Tushirish

### 1. Atrof-muhitni sozlash
`.env` faylini yarating va quyidagi ma'lumotlarni kiriting:
```env
BOT_TOKEN=your_telegram_bot_token_here
AI_API_KEY=your_api_key_here
AI_BASE_URL=https://api.openai.com/v1   # Yoki siz ishlatadigan boshqa xizmat
AI_MODEL=gpt-4o-mini                   # Ishlatmoqchi bo'lgan AI modeli
OWNER_ID=123456789                     # Telegram ID-ingiz (@userinfobot orqali olishingiz mumkin)
MAX_HISTORY_MESSAGES=20
```

### 2. Kutubxonalarni yuklash
```bash
pip install -r requirements.txt
```

### 3. Botni ishga tushirish
```bash
python bot.py
```
*Eslatma: Bot birinchi marta ishga tushganda `bot.db` bazasi va uning jadvallari avtomatik tarzda yaratiladi hamda dastlabki faktlar (Seeding) yuklanadi.*

---

## 🧠 Botning Asosiy Imkoniyatlari

### 1. Shoxruxning AI Vakili Sifatida Suhbatlashish
Suhbatdosh xabar yozganda AI har safar quyidagi ma'lumotlar bilan ta'minlanadi:
`SYSTEM PROMPT + SHAXSIY MEMORY + OXIRGI CHAT HISTORY + FOYDALANUVCHINING MATNI`

### 2. On-the-fly Xotira Qo'shish (Memory Extraction)
Agar Shoxrux botga oddiy muloqot davomida biror yangi ma'lumot aytsa (Masalan: `"Men hozir Ubuntu ishlatyapman"`), AI buni shaxsiy fakt deb tushunadi va bazaga saqlaydi. Agar oddiy foydalanuvchi biror narsa aytsa, u saqlanmaydi.

### 3. Admin Panel (Faqat Owner ko'radi)
- `➕ Ma'lumot qo‘shish`: Yangi ma'lumotni kiritasiz, AI uni avtomatik strukturalab (kategoriya va kalit bilan) bazaga saqlaydi.
- `🧠 Xotiralar`: Shoxrux haqidagi saqlangan barcha ma'lumotlar toifalangan ko'rinishda chiqadi.
- `💬 Suhbatlar`: Oxirgi faol bo'lgan suhbatlar va foydalanuvchilar tarixi ko'rsatiladi.
- `📊 Statistika`: Foydalanuvchilar soni, xabarlar soni va xotiralar statistikasi.

### 4. Shoxruxga Bildirishnomalar
Agarda suhbatdosh:
- Ish, hamkorlik, buyurtma, loyiha, pul va to'lov haqida yozsa;
- Shoxruxdan qaror talab qilinadigan yoki u bilan shaxsan gaplashmoqchi bo'lgan holat bo'lsa;
AI foydalanuvchiga `"Buni Shoxruxga yetkazaman"` deydi va Shoxruxning o'ziga chiroyli formatda bildirishnoma xabarini jo'natadi.
