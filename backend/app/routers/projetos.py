from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..services import calculo

router = APIRouter(prefix="/api", tags=["projetos"])


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
        return {"projetos": [], "consolidado": {"receita": 0, "custo_total": 0, "resultado": 0, "margem_media": 0, "qtd_projetos": 0, "imposto": 0, "producao": 0, "frete": 0, "outros": 0, "cp_impostos": 0, "nao_classificado": 0}}
    return calculo.fechar_projetos(db, ids, de, ate)


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
    return calculo.detalhe_projeto(db, ids, nome, de, ate)
