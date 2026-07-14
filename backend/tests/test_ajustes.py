"""Testes do router de ajustes: validacao do valor por campo (anti 'projeto fantasma')."""

import pytest
from fastapi import HTTPException

from app.routers.ajustes import criar
from app.schemas import AjusteCreate

from .conftest import criar_projeto, criar_titulo


def _payload(empresa, titulo, campo, valor):
    return AjusteCreate(
        empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo=campo, valor_novo=valor, motivo="teste"
    )


def test_mover_para_projeto_existente_passa(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    criar_projeto(db, empresa, 200, "B")
    titulo = criar_titulo(db, empresa, "receber", 1, 100.0, projeto=100)

    ajuste = criar(_payload(empresa, titulo, "codigo_projeto", "200"), db, x_usuario="tester")
    assert ajuste.valor_novo == "200"


def test_mover_para_sem_projeto_passa(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    titulo = criar_titulo(db, empresa, "receber", 1, 100.0, projeto=100)
    ajuste = criar(_payload(empresa, titulo, "codigo_projeto", "0"), db, x_usuario="tester")
    assert ajuste.valor_novo == "0"


def test_mover_para_projeto_inexistente_da_422(db, empresa):
    """Regressao: codigo inexistente criava linha fantasma 'Projeto 4041'."""
    criar_projeto(db, empresa, 100, "A")
    titulo = criar_titulo(db, empresa, "receber", 1, 100.0, projeto=100)

    with pytest.raises(HTTPException) as exc:
        criar(_payload(empresa, titulo, "codigo_projeto", "4041"), db, x_usuario="tester")
    assert exc.value.status_code == 422
    assert "4041" in exc.value.detail


def test_grupo_invalido_da_422(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    titulo = criar_titulo(db, empresa, "pagar", 1, 100.0, projeto=100)
    with pytest.raises(HTTPException) as exc:
        criar(_payload(empresa, titulo, "grupo", "inexistente"), db, x_usuario="tester")
    assert exc.value.status_code == 422


def test_usuario_percent_encoded_e_decodificado(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    titulo = criar_titulo(db, empresa, "receber", 1, 100.0, projeto=100)
    ajuste = criar(
        _payload(empresa, titulo, "excluir", "S"), db, x_usuario="Jo%C3%A3o%20Financeiro"
    )
    assert ajuste.usuario == "João Financeiro"
