from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import usuario_logado
from ..db import get_db
from ..schemas import GRUPOS_VALIDOS
from ..services import calculo

router = APIRouter(prefix="/api/ajustes", tags=["ajustes"])

CAMPOS_TITULO = {"grupo", "codigo_projeto", "excluir"}
CAMPOS_NFE = {"valor_imposto", "codigo_projeto", "excluir"}


def _validar_valor_novo(db: Session, payload: schemas.AjusteCreate) -> str:
    """Valida o valor por campo; evita ajustes no-op ou 'projeto fantasma'."""
    valor = payload.valor_novo.strip()
    if payload.campo == "codigo_projeto":
        try:
            codigo = int(valor)
        except ValueError:
            raise HTTPException(status_code=422, detail="codigo_projeto deve ser um número (0 = sem projeto)")
        if codigo != 0:
            existe = db.scalar(
                select(models.Projeto.id).where(
                    models.Projeto.empresa_id == payload.empresa_id,
                    models.Projeto.codigo_omie == codigo,
                )
            )
            if not existe:
                raise HTTPException(
                    status_code=422,
                    detail=f"Projeto de código {codigo} não existe nesta empresa (sincronize ou confira o código)",
                )
        return str(codigo)
    if payload.campo == "grupo":
        if valor not in GRUPOS_VALIDOS:
            raise HTTPException(status_code=422, detail=f"Grupo inválido: {valor}")
        return valor
    if payload.campo == "excluir":
        if valor.upper() not in ("S", "N"):
            raise HTTPException(status_code=422, detail="excluir deve ser 'S' ou 'N'")
        return valor.upper()
    if payload.campo == "valor_imposto":
        try:
            float(valor.replace(",", "."))
        except ValueError:
            raise HTTPException(status_code=422, detail="valor_imposto deve ser numérico")
        return valor
    return valor


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
def criar(
    payload: schemas.AjusteCreate,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_logado),
):
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
        valor_novo=_validar_valor_novo(db, payload),
        motivo=payload.motivo,
        usuario=usuario.nome,
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
