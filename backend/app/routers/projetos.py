from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import cache, models
from ..db import get_db
from ..services import calculo, conferencia

router = APIRouter(prefix="/api", tags=["projetos"])


def fechamento_cacheado(db: Session, ids: list[int], de: date | None, ate: date | None) -> dict:
    chave = ("fechamento", tuple(sorted(ids)), de, ate)
    return cache.obter_ou_computar(chave, lambda: calculo.fechar_projetos(db, ids, de, ate))


def fechamento_anotado(db: Session, ids: list[int], de: date | None, ate: date | None) -> dict:
    """Fechamento + status da dupla conferencia.

    A anotacao fica FORA do cache de proposito: dar um ok nao mexe nos numeros,
    entao nao invalida o fechamento — mas o status precisa aparecer na hora.
    """
    return conferencia.anotar_fechamento(db, fechamento_cacheado(db, ids, de, ate))


def _empresa_ids(db: Session, empresa_ids: str | None) -> list[int]:
    if empresa_ids:
        try:
            ids = [int(x) for x in empresa_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="empresa_ids deve ser lista de inteiros separada por vírgula")
        if ids:
            return ids
    return list(db.scalars(select(models.Empresa.id).where(models.Empresa.ativa)).all())


@router.get("/fechamento")
def fechamento(
    empresa_ids: str | None = Query(default=None, description="ids separados por vírgula; vazio = todas ativas"),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"projetos": [], "consolidado": {"receita": 0, "custo_total": 0, "resultado": 0, "margem_media": 0, "qtd_projetos": 0, "imposto": 0, "producao": 0, "frete": 0, "comissao": 0, "outros": 0, "cp_impostos": 0, "nao_classificado": 0, "qtd_pendentes": 0, "qtd_conferidos": 0, "qtd_aprovados": 0, "qtd_divergentes": 0}}
    return fechamento_anotado(db, ids, de, ate)


@router.get("/fechamento/mensal")
def fechamento_mensal(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return []
    chave = ("mensal", tuple(sorted(ids)), de, ate)
    return cache.obter_ou_computar(chave, lambda: calculo.serie_mensal(db, ids, de, ate))


@router.get("/projetos/detalhe")
def detalhe(
    nome: str = Query(min_length=1, description="número do projeto (ex.: BR26_055) ou 'Sem projeto'"),
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        raise HTTPException(status_code=404, detail="Nenhuma empresa ativa")
    fechamento = fechamento_anotado(db, ids, de, ate)
    resposta = calculo.detalhe_projeto(db, ids, nome, de, ate, fechamento=fechamento)

    # Nota conjunta: se este projeto faz parte de um grupo de BRs faturados
    # juntos, a tela precisa contar isso — senao o numero individual engana.
    from ..services.analises import agrupar_por_br

    chave = calculo.chave_projeto(nome)
    for g in agrupar_por_br(fechamento["projetos"]):
        if g["qtd_membros"] > 1 and any(calculo.chave_projeto(m) == chave for m in g["membros"]):
            resposta["grupo_br"] = {
                "membros": [m for m in g["membros"] if calculo.chave_projeto(m) != chave],
                "receita": g["receita"],
                "resultado": g["resultado"],
                "margem": g["margem"],
            }
            break
    return resposta
