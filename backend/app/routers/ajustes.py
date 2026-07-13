from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..services import calculo

router = APIRouter(prefix="/api/ajustes", tags=["ajustes"])

CAMPOS_TITULO = {"grupo", "codigo_projeto", "excluir"}
CAMPOS_NFE = {"valor_imposto", "codigo_projeto", "excluir"}


def _valor_atual(db: Session, payload: schemas.AjusteCreate) -> str:
    """Resolve o valor vigente do campo para registrar na auditoria."""
    ajustes = calculo.carregar_ajustes(db, [payload.empresa_id])
    vigente = ajustes.get(payload.alvo_tipo, payload.alvo_id, payload.campo)
    if vigente is not None:
        return vigente

    if payload.alvo_tipo == "titulo":
        titulo = db.get(models.Titulo, payload.alvo_id)
        if not titulo or titulo.empresa_id != payload.empresa_id:
            raise HTTPException(status_code=404, detail="Título não encontrado")
        if payload.campo == "grupo":
            grupos = calculo.grupos_por_categoria(db, [payload.empresa_id])
            return grupos.get((payload.empresa_id, titulo.codigo_categoria)) or ""
        if payload.campo == "codigo_projeto":
            return str(titulo.codigo_projeto_omie or 0)
        return "N"

    nfe = db.get(models.NFe, payload.alvo_id)
    if not nfe or nfe.empresa_id != payload.empresa_id:
        raise HTTPException(status_code=404, detail="NF-e não encontrada")
    if payload.campo == "valor_imposto":
        return f"{calculo.imposto_da_nfe(nfe):.2f}"
    if payload.campo == "codigo_projeto":
        return str(nfe.codigo_projeto_omie or 0)
    return "N"


@router.post("", response_model=schemas.AjusteOut, status_code=201)
def criar(payload: schemas.AjusteCreate, db: Session = Depends(get_db), x_usuario: str = Header(default="")):
    if payload.alvo_tipo not in ("titulo", "nfe"):
        raise HTTPException(status_code=422, detail="alvo_tipo deve ser 'titulo' ou 'nfe'")
    campos = CAMPOS_TITULO if payload.alvo_tipo == "titulo" else CAMPOS_NFE
    if payload.campo not in campos:
        raise HTTPException(status_code=422, detail=f"Campo inválido para {payload.alvo_tipo}: {payload.campo}")
    if not db.get(models.Empresa, payload.empresa_id):
        raise HTTPException(status_code=404, detail="Empresa não encontrada")

    ajuste = models.Ajuste(
        empresa_id=payload.empresa_id,
        alvo_tipo=payload.alvo_tipo,
        alvo_id=payload.alvo_id,
        campo=payload.campo,
        valor_anterior=_valor_atual(db, payload),
        valor_novo=payload.valor_novo,
        motivo=payload.motivo,
        usuario=x_usuario or "não identificado",
    )
    db.add(ajuste)
    db.commit()
    db.refresh(ajuste)
    return ajuste


@router.get("", response_model=list[schemas.AjusteOut])
def listar(empresa_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(models.Ajuste).where(models.Ajuste.empresa_id == empresa_id).order_by(models.Ajuste.id.desc())
    ).all()
