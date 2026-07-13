from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db
from ..services.sync import executar_sync_empresa
from .empresas import build_omie_client

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("", status_code=202)
def iniciar_sync(payload: schemas.SyncRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    if payload.data_de > payload.data_ate:
        raise HTTPException(status_code=422, detail="data_de deve ser anterior a data_ate")
    empresas = db.scalars(select(models.Empresa).where(models.Empresa.id.in_(payload.empresa_ids))).all()
    if len(empresas) != len(set(payload.empresa_ids)):
        raise HTTPException(status_code=404, detail="Alguma empresa informada não existe")
    for empresa in empresas:
        background.add_task(
            executar_sync_empresa, empresa.id, payload.data_de, payload.data_ate, build_omie_client
        )
    return {"iniciado": True, "empresas": [e.id for e in empresas]}


@router.get("/logs", response_model=list[schemas.SyncLogOut])
def listar_logs(empresa_id: int | None = None, limit: int = 60, db: Session = Depends(get_db)):
    query = select(models.SyncLog).order_by(models.SyncLog.id.desc()).limit(min(limit, 200))
    if empresa_id:
        query = query.where(models.SyncLog.empresa_id == empresa_id)
    return db.scalars(query).all()
