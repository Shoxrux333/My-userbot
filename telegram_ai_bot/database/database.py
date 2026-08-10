from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from config import DATABASE_URL

# SQLite optimizatsiyalari:
# - WAL mode: o'qish/yozish parallel ishlaydi (blocking kamayadi)
# - pool_size=5, max_overflow=3: bir vaqtda ko'p so'rovlar uchun
# - pool_recycle=300: 5 daqiqada connectionni yangilash (stale oldini olish)
# - cache_size=64MB, synchronous=NORMAL: SQLite performance
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=3,
    pool_recycle=300,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        # Jadval yaratish
        await conn.run_sync(Base.metadata.create_all)
        # SQLite performance optimizatsiyalari
        await conn.execute(text('PRAGMA journal_mode=WAL'))
        await conn.execute(text('PRAGMA synchronous=NORMAL'))
        await conn.execute(text('PRAGMA cache_size=-64000'))  # 64MB cache
