"""Resultado projetado do projeto (o que a proposta prometia de lucro).

A tela pedia receita prevista + custo previsto; agora pede o resultado projetado,
que e o numero que as donas acompanham. Registros antigos continuam valendo: o
projetado deles e receita − custo.
"""

import pytest

from app import models
from app.routers.extras import _projetado
from app.services import analises

from .conftest import criar_projeto, criar_titulo, mapear_categoria


def test_projetado_direto_e_derivado_dos_antigos():
    assert _projetado(models.Orcamento(chave_projeto="X", resultado_previsto=1_000.0)) == 1_000.0
    # registro antigo: sem o campo novo, vale receita − custo
    antigo = models.Orcamento(chave_projeto="Y", receita_prevista=10_000.0, custo_previsto=7_000.0)
    assert _projetado(antigo) == 3_000.0
    assert _projetado(models.Orcamento(chave_projeto="Z")) is None


def test_alerta_quando_o_projeto_rende_menos_do_que_o_projetado(db, empresa):
    mapear_categoria(db, empresa, "2.01.01", "producao")
    criar_projeto(db, empresa, 100, "BR26_001")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 2, 8_000.0, projeto=100, categoria="2.01.01")
    db.add(models.Orcamento(chave_projeto="BR26001", nome_exibicao="BR26_001", resultado_previsto=5_000.0))
    db.commit()

    alertas = analises.gerar_alertas(db, [empresa.id], None, None, margem_alvo=0.2)
    alerta = next(a for a in alertas if "rendeu menos" in a["titulo"])
    assert alerta["projeto"] == "BR26_001"
    assert "R$ 5.000,00" in alerta["detalhe"]  # projetado
    assert "R$ 2.000,00" in alerta["detalhe"]  # realizado


def test_sem_alerta_quando_o_projeto_supera_o_projetado(db, empresa):
    mapear_categoria(db, empresa, "2.01.01", "producao")
    criar_projeto(db, empresa, 100, "BR26_002")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 2, 1_000.0, projeto=100, categoria="2.01.01")
    db.add(models.Orcamento(chave_projeto="BR26002", nome_exibicao="BR26_002", resultado_previsto=5_000.0))
    db.commit()

    alertas = analises.gerar_alertas(db, [empresa.id], None, None, margem_alvo=0.2)
    assert not [a for a in alertas if "rendeu menos" in a["titulo"]]


def test_projetado_negativo_e_valido(db):
    """Projeto-isca pode ser fechado no prejuizo de proposito — o campo aceita."""
    assert _projetado(models.Orcamento(chave_projeto="W", resultado_previsto=-500.0)) == pytest.approx(-500.0)
