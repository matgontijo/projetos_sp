from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import Base, engine
from .routers import ajustes, categorias, empresas, export, projetos, sync

app = FastAPI(title="Fechamento de Projetos — Omie", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    # Cria as tabelas que faltarem (idempotente); Alembic cobre migracoes futuras
    Base.metadata.create_all(bind=engine)


app.include_router(empresas.router)
app.include_router(sync.router)
app.include_router(projetos.router)
app.include_router(categorias.router)
app.include_router(ajustes.router)
app.include_router(export.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
