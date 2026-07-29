"""Testes do imposto do Simples: aliquota configurada no cadastro sobre a receita.

O calculo automatico (RBT12 x tabela da LC 123) foi removido: ele sobrepunha a
aliquota configurada e inflava o imposto (bug do pedido de R$ 1.320 -> R$ 212,82).
"""

from datetime import date

import pytest

from app.services import calculo

from .conftest import criar_projeto, criar_titulo


def test_empresa_simples_usa_aliquota_do_cadastro(db, empresa):
    """Caso do bug: receita 1.320,00 x 10,5% = 138,60 de imposto e 1.181,40 de resultado."""
    empresa.regime = "simples"
    empresa.aliquota_extra = 10.5
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1_320.0, projeto=100, emissao=date(2026, 7, 10))
    # faturamento alto nos 12 meses anteriores NAO pode mudar a aliquota (era o bug)
    criar_titulo(db, empresa, "receber", 50, 20_000_000.0, projeto=100, emissao=date(2025, 9, 15))

    resultado = calculo.fechar_projetos(db, [empresa.id], de=date(2026, 7, 1), ate=date(2026, 7, 31))
    linha = resultado["projetos"][0]
    assert linha["imposto_simples"] == pytest.approx(138.60)
    assert linha["imposto"] == pytest.approx(138.60)
    assert linha["resultado"] == pytest.approx(1_181.40)


def test_empresa_simples_sem_aliquota_configurada_nao_gera_imposto(db, empresa):
    """Sem aliquota no cadastro nao ha imposto automatico — a tela avisa para configurar."""
    empresa.regime = "simples"
    empresa.aliquota_extra = 0
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_simples"] == 0.0
    assert linha["imposto"] == 0.0


def test_empresa_regime_nota_usa_o_campo_como_extra(db, empresa):
    """No Presumido a % do cadastro segue sendo ADICIONAL (IRPJ/CSLL fora da NF-e)."""
    empresa.aliquota_extra = 3.4
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_simples"] == 0.0
    assert linha["imposto_extra"] == pytest.approx(340.0)


def test_serie_mensal_aplica_aliquota_do_cadastro(db, empresa):
    empresa.regime = "simples"
    empresa.aliquota_extra = 10.5
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1_320.0, projeto=100, emissao=date(2026, 7, 10))

    serie = calculo.serie_mensal(db, [empresa.id])
    julho = next(m for m in serie if m["mes"] == "2026-07")
    assert julho["imposto"] == pytest.approx(138.60)
    assert julho["resultado"] == pytest.approx(1_181.40)
