"""jobs/compute_kpis.py — Run by cron weekly/monthly"""
import asyncio, sys
from sqlalchemy import text
from core.database import AsyncSessionLocal

async def run(period: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(text("SELECT fn_compute_kpi_actuals(CAST(:p AS kpi_period))"), {"p": period})
        count = result.scalar_one()
        await db.commit()
        print(f"KPI computation complete. Period: {period}. Records: {count}")

if __name__ == "__main__":
    period = sys.argv[1] if len(sys.argv) > 1 else "weekly"
    asyncio.run(run(period))
