"""
MetabolicTrack Lab PM — FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.config   import settings
from core.database import engine, Base
from routers import auth, dashboard, purchase_orders, suppliers, consumables
from routers import daily_logs, tasks, budget, kpi, reports, notifications, hr, projects


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables if they don't exist (schema.sql handles full migration)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="MetabolicTrack Lab PM API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS — allow React frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router,            prefix="/auth",           tags=["Auth"])
app.include_router(dashboard.router,       prefix="/dashboard",      tags=["Dashboard"])
app.include_router(purchase_orders.router, prefix="/purchase-orders",tags=["Purchase Orders"])
app.include_router(suppliers.router,       prefix="/suppliers",      tags=["Suppliers"])
app.include_router(consumables.router,     prefix="/consumables",    tags=["Consumables"])
app.include_router(daily_logs.router,      prefix="/daily-logs",     tags=["Daily Logs"])
app.include_router(tasks.router,           prefix="/tasks",          tags=["Tasks"])
app.include_router(budget.router,          prefix="/budget",         tags=["Budget"])
app.include_router(kpi.router,             prefix="/kpi",            tags=["KPI"])
app.include_router(reports.router,         prefix="/reports",        tags=["Reports"])
app.include_router(notifications.router,   prefix="/notifications",  tags=["Notifications"])
app.include_router(hr.router,              prefix="/hr",             tags=["HR"])
app.include_router(projects.router,        prefix="/projects",       tags=["Projects"])


@app.get("/health")
async def health():
    return {"status": "ok", "app": "MetabolicTrack Lab PM"}
