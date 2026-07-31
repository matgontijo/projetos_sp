"""Impostos itemizados por empresa (PIS, COFINS, ICMS, CSLL, IRPJ...).

Cada empresa cadastra a SUA tabela de impostos sobre a receita. No Presumido ela
pode escolher de onde vem o imposto do projeto:
  - 'nfe'      -> tributos destacados na nota + as linhas cadastradas (padrao)
  - 'aliquota' -> so as linhas cadastradas, como na planilha das donas
"""

from datetime import date

import pytest

from app.services import calculo

from .conftest import criar_nfe, criar_projeto, criar_titulo

# a tabela que a cliente mandou (Lucro Presumido): 19,05% sobre o faturado
TABELA_PRESUMIDO = [
    {"nome": "PIS", "aliquota": 0.65},
    {"nome": "COFINS", "aliquota": 3.00},
    {"nome": "ICMS", "aliquota": 12.00},
    {"nome": "CSLL", "aliquota": 1.20},
    {"nome": "IRPJ", "aliquota": 1.08},
    {"nome": "Add. IRPJ", "aliquota": 1.12},
]


def test_planilha_do_cliente_bate_com_o_fechamento(db, empresa):
    """Receita 151.393,20 x 19,05% = 28.840,40 — o total da planilha, ao centavo."""
    empresa.impostos = TABELA_PRESUMIDO
    empresa.fonte_imposto = "aliquota"
    db.commit()

    criar_projeto(db, empresa, 100, "BR25_600")
    criar_titulo(db, empresa, "receber", 1, 151_393.20, projeto=100)
    # a NF-e traz ICMS/PIS/COFINS destacados: NAO pode somar por cima (duplicaria)
    criar_nfe(db, empresa, 900, projeto=100, v_icms=18_167.18, v_pis=984.06, v_cofins=4_541.80)

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto"] == pytest.approx(28_840.40, abs=0.01)
    assert linha["imposto_nfe"] == 0.0


def test_fonte_nfe_soma_a_nota_mais_os_impostos_de_fora(db, empresa):
    """Padrao do Presumido: ICMS/PIS/COFINS vem da nota; CSLL/IRPJ do cadastro."""
    empresa.impostos = [
        {"nome": "CSLL", "aliquota": 1.20},
        {"nome": "IRPJ", "aliquota": 1.08},
        {"nome": "Add. IRPJ", "aliquota": 1.12},
    ]
    empresa.fonte_imposto = "nfe"
    db.commit()

    criar_projeto(db, empresa, 100, "BR25_600")
    criar_titulo(db, empresa, "receber", 1, 100_000.0, projeto=100)
    criar_nfe(db, empresa, 900, projeto=100, v_icms=12_000.0)

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_nfe"] == pytest.approx(12_000.0)
    assert linha["imposto_extra"] == pytest.approx(3_400.0)  # 3,40% de fora da nota
    assert linha["imposto"] == pytest.approx(15_400.0)


def test_linhas_cadastradas_vencem_o_campo_unico_antigo(db, empresa):
    """Havendo tabela, a soma dela e a aliquota — o campo legado fica de lado."""
    empresa.aliquota_extra = 3.4
    empresa.impostos = [{"nome": "CSLL", "aliquota": 1.20}, {"nome": "IRPJ", "aliquota": 1.08}]
    db.commit()

    criar_projeto(db, empresa, 100, "BR25_600")
    criar_titulo(db, empresa, "receber", 1, 100_000.0, projeto=100)

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_extra"] == pytest.approx(2_280.0)  # 2,28%, nao 3,4%


def test_simples_tambem_aceita_a_tabela_itemizada(db, empresa):
    empresa.regime = "simples"
    empresa.impostos = [{"nome": "Simples Nacional (Anexo I)", "aliquota": 10.5}]
    db.commit()

    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1_320.0, projeto=100, emissao=date(2026, 7, 10))

    linha = calculo.fechar_projetos(db, [empresa.id])["projetos"][0]
    assert linha["imposto_simples"] == pytest.approx(138.60)
    assert linha["resultado"] == pytest.approx(1_181.40)


def test_serie_mensal_segue_a_mesma_regra(db, empresa):
    empresa.impostos = TABELA_PRESUMIDO
    empresa.fonte_imposto = "aliquota"
    db.commit()

    criar_projeto(db, empresa, 100, "BR25_600")
    criar_titulo(db, empresa, "receber", 1, 151_393.20, projeto=100, emissao=date(2026, 5, 12))
    criar_nfe(db, empresa, 900, projeto=100, emissao=date(2026, 5, 12), v_icms=18_167.18)

    serie = calculo.serie_mensal(db, [empresa.id])
    maio = next(m for m in serie if m["mes"] == "2026-05")
    assert maio["imposto"] == pytest.approx(28_840.40, abs=0.01)
