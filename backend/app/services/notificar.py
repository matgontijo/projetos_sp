"""Avisos de nova mensagem de suporte — e-mail e WhatsApp.

Regras de sobrevivência deste módulo:
- TUDO opcional: sem SMTP configurado, não manda e-mail; sem CallMeBot, não
  manda WhatsApp. O chat continua funcionando de qualquer jeito.
- NUNCA no caminho da requisição: dispara numa thread e falha em silêncio
  (com log) — um SMTP fora do ar não pode impedir o cliente de mandar mensagem.

WhatsApp via CallMeBot (gratuito, pessoal): a pessoa manda uma vez a mensagem
"I allow callmebot to send me messages" para o número deles no WhatsApp, recebe
uma apikey e cadastra CALLMEBOT_TELEFONE + CALLMEBOT_APIKEY no ambiente.
"""

import logging
import re
import smtplib
import threading
from email.message import EmailMessage
from urllib.parse import quote

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def _enviar_email(assunto: str, corpo: str, para: str | None = None) -> None:
    destino = para or settings.suporte_email
    if not (settings.smtp_host and settings.smtp_user and destino):
        return
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = settings.smtp_de or settings.smtp_user
    msg["To"] = destino
    msg.set_content(corpo)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_user, settings.smtp_pass)
        smtp.send_message(msg)
    logger.info("Suporte: aviso por e-mail enviado")


def _enviar_whatsapp(texto: str) -> None:
    if not (settings.callmebot_telefone and settings.callmebot_apikey):
        return
    resposta = httpx.get(
        "https://api.callmebot.com/whatsapp.php",
        params={
            "phone": settings.callmebot_telefone,
            "apikey": settings.callmebot_apikey,
            "text": texto,
        },
        timeout=15,
    )
    resposta.raise_for_status()
    # O CallMeBot sinaliza recusa NO CORPO com HTTP 200 ("APIKey is invalid",
    # "The message has invalid characters"...). Sem olhar o texto, uma recusa
    # passaria por sucesso — foi o que escondeu o número errado por muito tempo.
    if "queued" not in resposta.text.lower():
        motivo = re.sub(r"<[^>]+>", " ", resposta.text).strip()
        raise RuntimeError(f"CallMeBot recusou o envio: {motivo[:200]}")
    logger.info("Suporte: aviso por WhatsApp enviado")


def _trabalho(nome: str, email: str, texto: str) -> None:
    recorte = texto if len(texto) <= 400 else texto[:400] + "…"
    link = f"\n\nResponda no app: {settings.app_url}" if settings.app_url else ""
    corpo = f"{nome} ({email}) escreveu no suporte:\n\n{recorte}{link}"
    for canal, envia in (("e-mail", _enviar_email), ("whatsapp", _enviar_whatsapp)):
        try:
            if canal == "e-mail":
                envia(f"💬 Suporte — {nome}", corpo)
            else:
                envia(f"💬 Suporte — {corpo}")
        except Exception:  # noqa: BLE001 — aviso é melhor-esforço, nunca derruba nada
            logger.exception("Suporte: falha ao avisar por %s", canal)


def avisar_nova_mensagem(nome: str, email: str, texto: str) -> None:
    """Dispara os avisos em segundo plano; a requisição não espera por eles."""
    threading.Thread(target=_trabalho, args=(nome, email, texto), daemon=True).start()


def _trabalho_resposta(destino: str, texto: str) -> None:
    recorte = texto if len(texto) <= 400 else texto[:400] + "…"
    link = f"\n\nAbra o app para continuar a conversa: {settings.app_url}" if settings.app_url else ""
    try:
        _enviar_email("O suporte respondeu você", f"Resposta do suporte:\n\n{recorte}{link}", para=destino)
    except Exception:  # noqa: BLE001
        logger.exception("Suporte: falha ao avisar o cliente por e-mail")


def avisar_resposta_suporte(email_cliente: str, texto: str) -> None:
    """Fecha o ciclo: quem escreveu não precisa ficar de olho no app — a resposta
    chega no e-mail dele (só e-mail: o WhatsApp cadastrado é o de quem atende)."""
    threading.Thread(target=_trabalho_resposta, args=(email_cliente, texto), daemon=True).start()


def _trabalho_sync_erro(empresa: str, falhas: list[tuple[str, str]]) -> None:
    itens = "\n".join(f"- {recurso}: {msg.splitlines()[0][:160]}" for recurso, msg in falhas)
    link = f"\n\nDetalhes na tela Buscar dados: {settings.app_url}" if settings.app_url else ""
    corpo = f"A busca de dados da {empresa} falhou em:\n\n{itens}{link}"
    for canal, envia in (("e-mail", _enviar_email), ("whatsapp", _enviar_whatsapp)):
        try:
            if canal == "e-mail":
                envia(f"⚠ Busca de dados falhou — {empresa}", corpo)
            else:
                envia(f"⚠ {corpo}")
        except Exception:  # noqa: BLE001
            logger.exception("Sync: falha ao avisar erro por %s", canal)


def avisar_sync_erro(empresa: str, falhas: list[tuple[str, str]]) -> None:
    """Sincronização que quebra não pode morrer calada numa tabela que ninguém
    abre — quem mantém o sistema fica sabendo na hora, pelo mesmo canal do suporte."""
    if falhas:
        threading.Thread(target=_trabalho_sync_erro, args=(empresa, falhas), daemon=True).start()


def enviar_email_com_anexo(
    destinos: list[str], assunto: str, corpo: str, nome_arquivo: str, conteudo: bytes,
    subtipo: str = "pdf",
) -> None:
    """E-mail com anexo (relatório mensal, backup). Levanta exceção em falha —
    quem chama decide se loga ou tenta de novo; aqui não há requisição esperando."""
    if not (settings.smtp_host and settings.smtp_user):
        raise RuntimeError("SMTP não configurado (SMTP_HOST/SMTP_USER)")
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = settings.smtp_de or settings.smtp_user
    msg["To"] = ", ".join(destinos)
    msg.set_content(corpo)
    msg.add_attachment(conteudo, maintype="application", subtype=subtipo, filename=nome_arquivo)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(settings.smtp_user, settings.smtp_pass)
        smtp.send_message(msg)
    logger.info("Relatório: e-mail enviado para %s", msg["To"])
