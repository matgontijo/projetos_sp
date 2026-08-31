from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..db import get_db
from ..marca import LINHA1, LINHA2, NOME

router = APIRouter(prefix="/api/config", tags=["config"])

# Aberto (sem login): a tela de entrada precisa saber que marca desenhar.
# So expoe o nome — nenhum dado do negocio passa por aqui.
router_marca = APIRouter(prefix="/api/marca", tags=["config"])


@router_marca.get("")
def marca():
    return {"linha1": LINHA1, "linha2": LINHA2, "nome": NOME}


PADROES = {
    "margem_alvo": "20",       # % de margem que define o semaforo
    "sync_auto": "0",          # 1 = busca automatica diaria ligada
    "sync_hora": "5",          # hora local do servidor para a busca automatica
    "relatorio_auto": "0",     # 1 = fechamento do mes anterior por e-mail
    "relatorio_dia": "1",      # dia do mes em que o relatorio sai
    "relatorio_emails": "",    # destinatarios separados por virgula
    "backup_auto": "0",        # 1 = backup mensal por e-mail (so p/ SUPORTE_EMAIL)
    "backup_dia": "1",
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
    relatorio_auto: bool | None = None
    # ate 28 para existir em todo mes (fevereiro inclusive)
    relatorio_dia: int | None = Field(default=None, ge=1, le=28)
    relatorio_emails: str | None = Field(default=None, max_length=500)
    backup_auto: bool | None = None
    backup_dia: int | None = Field(default=None, ge=1, le=28)


@router.get("")
def ler(db: Session = Depends(get_db)):
    valores = obter_config(db)
    return {
        "margem_alvo": float(valores["margem_alvo"]),
        "sync_auto": valores["sync_auto"] == "1",
        "sync_hora": int(valores["sync_hora"]),
        "relatorio_auto": valores["relatorio_auto"] == "1",
        "relatorio_dia": int(valores["relatorio_dia"] or 1),
        "relatorio_emails": valores["relatorio_emails"],
        "backup_auto": valores["backup_auto"] == "1",
        "backup_dia": int(valores["backup_dia"] or 1),
        "backup_destino": settings.suporte_email.strip(),
        # sem SMTP o relatorio nao tem como sair — o front avisa em vez de fingir
        "email_configurado": bool(settings.smtp_host and settings.smtp_user),
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
    if payload.relatorio_auto is not None:
        novos["relatorio_auto"] = "1" if payload.relatorio_auto else "0"
    if payload.relatorio_dia is not None:
        novos["relatorio_dia"] = str(payload.relatorio_dia)
    if payload.relatorio_emails is not None:
        novos["relatorio_emails"] = payload.relatorio_emails.strip()
    if payload.backup_auto is not None:
        novos["backup_auto"] = "1" if payload.backup_auto else "0"
    if payload.backup_dia is not None:
        novos["backup_dia"] = str(payload.backup_dia)
    for chave, valor in novos.items():
        row = db.get(models.Configuracao, chave)
        if row is None:
            db.add(models.Configuracao(chave=chave, valor=valor))
        else:
            row.valor = valor
    db.commit()
    return ler(db)
