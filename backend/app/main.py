from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .auth import usuario_logado
from .config import settings
from .db import Base, engine
from .routers import ajustes, analises, autenticacao, categorias, config as config_router, empresas, export, extras, projetos, sync
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
    # Busca automatica diaria (so age se ligada nas preferencias)
    agendador.iniciar(build_omie_client)


# abertas: login/setup (a gestao de usuarios ja exige admin internamente)
app.include_router(autenticacao.router)
app.include_router(autenticacao.router_usuarios)

# todas as demais rotas exigem sessao valida (papel 'leitura' nao escreve)
_PROTEGIDO = [Depends(usuario_logado)]
app.include_router(empresas.router, dependencies=_PROTEGIDO)
app.include_router(sync.router, dependencies=_PROTEGIDO)
app.include_router(projetos.router, dependencies=_PROTEGIDO)
app.include_router(categorias.router, dependencies=_PROTEGIDO)
app.include_router(ajustes.router, dependencies=_PROTEGIDO)
app.include_router(export.router, dependencies=_PROTEGIDO)
app.include_router(config_router.router, dependencies=_PROTEGIDO)
app.include_router(analises.router, dependencies=_PROTEGIDO)
app.include_router(extras.router, dependencies=_PROTEGIDO)


@app.get("/api/health")
def health():
    return {"status": "ok"}
