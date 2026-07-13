from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..schemas import GRUPOS_VALIDOS

router = APIRouter(prefix="/api/categorias", tags=["categorias"])


@router.get("", response_model=list[schemas.CategoriaGrupoOut])
def listar(empresa_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(models.CategoriaGrupo)
        .where(models.CategoriaGrupo.empresa_id == empresa_id)
        .order_by(models.CategoriaGrupo.descricao)
    ).all()


@router.put("/{empresa_id}", response_model=list[schemas.CategoriaGrupoOut])
def atualizar(
    empresa_id: int,
    payload: list[schemas.CategoriaGrupoUpdate],
    db: Session = Depends(get_db),
    x_usuario: str = Header(default=""),
):
    if not db.get(models.Empresa, empresa_id):
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    for item in payload:
        if item.grupo is not None and item.grupo not in GRUPOS_VALIDOS:
            raise HTTPException(status_code=422, detail=f"Grupo inválido: {item.grupo}")
        row = db.scalar(
            select(models.CategoriaGrupo).where(
                models.CategoriaGrupo.empresa_id == empresa_id,
                models.CategoriaGrupo.codigo_categoria == item.codigo_categoria,
            )
        )
        if row is None:
            row = models.CategoriaGrupo(empresa_id=empresa_id, codigo_categoria=item.codigo_categoria)
            db.add(row)
        row.grupo = item.grupo
        row.atualizado_por = x_usuario or "não identificado"
    db.commit()
    return listar(empresa_id, db)
