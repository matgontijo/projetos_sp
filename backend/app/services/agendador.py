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
from ..config import settings
from ..db import SessionLocal
from . import notificar
from .sync import executar_sync_empresa

logger = logging.getLogger(__name__)

_INTERVALO_CHECAGEM = 60  # segundos


def _marcar(db, chave: str, valor: str) -> None:
    """Grava o marcador ANTES de rodar — se a tarefa demorar, nao dispara duas vezes."""
    marcador = db.get(models.Configuracao, chave)
    if marcador is None:
        db.add(models.Configuracao(chave=chave, valor=valor))
    else:
        marcador.valor = valor
    db.commit()


def _sync_diario(db, config: dict, build_client) -> None:
    if config.get("sync_auto", "0") != "1":
        return
    hora = int(config.get("sync_hora", "5") or 5)
    agora = datetime.now()
    hoje = agora.date().isoformat()
    if agora.hour < hora or config.get("ultimo_sync_auto") == hoje:
        return
    _marcar(db, "ultimo_sync_auto", hoje)

    ids = list(db.scalars(select(models.Empresa.id).where(models.Empresa.ativa)).all())
    de = date(date.today().year - 1, 1, 1)  # ano anterior inteiro (base do Simples)
    ate = date.today() + timedelta(days=1)
    logger.info("Busca automatica: %d empresas, %s a %s", len(ids), de, ate)
    for empresa_id in ids:
        executar_sync_empresa(empresa_id, de, ate, build_client)


_MES_PT = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
           "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _relatorio_mensal(db, config: dict) -> None:
    """Fechamento do mês anterior em PDF, por e-mail, no dia configurado."""
    if config.get("relatorio_auto", "0") != "1":
        return
    hoje = date.today()
    dia = int(config.get("relatorio_dia", "1") or 1)
    mes_atual = hoje.strftime("%Y-%m")
    if hoje.day < dia or config.get("ultimo_relatorio_auto") == mes_atual:
        return
    destinos = [e.strip() for e in (config.get("relatorio_emails") or "").split(",") if e.strip()]
    if not destinos:
        destinos = [e for e in [settings.suporte_email.strip()] if e]
    if not destinos:
        return  # ligado mas sem destinatario: nada a fazer (o front avisa disso)
    _marcar(db, "ultimo_relatorio_auto", mes_atual)

    fim = hoje.replace(day=1) - timedelta(days=1)  # ultimo dia do mes anterior
    de = fim.replace(day=1)
    # imports locais: routers importam services — na direcao inversa daria ciclo
    from ..routers.projetos import fechamento_anotado
    from .export import fechamento_pdf

    ids = list(db.scalars(select(models.Empresa.id).where(models.Empresa.ativa)).all())
    dados = fechamento_anotado(db, ids, de, fim)
    titulo_mes = f"{_MES_PT[de.month].capitalize()} de {de.year}"
    pdf = fechamento_pdf(dados["projetos"], dados.get("consolidado", {}), titulo_mes)
    notificar.enviar_email_com_anexo(
        destinos,
        f"Fechamento de projetos — {titulo_mes}",
        f"Segue o fechamento de {titulo_mes} em PDF, gerado automaticamente.\n\n"
        + (f"Detalhes no app: {settings.app_url}\n" if settings.app_url else ""),
        f"fechamento_{de.strftime('%Y-%m')}.pdf",
        pdf,
    )
    logger.info("Relatorio mensal de %s enviado para %d destinatario(s)", titulo_mes, len(destinos))


def _rodada(build_client) -> None:
    db = SessionLocal()
    try:
        config = {c.chave: c.valor for c in db.scalars(select(models.Configuracao)).all()}
        # tarefas independentes: a falha de uma nao pode segurar a outra
        try:
            _relatorio_mensal(db, config)
        except Exception:  # noqa: BLE001
            logger.exception("Relatorio mensal falhou")
        _sync_diario(db, config, build_client)
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
