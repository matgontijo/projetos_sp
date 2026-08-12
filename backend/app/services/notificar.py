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


def _enviar_email(assunto: str, corpo: str) -> None:
    if not (settings.smtp_host and settings.smtp_user and settings.suporte_email):
        return
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = settings.smtp_de or settings.smtp_user
    msg["To"] = settings.suporte_email
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
