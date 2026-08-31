from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import cache, models
from ..db import get_db
from ..services import analises
from .config import obter_config
from .projetos import _empresa_ids, fechamento_cacheado

router = APIRouter(prefix="/api/analises", tags=["analises"])


def _caixa_cacheado(db: Session, ids: list[int], de: date | None, ate: date | None) -> dict:
    chave = ("caixa", tuple(sorted(ids)), de, ate)
    return cache.obter_ou_computar(chave, lambda: analises.ciclo_de_caixa(db, ids, de, ate))


@router.get("/clientes")
def clientes(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return []
    return analises.ranking_clientes(db, ids, de, ate, fechamento=fechamento_cacheado(db, ids, de, ate))


@router.get("/vendedores")
def vendedores(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"vendedores": [], "receita_sem_vendedor": 0}
    return analises.ranking_vendedores(db, ids, de, ate, fechamento=fechamento_cacheado(db, ids, de, ate))


@router.get("/caixa")
def caixa(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"projetos": [], "totais": {"receber_aberto": 0, "receber_atrasado": 0, "pagar_aberto": 0, "pagar_atrasado": 0}}
    return _caixa_cacheado(db, ids, de, ate)


@router.get("/fluxo")
def fluxo(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    projeto: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"meses": [], "projetos": []}
    return analises.fluxo_mensal(db, ids, de, ate, projeto)


@router.get("/sem-projeto")
def sem_projeto(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"itens": [], "qtd": 0, "totais": {"receber": 0, "pagar": 0, "nfe": 0}}
    return analises.sem_projeto(db, ids, de, ate)


@router.get("/comissoes")
def comissoes(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"vendedores": [], "recebido_sem_vendedor": 0, "total_comissao": 0}
    return analises.comissoes(db, ids, de, ate)


class ComissaoIn(BaseModel):
    vendedor: str = Field(min_length=1, max_length=120)
    pct: float = Field(ge=0, le=50)


@router.put("/comissoes")
def definir_comissao(payload: ComissaoIn, db: Session = Depends(get_db)):
    """Grava o % em TODAS as linhas do vendedor com esse nome (o mesmo vendedor
    existe uma vez por empresa). A guarda global já barra o papel leitura."""
    rows = db.scalars(select(models.Vendedor).where(models.Vendedor.nome == payload.vendedor)).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Vendedor não encontrado")
    for row in rows:
        row.comissao_pct = payload.pct
    db.commit()
    return {"vendedor": payload.vendedor, "pct": payload.pct}


@router.get("/alertas")
def alertas(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return []
    margem_alvo = float(obter_config(db).get("margem_alvo", 20)) / 100.0
    return analises.gerar_alertas(
        db, ids, de, ate, margem_alvo,
        fechamento=fechamento_cacheado(db, ids, de, ate),
        caixa=_caixa_cacheado(db, ids, de, ate),
    )


@router.get("/simulador")
def simulador(
    custo: float = Query(gt=0),
    margem_alvo: float = Query(default=20, ge=0, lt=95, description="em %"),
    preco: float | None = Query(default=None, gt=0),
    comissao: float = Query(default=0, ge=0, le=50, description="% da venda paga de comissão"),
    db: Session = Depends(get_db),
):
    if margem_alvo + comissao >= 95:
        raise HTTPException(status_code=422, detail="Margem + comissão altas demais")
    return analises.simular_preco(db, custo, margem_alvo / 100.0, preco, comissao / 100.0)
