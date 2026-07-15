from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db

router = APIRouter(prefix="/api/config", tags=["config"])

PADROES = {
    "margem_alvo": "20",       # % de margem que define o semaforo
    "sync_auto": "0",          # 1 = busca automatica diaria ligada
    "sync_hora": "5",          # hora local do servidor para a busca automatica
}


def obter_config(db: Session) -> dict:
    valores = dict(PADROES)
    for row in db.scalars(select(models.Configuracao)).all():
        valores[row.chave] = row.valor
    return valores


class ConfigIn(BaseModel):
    margem_alvo: float | None = Field(default=None, ge=0, le=95)
    sync_auto: bool | None = None
    sync_hora: int | None = Field(default=None, ge=0, le=23)


@router.get("")
def ler(db: Session = Depends(get_db)):
    valores = obter_config(db)
    return {
        "margem_alvo": float(valores["margem_alvo"]),
        "sync_auto": valores["sync_auto"] == "1",
        "sync_hora": int(valores["sync_hora"]),
    }


@router.put("")
def salvar(payload: ConfigIn, db: Session = Depends(get_db)):
    novos = {}
    if payload.margem_alvo is not None:
        novos["margem_alvo"] = str(payload.margem_alvo)
    if payload.sync_auto is not None:
        novos["sync_auto"] = "1" if payload.sync_auto else "0"
    if payload.sync_hora is not None:
        novos["sync_hora"] = str(payload.sync_hora)
    for chave, valor in novos.items():
        row = db.get(models.Configuracao, chave)
        if row is None:
            db.add(models.Configuracao(chave=chave, valor=valor))
        else:
            row.valor = valor
    db.commit()
    return ler(db)
