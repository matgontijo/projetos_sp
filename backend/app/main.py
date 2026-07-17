from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .auth import guarda_custeio, usuario_logado
from .config import settings
from .db import Base, engine
from .routers import (
    ajustes,
    analises,
    autenticacao,
    categorias,
    config as config_router,
    empresas,
    export,
    extras,
    precificacao,
    projetos,
    sync,
)
from .routers.empresas import build_omie_client
from .services import agendador

app = FastAPI(title="Fechamento de Projetos — Omie", version="1.0.0")

app.add_middleware(GZipMiddleware, minimum_size=1500)
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
    from .precificacao.seeds import garantir_seeds

    garantir_seeds(engine)
    # Busca automatica diaria (so age se ligada nas preferencias)
    agendador.iniciar(build_omie_client)


# abertas: login/setup (a gestao de usuarios ja exige admin internamente)
app.include_router(autenticacao.router)
app.include_router(autenticacao.router_usuarios)

# custeio: exige sessao e BLOQUEIA o papel 'comercial' (guarda_custeio)
_CUSTEIO = [Depends(guarda_custeio)]
app.include_router(empresas.router, dependencies=_CUSTEIO)
app.include_router(sync.router, dependencies=_CUSTEIO)
app.include_router(projetos.router, dependencies=_CUSTEIO)
app.include_router(categorias.router, dependencies=_CUSTEIO)
app.include_router(ajustes.router, dependencies=_CUSTEIO)
app.include_router(export.router, dependencies=_CUSTEIO)
app.include_router(config_router.router, dependencies=_CUSTEIO)
app.include_router(analises.router, dependencies=_CUSTEIO)
app.include_router(extras.router, dependencies=_CUSTEIO)

# precificacao: admin, financeiro e comercial (guardas internas por rota)
app.include_router(precificacao.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
