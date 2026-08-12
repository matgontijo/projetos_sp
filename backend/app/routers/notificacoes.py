"""Central de notificações: os alertas do fechamento com estado de leitura por pessoa.

Sem fila, sem pipeline de eventos: as notificações SÃO os alertas calculados na
hora (projeto no prejuízo, margem abaixo da meta, custo estourado, categoria sem
classificar) + o resumo da conferência. O que persiste é apenas "quem já viu o
quê" — a chave de cada notificação é um hash estável do conteúdo, então um
alerta que continua valendo continua lido, e um que MUDOU (outro valor, outro
texto) volta como não lido, que é exatamente o comportamento desejado.
"""

import hashlib
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..auth import usuario_logado
from ..db import get_db
from ..services import analises
from .analises import _caixa_cacheado
from .config import obter_config
from .projetos import _empresa_ids, fechamento_anotado, fechamento_cacheado

router = APIRouter(prefix="/api/notificacoes", tags=["notificacoes"])


def chave_de(alerta: dict) -> str:
    """Hash estável do conteúdo: mesmo alerta -> mesma chave entre recomputações."""
    base = f"{alerta.get('titulo', '')}|{alerta.get('detalhe', '')}|{alerta.get('projeto') or ''}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def _montar(db: Session, ids: list[int], de: date | None, ate: date | None) -> list[dict]:
    margem_alvo = float(obter_config(db).get("margem_alvo", 20)) / 100.0
    itens = analises.gerar_alertas(
        db, ids, de, ate, margem_alvo,
        fechamento=fechamento_cacheado(db, ids, de, ate),
        caixa=_caixa_cacheado(db, ids, de, ate),
    )
    # a conferência pendente também é coisa que precisa de atenção
    consolidado = fechamento_anotado(db, ids, de, ate).get("consolidado", {})
    pendentes = consolidado.get("qtd_pendentes", 0) + consolidado.get("qtd_conferidos", 0)
    if pendentes:
        itens = itens + [{
            "gravidade": "atencao",
            "titulo": f"{pendentes} projeto(s) esperando ok da conferência",
            "detalhe": "Abra a lista de projetos filtrada em Pendentes para tocar a fila.",
            "projeto": None,
            "rota": "/projetos?conf=pendente",
        }]
    divergentes = consolidado.get("qtd_divergentes", 0)
    if divergentes:
        itens = itens + [{
            "gravidade": "critica",
            "titulo": f"{divergentes} projeto(s) mudaram depois do ok",
            "detalhe": "Os números conferidos não são mais os atuais — vale conferir de novo.",
            "projeto": None,
            "rota": "/projetos?conf=divergente",
        }]
    return itens


@router.get("")
def listar(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_logado),
):
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"itens": [], "nao_lidas": 0}
    itens = _montar(db, ids, de, ate)
    lidas = set(
        db.scalars(select(models.NotificacaoLida.chave).where(models.NotificacaoLida.usuario_id == usuario.id)).all()
    )
    saida = []
    nao_lidas = 0
    for alerta in itens:
        chave = chave_de(alerta)
        lida = chave in lidas
        if not lida:
            nao_lidas += 1
        saida.append({**alerta, "chave": chave, "lida": lida})
    return {"itens": saida, "nao_lidas": nao_lidas}


class MarcarIn(BaseModel):
    chaves: list[str] = Field(min_length=1, max_length=200)


@router.post("/lidas")
def marcar_lidas(
    payload: MarcarIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_logado),
):
    """Marca como lidas PARA ESTA PESSOA — o resto da equipe continua vendo."""
    existentes = set(
        db.scalars(select(models.NotificacaoLida.chave).where(models.NotificacaoLida.usuario_id == usuario.id)).all()
    )
    for chave in payload.chaves:
        if chave and chave not in existentes:
            db.add(models.NotificacaoLida(usuario_id=usuario.id, chave=chave[:40]))
    db.commit()
    return {"ok": True}
