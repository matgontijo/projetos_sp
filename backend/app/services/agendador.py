"""Busca automatica diaria: thread leve que dispara a sincronizacao de todas as
empresas ativas na hora configurada (config sync_auto/sync_hora).

Observacao de hospedagem: em planos gratuitos que hibernam (Render free), a
thread so roda enquanto o servico esta acordado — em plano pago roda sempre.
"""

import logging
import threading
import time
from datetime import date, datetime, timedelta

from sqlalchemy import select

from .. import models
from ..db import SessionLocal
from .sync import executar_sync_empresa

logger = logging.getLogger(__name__)

_INTERVALO_CHECAGEM = 60  # segundos


def _rodada(build_client) -> None:
    db = SessionLocal()
    try:
        config = {c.chave: c.valor for c in db.scalars(select(models.Configuracao)).all()}
        if config.get("sync_auto", "0") != "1":
            return
        hora = int(config.get("sync_hora", "5") or 5)
        agora = datetime.now()
        hoje = agora.date().isoformat()
        if agora.hour < hora or config.get("ultimo_sync_auto") == hoje:
            return

        # marca antes de rodar para nao disparar duas vezes se demorar
        marcador = db.get(models.Configuracao, "ultimo_sync_auto")
        if marcador is None:
            db.add(models.Configuracao(chave="ultimo_sync_auto", valor=hoje))
        else:
            marcador.valor = hoje
        db.commit()

        ids = list(db.scalars(select(models.Empresa.id).where(models.Empresa.ativa)).all())
        de = date(date.today().year - 1, 1, 1)  # ano anterior inteiro (base do Simples)
        ate = date.today() + timedelta(days=1)
        logger.info("Busca automatica: %d empresas, %s a %s", len(ids), de, ate)
        for empresa_id in ids:
            executar_sync_empresa(empresa_id, de, ate, build_client)
    except Exception:  # noqa: BLE001 — o agendador nunca pode derrubar o app
        logger.exception("Busca automatica falhou")
    finally:
        db.close()


def iniciar(build_client) -> None:
    def laco():
        while True:
            time.sleep(_INTERVALO_CHECAGEM)
            _rodada(build_client)

    threading.Thread(target=laco, daemon=True, name="busca-automatica").start()
