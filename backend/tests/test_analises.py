"""Testes das analises: curva ABC, vendedores, caixa, alertas e simulador."""

from datetime import date, timedelta

import pytest

from app import models
from app.services import analises

from .conftest import criar_nfe, criar_projeto, criar_titulo, mapear_categoria


def test_curva_abc_de_clientes(db, empresa):
    db.add_all([
        models.Cliente(empresa_id=empresa.id, codigo_cliente_omie=1, nome_fantasia="Gigante"),
        models.Cliente(empresa_id=empresa.id, codigo_cliente_omie=2, nome_fantasia="Medio"),
        models.Cliente(empresa_id=empresa.id, codigo_cliente_omie=3, nome_fantasia="Pequeno"),
    ])
    db.commit()
    criar_projeto(db, empresa, 100, "BR26_001")
    criar_projeto(db, empresa, 200, "BR26_002")
    criar_projeto(db, empresa, 300, "BR26_003")
    criar_titulo(db, empresa, "receber", 1, 80_000.0, projeto=100, cliente=1)
    criar_titulo(db, empresa, "receber", 2, 15_000.0, projeto=200, cliente=2)
    criar_titulo(db, empresa, "receber", 3, 5_000.0, projeto=300, cliente=3)

    ranking = analises.ranking_clientes(db, [empresa.id], None, None)

    assert [c["cliente"] for c in ranking] == ["Gigante", "Medio", "Pequeno"]
    assert ranking[0]["classe"] == "A"
    assert ranking[1]["classe"] == "B"
    assert ranking[2]["classe"] == "C"
    assert ranking[0]["margem"] == pytest.approx(1.0)  # sem custos


def test_ranking_vendedores_pondera_pela_margem_do_projeto(db, empresa):
    db.add(models.Vendedor(empresa_id=empresa.id, codigo_omie=7, nome="Alice"))
    db.commit()
    criar_projeto(db, empresa, 100, "BR26_001")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    t = criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)
    t.codigo_vendedor = 7
    criar_titulo(db, empresa, "pagar", 2, 5_000.0, projeto=100, categoria="2.01.01")
    db.commit()

    resultado = analises.ranking_vendedores(db, [empresa.id], None, None)
    alice = resultado["vendedores"][0]
    assert alice["vendedor"] == "Alice"
    assert alice["receita"] == 10_000.0
    assert alice["margem_media"] == pytest.approx(0.5)
    assert alice["resultado_atribuido"] == pytest.approx(5_000.0)


def test_caixa_separa_aberto_e_atrasado(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_001")
    ontem = date.today() - timedelta(days=10)
    futuro = date.today() + timedelta(days=10)
    t1 = criar_titulo(db, empresa, "receber", 1, 1_000.0, projeto=100, status="ATRASADO")
    t1.data_vencimento = ontem
    t2 = criar_titulo(db, empresa, "receber", 2, 2_000.0, projeto=100, status="AVENCER")
    t2.data_vencimento = futuro
    t3 = criar_titulo(db, empresa, "receber", 3, 9_999.0, projeto=100, status="RECEBIDO")  # quitado: fora
    t3.data_vencimento = ontem
    db.commit()

    caixa = analises.ciclo_de_caixa(db, [empresa.id], None, None)
    assert caixa["totais"]["receber_aberto"] == 3_000.0
    assert caixa["totais"]["receber_atrasado"] == 1_000.0
    assert caixa["projetos"][0]["maior_atraso_dias"] == 10


def test_alertas_prejuizo_e_orcamento(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_001")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    criar_titulo(db, empresa, "receber", 1, 1_000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 2, 3_000.0, projeto=100, categoria="2.01.01")
    db.add(models.Orcamento(chave_projeto="BR26001", nome_exibicao="BR26_001", custo_previsto=1_000.0))
    db.commit()

    alertas = analises.gerar_alertas(db, [empresa.id], None, None, margem_alvo=0.2)
    titulos = " | ".join(a["titulo"] for a in alertas)
    assert "prejuízo" in titulos
    assert "estourou o orçamento" in titulos


def test_simulador_preco_minimo_e_comparacao(db, empresa):
    # empresa 'nota' SEM historico -> usa so o % extra
    empresa.aliquota_extra = 10.0
    empresa2 = models.Empresa(nome="Simples Ltda", cnpj="2", app_key_enc="x", app_secret_enc="y",
                              regime="simples", simples_anexo="I")
    db.add(empresa2)
    db.commit()
    comp = date.today().strftime("%Y-%m")
    db.add(models.SimplesPeriodo(empresa_id=empresa2.id, competencia=comp, rbt12=300_000))
    db.commit()

    resultado = analises.simular_preco(db, custo=1_000.0, margem_alvo=0.2)

    c1 = next(c for c in resultado["cenarios"] if c["empresa_id"] == empresa.id)
    # preco = 1000 / (1 - 0.10 - 0.20) = 1428.57
    assert c1["preco_minimo"] == pytest.approx(1428.57, abs=0.01)
    c2 = next(c for c in resultado["cenarios"] if c["empresa_id"] == empresa2.id)
    # aliquota Simples 5,32% -> preco = 1000 / (1 - 0.0532 - 0.2) = 1339.03
    assert c2["preco_minimo"] == pytest.approx(1339.03, abs=0.05)
    assert resultado["empresa_recomendada"] == "Simples Ltda"


def test_simulador_margem_com_preco_informado(db, empresa):
    empresa.aliquota_extra = 10.0
    db.commit()
    resultado = analises.simular_preco(db, custo=1_000.0, margem_alvo=0.2, preco=2_000.0)
    cenario = resultado["cenarios"][0]["com_preco_informado"]
    # imposto 200, resultado 800, margem 40%
    assert cenario["imposto"] == pytest.approx(200.0)
    assert cenario["margem"] == pytest.approx(0.4)


def test_simulador_com_comissao(db, empresa):
    """Comissao reduz a margem como o imposto: preco = custo / (1 - aliq - com - margem)."""
    empresa.aliquota_extra = 10.0
    db.commit()
    resultado = analises.simular_preco(db, custo=1_000.0, margem_alvo=0.2, preco=2_000.0, comissao=0.05)
    cenario = resultado["cenarios"][0]
    # preco minimo = 1000 / (1 - 0.10 - 0.05 - 0.20) = 1538.46
    assert cenario["preco_minimo"] == pytest.approx(1538.46, abs=0.01)
    com_preco = cenario["com_preco_informado"]
    # comissao 100, imposto 200, resultado 700, margem 35%
    assert com_preco["comissao"] == pytest.approx(100.0)
    assert com_preco["resultado"] == pytest.approx(700.0)
    assert com_preco["margem"] == pytest.approx(0.35)
