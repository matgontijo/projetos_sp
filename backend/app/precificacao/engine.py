"""Motor de precificacao — servico puro e testavel, tudo em Decimal.

Reproduz a logica da planilha de custeio de produto (BR26_266):
  fator_venda = 1 - imposto - margem - comissao - custo_fixo
  preco_a_vista = custo_unitario / fator_venda
  custo_financeiro = preco * ((1 + juros_mes) ^ (dias/30) - 1)   [se a prazo]
  preco_a_prazo = preco_a_vista + custo_financeiro

Nao acessa banco: recebe numeros ja resolvidos (custos, aliquota, parametros).
Quem monta a entrada (lookup de label/tirante/aliquota) e a camada de servico.
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, getcontext

getcontext().prec = 28

D = Decimal
CENTAVO = D("0.01")
QUATRO = D("0.0001")


def dec(v) -> Decimal:
    """Converte qualquer numero para Decimal sem erro de float (via str)."""
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v if v is not None else 0))


@dataclass
class Componente:
    nome: str
    valor: Decimal  # ja no total do item (por unidade)
    grupo: str = "insumo"  # insumo/label/tirante/frete/porta_copo/outros


@dataclass
class EntradaCalculo:
    quantidade: int
    componentes: list[Componente]  # custos por UNIDADE
    aliquota_imposto: Decimal  # fracao (0.105)
    margem: Decimal  # fracao
    comissao: Decimal  # fracao (sobre o preco)
    custo_fixo: Decimal  # fracao (contribuicao custo fixo)
    condicao_pagamento_dias: int = 0  # 0 = a vista
    juros_mes: Decimal = D("0.025")
    prazo_fornecedor_dias: int = 0  # a planilha desconta o prazo que o fornecedor da


@dataclass
class ResultadoCalculo:
    quantidade: int
    custo_unitario: Decimal
    componentes: list[dict]
    fator_venda: Decimal
    aliquota_imposto: Decimal
    margem: Decimal
    comissao: Decimal
    custo_fixo: Decimal
    preco_a_vista: Decimal
    custo_financeiro_unitario: Decimal
    preco_a_prazo: Decimal
    imposto_unitario: Decimal
    total_a_vista: Decimal
    total_a_prazo: Decimal
    total: Decimal  # = total conforme a condicao escolhida
    margem_valor_unitario: Decimal
    aviso: str = ""

    def as_dict(self) -> dict:
        def f(v: Decimal) -> float:
            return float(v)

        return {
            "quantidade": self.quantidade,
            "custo_unitario": f(self.custo_unitario),
            "componentes": self.componentes,
            "fator_venda": f(self.fator_venda),
            "aliquota_imposto": f(self.aliquota_imposto),
            "margem": f(self.margem),
            "comissao": f(self.comissao),
            "custo_fixo": f(self.custo_fixo),
            "preco_a_vista": f(self.preco_a_vista),
            "custo_financeiro_unitario": f(self.custo_financeiro_unitario),
            "preco_a_prazo": f(self.preco_a_prazo),
            "imposto_unitario": f(self.imposto_unitario),
            "total_a_vista": f(self.total_a_vista),
            "total_a_prazo": f(self.total_a_prazo),
            "total": f(self.total),
            "margem_valor_unitario": f(self.margem_valor_unitario),
            "aviso": self.aviso,
        }


class PrecificacaoInvalida(ValueError):
    pass


def calcular(entrada: EntradaCalculo) -> ResultadoCalculo:
    qtd = D(entrada.quantidade)
    if qtd <= 0:
        raise PrecificacaoInvalida("Quantidade deve ser maior que zero")

    custo_unitario = sum((dec(c.valor) for c in entrada.componentes), D(0))
    componentes_out = [{"nome": c.nome, "grupo": c.grupo, "valor": float(dec(c.valor))} for c in entrada.componentes]

    imposto = dec(entrada.aliquota_imposto)
    margem = dec(entrada.margem)
    comissao = dec(entrada.comissao)
    custo_fixo = dec(entrada.custo_fixo)

    fator = D(1) - imposto - margem - comissao - custo_fixo
    aviso = ""
    if fator <= 0:
        raise PrecificacaoInvalida(
            f"Imposto + margem + comissão + custo fixo somam {float((1 - fator) * 100):.1f}% — "
            "não sobra base para o preço. Reduza algum percentual."
        )
    if fator < D("0.2"):
        aviso = "Margem muito apertada: as deduções consomem mais de 80% do preço."

    preco_a_vista = custo_unitario / fator

    # custo financeiro sobre o prazo LIQUIDO (dias cliente - dias fornecedor)
    dias_liquido = max(entrada.condicao_pagamento_dias - entrada.prazo_fornecedor_dias, 0)
    if dias_liquido > 0:
        fator_juros = (D(1) + dec(entrada.juros_mes)) ** (D(dias_liquido) / D(30))
        custo_fin = preco_a_vista * (fator_juros - D(1))
    else:
        custo_fin = D(0)
    preco_a_prazo = preco_a_vista + custo_fin

    a_prazo = entrada.condicao_pagamento_dias > 0
    preco_escolhido = preco_a_prazo if a_prazo else preco_a_vista

    imposto_unitario = (preco_escolhido * imposto).quantize(QUATRO, ROUND_HALF_UP)
    margem_valor = (preco_escolhido * margem).quantize(QUATRO, ROUND_HALF_UP)

    return ResultadoCalculo(
        quantidade=entrada.quantidade,
        custo_unitario=custo_unitario.quantize(QUATRO, ROUND_HALF_UP),
        componentes=componentes_out,
        fator_venda=fator.quantize(QUATRO, ROUND_HALF_UP),
        aliquota_imposto=imposto,
        margem=margem,
        comissao=comissao,
        custo_fixo=custo_fixo,
        preco_a_vista=preco_a_vista.quantize(QUATRO, ROUND_HALF_UP),
        custo_financeiro_unitario=custo_fin.quantize(QUATRO, ROUND_HALF_UP),
        preco_a_prazo=preco_a_prazo.quantize(QUATRO, ROUND_HALF_UP),
        imposto_unitario=imposto_unitario,
        total_a_vista=(preco_a_vista * qtd).quantize(CENTAVO, ROUND_HALF_UP),
        total_a_prazo=(preco_a_prazo * qtd).quantize(CENTAVO, ROUND_HALF_UP),
        total=(preco_escolhido * qtd).quantize(CENTAVO, ROUND_HALF_UP),
        margem_valor_unitario=margem_valor,
        aviso=aviso,
    )


@dataclass
class EntradaPedido:
    """Um pedido pode ter varias linhas (produto + tirante), cada uma com seu fator."""

    itens: list[EntradaCalculo] = field(default_factory=list)


def calcular_pedido(itens: list[EntradaCalculo]) -> dict:
    resultados = [calcular(i) for i in itens]
    total = sum((r.total for r in resultados), D(0))
    total_a_vista = sum((r.total_a_vista for r in resultados), D(0))
    return {
        "itens": [r.as_dict() for r in resultados],
        "total": float(total.quantize(CENTAVO, ROUND_HALF_UP)),
        "total_a_vista": float(total_a_vista.quantize(CENTAVO, ROUND_HALF_UP)),
    }
