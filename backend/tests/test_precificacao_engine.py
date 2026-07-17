"""Testes do motor de precificacao — inclui o TESTE-OURO da planilha BR26_266."""

from decimal import Decimal

import pytest

from app.precificacao.engine import (
    Componente,
    EntradaCalculo,
    PrecificacaoInvalida,
    calcular,
    calcular_pedido,
)

D = Decimal


def _entrada(**kw):
    base = dict(
        quantidade=1000,
        componentes=[Componente("insumo", D("1"))],
        aliquota_imposto=D("0.105"),
        margem=D("0.15"),
        comissao=D("0.025"),
        custo_fixo=D("0"),
    )
    base.update(kw)
    return EntradaCalculo(**base)


def test_fator_de_venda_e_preco_base():
    # custo 1 / (1 - 0.105 - 0.15 - 0.025) = 1 / 0.72 = 1.3888...
    r = calcular(_entrada())
    assert r.fator_venda == D("0.7200")
    assert r.preco_a_vista == D("1.3889")


def test_teste_ouro_planilha_br26_266_tirante():
    """Reproduz o TIRANTE do BR26_266 (aba CALCULADORA PRODUTO, coluna Q):
    custo 2,266666.../fator 0,719 = 3,1525266 (unit) — imposto Simples 10,5%,
    margem 15%, comissão/BV 2,5%, taxa 0,1%. Total do conjunto 1.500 un."""
    tirante = EntradaCalculo(
        quantidade=1500,
        componentes=[Componente("Fornecedor tirante + manuseio", D("2.266666666666667"), grupo="tirante")],
        aliquota_imposto=D("0.105"),
        margem=D("0.15"),
        comissao=D("0.025"),
        custo_fixo=D("0.001"),  # "taxa" residual da planilha (0,1%)
    )
    r = calcular(tirante)
    # fator = 1 - 0.105 - 0.15 - 0.025 - 0.001 = 0.719
    assert r.fator_venda == D("0.7190")
    # preço unitário do tirante: 2,266666.../0,719 = 3,1525266
    assert r.preco_a_vista == D("3.1525")
    # a planilha soma a parte "produto" (0,13071895) ao tirante → 3,2832456 total unit
    produto = EntradaCalculo(
        quantidade=1500,
        componentes=[Componente("Insumos produto", D("0.06666666666666667"), grupo="insumo")],
        aliquota_imposto=D("0.105"),
        margem=D("0.10"),
        comissao=D("0.035"),
        custo_fixo=D("0.25"),  # contribuição custo fixo 25% (fator produto = 0,51)
    )
    rp = calcular(produto)
    assert rp.fator_venda == D("0.5100")
    assert rp.preco_a_vista == D("0.1307")

    # preço total do conjunto por unidade e total do pedido (planilha: 3,2832456 / 4.924,87)
    pedido = calcular_pedido([tirante, produto])
    unit_conjunto = D(str(pedido["itens"][0]["preco_a_vista"])) + D(str(pedido["itens"][1]["preco_a_vista"]))
    assert unit_conjunto == D("3.2832")
    # total do pedido dentro de tolerância de centavos vs planilha (R$ 4.924,87)
    assert abs(D(str(pedido["total_a_vista"])) - D("4924.87")) <= D("0.20")


def test_imposto_muda_com_a_aliquota_da_empresa():
    """Trocar a empresa faturamento (alíquota) muda o preço, sem digitar imposto."""
    simples = calcular(_entrada(aliquota_imposto=D("0.105")))
    presumido = calcular(_entrada(aliquota_imposto=D("0.135")))  # SP/demais 13,5%
    assert presumido.preco_a_vista > simples.preco_a_vista
    assert presumido.fator_venda < simples.fator_venda


def test_preco_a_prazo_aplica_custo_financeiro():
    a_vista = calcular(_entrada(condicao_pagamento_dias=0))
    a_prazo = calcular(_entrada(condicao_pagamento_dias=30, juros_mes=D("0.025")))
    assert a_vista.custo_financeiro_unitario == D("0")
    # 30 dias, 2,5% a.m. → preço a prazo ~2,5% acima do à vista
    assert a_prazo.preco_a_prazo > a_prazo.preco_a_vista
    esperado = a_prazo.preco_a_vista * D("1.025")
    assert abs(a_prazo.preco_a_prazo - esperado) <= D("0.01")
    assert a_prazo.total == a_prazo.total_a_prazo  # a prazo: total usa preço a prazo


def test_prazo_liquido_desconta_prazo_do_fornecedor():
    # cliente 30d e fornecedor 30d → prazo líquido 0 → sem custo financeiro (caso BR26_266)
    r = calcular(_entrada(condicao_pagamento_dias=30, prazo_fornecedor_dias=30))
    assert r.custo_financeiro_unitario == D("0")


def test_total_multiplica_pela_quantidade():
    # total sai do preço em precisão cheia (evita centavos perdidos), não do já arredondado
    r = calcular(_entrada(quantidade=2500))
    assert r.total_a_vista == D("3472.22")
    assert abs(r.total_a_vista - r.preco_a_vista * D(2500)) < D("0.10")


def test_deducoes_acima_de_100_pct_erro():
    with pytest.raises(PrecificacaoInvalida):
        calcular(_entrada(margem=D("0.6"), custo_fixo=D("0.4")))


def test_quantidade_zero_erro():
    with pytest.raises(PrecificacaoInvalida):
        calcular(_entrada(quantidade=0))
