from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import Base, engine
from .routers import ajustes, analises, categorias, config as config_router, empresas, export, extras, projetos, sync
from .routers.empresas import build_omie_client
from .services import agendador

app = FastAPI(title="Fechamento de Projetos — Omie", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    # Cria as tabelas que faltarem (idempotente) e repara colunas aditivas —
    # em producao nao ha Alembic, entao o app cuida do proprio schema
    Base.metadata.create_all(bind=engine)
    from .bootstrap import garantir_colunas

    garantir_colunas(engine)
    # Busca automatica diaria (so age se ligada nas preferencias)
    agendador.iniciar(build_omie_client)


app.include_router(empresas.router)
app.include_router(sync.router)
app.include_router(projetos.router)
app.include_router(categorias.router)
app.include_router(ajustes.router)
app.include_router(export.router)
app.include_router(config_router.router)
app.include_router(analises.router)
app.include_router(extras.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
