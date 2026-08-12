"""Backup do trabalho humano — exportar (download) e restaurar (upload). Só admin."""

import json
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import cache, models
from ..auth import exigir_admin
from ..db import get_db
from ..services import backup as backup_svc

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(exigir_admin)])


@router.get("")
def exportar(db: Session = Depends(get_db)):
    dados = backup_svc.exportar(db)
    nome = f"custeio_backup_{datetime.now().strftime('%Y-%m-%d_%H%M')}.json"
    # Arquivo sensível (hashes de senha + credenciais Omie criptografadas):
    # no-store impede o navegador/proxy de guardar uma cópia em cache.
    return Response(
        content=json.dumps(dados, ensure_ascii=False, indent=1).encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{nome}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/restaurar")
def restaurar(
    dados: dict = Body(...),
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(exigir_admin),
):
    try:
        resumo = backup_svc.restaurar(db, dados)
    except ValueError as erro:
        raise HTTPException(status_code=422, detail=str(erro)) from erro
    cache.invalidar()  # ajustes/conferências restaurados mudam o fechamento
    return resumo
