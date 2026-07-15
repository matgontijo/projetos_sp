"""Testes do sistema de login: senha, sessao, papeis e guarda das rotas."""

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import models
from app.auth import (
    autenticar,
    criar_sessao,
    encerrar_sessao,
    hash_senha,
    usuario_do_token,
    usuario_logado,
    verificar_senha,
)
from app.routers.autenticacao import SetupIn, UsuarioIn, criar_usuario, setup


def _requisicao(metodo: str = "GET") -> Request:
    return Request({"type": "http", "method": metodo, "headers": []})


def _criar_usuario(db, papel="financeiro", email="ana@empresa.com", senha="segredo123"):
    usuario = models.Usuario(nome="Ana", email=email, senha_hash=hash_senha(senha), papel=papel)
    db.add(usuario)
    db.commit()
    return usuario


def test_hash_e_verificacao_de_senha():
    guardado = hash_senha("minha senha forte")
    assert guardado.startswith("scrypt$")
    assert verificar_senha("minha senha forte", guardado)
    assert not verificar_senha("errada", guardado)
    assert not verificar_senha("qualquer", "lixo-invalido")


def test_login_e_sessao(db):
    _criar_usuario(db)
    assert autenticar(db, "ANA@empresa.com ", "segredo123") is not None
    assert autenticar(db, "ana@empresa.com", "senha-errada") is None

    usuario = autenticar(db, "ana@empresa.com", "segredo123")
    token = criar_sessao(db, usuario)
    assert usuario_do_token(db, token).id == usuario.id
    encerrar_sessao(db, token)
    assert usuario_do_token(db, token) is None


def test_guarda_exige_login_e_bloqueia_escrita_de_leitura(db):
    with pytest.raises(HTTPException) as exc:
        usuario_logado(_requisicao("GET"), db, authorization=None)
    assert exc.value.status_code == 401

    leitor = _criar_usuario(db, papel="leitura", email="leitor@empresa.com")
    token = criar_sessao(db, leitor)
    # leitura pode GET…
    assert usuario_logado(_requisicao("GET"), db, authorization=f"Bearer {token}").id == leitor.id
    # …mas nao pode escrever
    with pytest.raises(HTTPException) as exc:
        usuario_logado(_requisicao("POST"), db, authorization=f"Bearer {token}")
    assert exc.value.status_code == 403


def test_setup_so_funciona_uma_vez(db):
    resultado = setup(SetupIn(nome="Dona", email="dona@empresa.com", senha="12345678"), db)
    assert resultado["usuario"]["papel"] == "admin"
    with pytest.raises(HTTPException) as exc:
        setup(SetupIn(nome="Intruso", email="x@x.com", senha="12345678"), db)
    assert exc.value.status_code == 403


def test_email_duplicado_da_422(db):
    _criar_usuario(db)
    with pytest.raises(HTTPException) as exc:
        criar_usuario(UsuarioIn(nome="Outra", email="ana@empresa.com", senha="12345678"), db)
    assert exc.value.status_code == 422


def test_usuario_inativo_nao_loga(db):
    usuario = _criar_usuario(db)
    usuario.ativo = False
    db.commit()
    assert autenticar(db, "ana@empresa.com", "segredo123") is None
