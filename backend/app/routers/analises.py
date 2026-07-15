from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import cache
from ..db import get_db
from ..services import analises
from .config import obter_config
from .projetos import _empresa_ids, fechamento_cacheado

router = APIRouter(prefix="/api/analises", tags=["analises"])


def _caixa_cacheado(db: Session, ids: list[int], de: date | None, ate: date | None) -> dict:
    chave = ("caixa", tuple(sorted(ids)), de, ate)
    resultado = cache.obter(chave)
    if resultado is None:
        resultado = cache.guardar(chave, analises.ciclo_de_caixa(db, ids, de, ate))
    return resultado


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
