"""Avisos de suporte: o WhatsApp precisa ENXERGAR a recusa do CallMeBot.

O CallMeBot responde HTTP 200 mesmo quando recusa (apikey inválida, caractere
inválido, número errado) — a recusa vem no corpo. Sem checar o texto, o app
registrava "enviado" e o problema ficava invisível. Estes testes garantem que
uma recusa vira exceção e um envio de verdade não.
"""

import httpx
import pytest

from app.services import notificar


class RespostaFake:
    def __init__(self, texto: str):
        self.text = texto

    def raise_for_status(self) -> None:  # CallMeBot devolve 200 nos dois casos
        return None


@pytest.fixture()
def callmebot_ligado(monkeypatch):
    monkeypatch.setattr(notificar.settings, "callmebot_telefone", "5511999999999")
    monkeypatch.setattr(notificar.settings, "callmebot_apikey", "chave")


def _responder(monkeypatch, texto: str):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: RespostaFake(texto))


def test_envio_aceito_nao_levanta(callmebot_ligado, monkeypatch):
    _responder(monkeypatch, "<p>Message queued. You will receive it in a few seconds.")
    notificar._enviar_whatsapp("oi")  # não deve levantar


def test_recusa_do_callmebot_vira_erro(callmebot_ligado, monkeypatch):
    _responder(monkeypatch, "<p><b>Error:</b> APIKey is invalid.")
    with pytest.raises(RuntimeError, match="CallMeBot recusou"):
        notificar._enviar_whatsapp("oi")


def test_sem_credencial_nao_chama_callmebot(monkeypatch):
    monkeypatch.setattr(notificar.settings, "callmebot_telefone", "")
    monkeypatch.setattr(notificar.settings, "callmebot_apikey", "")

    def explode(*a, **k):
        raise AssertionError("não deveria chamar o CallMeBot sem credencial")

    monkeypatch.setattr(httpx, "get", explode)
    notificar._enviar_whatsapp("oi")  # simplesmente não faz nada


def test_trabalho_engole_a_falha_e_nunca_derruba(callmebot_ligado, monkeypatch):
    """A recusa é logada, mas _trabalho não propaga — o chat nunca cai por isso."""
    _responder(monkeypatch, "<p><b>Error:</b> invalid characters")
    monkeypatch.setattr(notificar.settings, "smtp_host", "")  # sem e-mail
    notificar._trabalho("Maria", "maria@cliente.com", "socorro")  # não levanta
