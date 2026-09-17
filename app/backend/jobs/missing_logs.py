"""jobs/missing_logs.py — Run by cron at 10am weekdays"""
import asyncio
from sqlalchemy import text
from core.database import AsyncSessionLocal

async def run():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT fn_flag_missing_logs()"))
        flagged = result.scalar_one()
        await db.commit()
        print(f"Missing log check complete. Flagged: {flagged}")

if __name__ == "__main__":
    asyncio.run(run())
