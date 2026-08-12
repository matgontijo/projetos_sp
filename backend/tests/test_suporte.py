"""Chat de suporte: conversa por usuário, caixa de entrada do suporte e avisos."""

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.routers import suporte as rota
from app.routers.suporte import MensagemIn, conversas, enviar, mensagens, resumo


def usuario(db: Session, nome: str, email: str, papel: str = "financeiro") -> models.Usuario:
    row = models.Usuario(nome=nome, email=email, senha_hash="x", papel=papel)
    db.add(row)
    db.commit()
    return row


@pytest.fixture()
def suporte_configurado(monkeypatch):
    """A conta de suporte é identificada pelo e-mail em SUPORTE_EMAIL."""
    monkeypatch.setattr(rota.settings, "suporte_email", "matheus@suporte.com")


@pytest.fixture()
def avisos(monkeypatch):
    """Captura os avisos em vez de mandar e-mail/WhatsApp de verdade."""
    chamadas = []
    monkeypatch.setattr(rota.notificar, "avisar_nova_mensagem", lambda *a: chamadas.append(a))
    return chamadas


def test_cliente_escreve_e_o_aviso_dispara(db: Session, suporte_configurado, avisos):
    maria = usuario(db, "Maria", "maria@cliente.com")

    saida = enviar(MensagemIn(texto="O relatório não abre"), db, maria)

    assert saida["autor"] == "cliente"
    assert avisos == [("Maria", "maria@cliente.com", "O relatório não abre")]


def test_resposta_do_suporte_nao_dispara_aviso(db: Session, suporte_configurado, avisos):
    maria = usuario(db, "Maria", "maria@cliente.com")
    atendente = usuario(db, "Matheus", "matheus@suporte.com")
    enviar(MensagemIn(texto="Socorro"), db, maria)

    enviar(MensagemIn(texto="Já estou olhando!", usuario_id=maria.id), db, atendente)

    thread = mensagens(usuario_id=maria.id, db=db, usuario=atendente)
    assert [m["autor"] for m in thread["mensagens"]] == ["cliente", "suporte"]
    assert len(avisos) == 1  # só a mensagem do cliente avisou


def test_cada_um_ve_so_a_propria_conversa(db: Session, suporte_configurado):
    maria = usuario(db, "Maria", "maria@cliente.com")
    joao = usuario(db, "Joao", "joao@cliente.com")
    enviar(MensagemIn(texto="mensagem da Maria"), db, maria)

    with pytest.raises(HTTPException) as exc:
        mensagens(usuario_id=maria.id, db=db, usuario=joao)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        enviar(MensagemIn(texto="invasão", usuario_id=maria.id), db, joao)
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc:
        conversas(db=db, usuario=joao)
    assert exc.value.status_code == 403


def test_abrir_a_conversa_marca_como_lida_dos_dois_lados(db: Session, suporte_configurado, avisos):
    maria = usuario(db, "Maria", "maria@cliente.com")
    atendente = usuario(db, "Matheus", "matheus@suporte.com")
    enviar(MensagemIn(texto="Oi"), db, maria)

    # o suporte ainda nao abriu: 1 nao lida na caixa dele
    assert resumo(db=db, usuario=atendente) == {"nao_lidas": 1, "sou_suporte": True}
    mensagens(usuario_id=maria.id, db=db, usuario=atendente)  # abriu
    assert resumo(db=db, usuario=atendente)["nao_lidas"] == 0

    enviar(MensagemIn(texto="Resolvido!", usuario_id=maria.id), db, atendente)
    # a Maria ainda nao abriu: 1 nao lida para ela
    assert resumo(db=db, usuario=maria) == {"nao_lidas": 1, "sou_suporte": False}
    mensagens(usuario_id=None, db=db, usuario=maria)  # abriu
    assert resumo(db=db, usuario=maria)["nao_lidas"] == 0


def test_caixa_de_entrada_lista_conversas_com_nao_lidas(db: Session, suporte_configurado, avisos):
    maria = usuario(db, "Maria", "maria@cliente.com")
    joao = usuario(db, "Joao", "joao@cliente.com")
    atendente = usuario(db, "Matheus", "matheus@suporte.com")
    enviar(MensagemIn(texto="primeira da Maria"), db, maria)
    enviar(MensagemIn(texto="segunda da Maria"), db, maria)
    enviar(MensagemIn(texto="oi, do Joao"), db, joao)

    caixa = conversas(db=db, usuario=atendente)

    assert [c["nome"] for c in caixa] == ["Joao", "Maria"]  # mais recente primeiro
    assert {c["nome"]: c["nao_lidas"] for c in caixa} == {"Maria": 2, "Joao": 1}


def test_sem_suporte_configurado_ninguem_e_atendente(db: Session, avisos):
    qualquer = usuario(db, "Ana", "ana@cliente.com", papel="admin")
    enviar(MensagemIn(texto="oi"), db, qualquer)

    assert resumo(db=db, usuario=qualquer)["sou_suporte"] is False
    with pytest.raises(HTTPException):
        conversas(db=db, usuario=qualquer)
