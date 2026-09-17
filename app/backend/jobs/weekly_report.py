"""jobs/weekly_report.py — Run by cron every Monday at 6am"""
import asyncio
from sqlalchemy import text
from core.database import AsyncSessionLocal

async def run():
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT fn_generate_weekly_report()"))
        report_id = result.scalar_one()
        await db.commit()
        print(f"Weekly report generated. ID: {report_id}")

if __name__ == "__main__":
    asyncio.run(run())
