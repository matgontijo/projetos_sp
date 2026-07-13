"""Testes do Simples Nacional: aliquota efetiva e aplicacao no fechamento."""

from datetime import date

import pytest

from app import models
from app.services import calculo
from app.services.simples import aliquota_efetiva

from .conftest import criar_projeto, criar_titulo


def test_aliquota_efetiva_anexo_i_faixa_2():
    # RBT12 300.000 (Anexo I, 2a faixa): (300000*0,073 - 5940)/300000 = 5,32%
    assert aliquota_efetiva(300_000, "I") == pytest.approx(0.0532)


def test_aliquota_efetiva_primeira_faixa_e_nominal():
    assert aliquota_efetiva(100_000, "I") == pytest.approx(0.04)
    assert aliquota_efetiva(0, "II") == pytest.approx(0.045)  # sem RBT12: nominal da 1a faixa


def test_aliquota_efetiva_anexo_ii():
    # RBT12 1.000.000 (Anexo II, 4a faixa): (1000000*0,112 - 22500)/1000000 = 8,95%
    assert aliquota_efetiva(1_000_000, "II") == pytest.approx(0.0895)


def test_empresa_simples_aplica_aliquota_sobre_receita(db, empresa):
    empresa.regime = "simples"
    empresa.simples_anexo = "I"
    db.add(models.SimplesPeriodo(empresa_id=empresa.id, competencia="2026-05", rbt12=300_000))
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100, emissao=date(2026, 5, 10))

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_simples"] == pytest.approx(532.0)  # 10000 x 5,32%
    assert linha["imposto"] == pytest.approx(532.0)
    assert linha["resultado"] == pytest.approx(9_468.0)


def test_empresa_regime_nota_nao_aplica_simples(db, empresa):
    db.add(models.SimplesPeriodo(empresa_id=empresa.id, competencia="2026-05", rbt12=300_000))
    db.commit()
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100, emissao=date(2026, 5, 10))

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_simples"] == 0.0


def test_rbt12_derivado_do_cache_quando_nao_informado(db, empresa):
    empresa.regime = "simples"
    empresa.simples_anexo = "I"
    db.commit()
    criar_projeto(db, empresa, 100, "BR26_055")
    # 12 meses anteriores somando 360.000 (30.000/mes de jun/2025 a mai/2026... usamos 2 lancamentos)
    criar_titulo(db, empresa, "receber", 50, 180_000.0, projeto=100, emissao=date(2025, 8, 15))
    criar_titulo(db, empresa, "receber", 51, 120_000.0, projeto=100, emissao=date(2026, 2, 15))
    # competencia analisada: jun/2026
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100, emissao=date(2026, 6, 10))

    resultado = calculo.fechar_projetos(db, [empresa.id], de=date(2026, 6, 1), ate=date(2026, 6, 30))
    linha = resultado["projetos"][0]
    # RBT12 derivado = 300.000 -> aliquota 5,32%
    assert linha["imposto_simples"] == pytest.approx(532.0)
