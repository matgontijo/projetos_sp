"""Camada de servico: monta a entrada do motor a partir do banco (lookups)."""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from .engine import Componente, EntradaCalculo, calcular

D = Decimal


def preco_label(db: Session, acabamento: str, quantidade: int) -> Decimal:
    """Preco unitario do label pela maior faixa <= quantidade (escala decrescente)."""
    row = db.scalar(
        select(models.TabelaLabel)
        .where(models.TabelaLabel.acabamento == acabamento, models.TabelaLabel.quantidade_min <= quantidade)
        .order_by(models.TabelaLabel.quantidade_min.desc())
        .limit(1)
    )
    return D(str(row.preco_unitario)) if row else D(0)


def aliquota_do_local(db: Session, local: str) -> Decimal:
    row = db.scalar(select(models.TabelaAliquota).where(models.TabelaAliquota.local == local))
    return D(str(row.aliquota)) if row else D(0)


def aliquota_da_empresa(db: Session, empresa: models.Empresa) -> tuple[Decimal, str]:
    """Alíquota da tabela conforme o regime da empresa faturamento (sem digitação)."""
    if empresa.regime == "simples":
        local = "Simples Nacional (todos estados)"
    else:
        local = "Demais estados"  # Presumido padrão; usuário pode escolher outro local na tela
    return aliquota_do_local(db, local), local


def parametros(db: Session, empresa_id: int | None = None) -> models.ParametroPrecificacao:
    if empresa_id:
        p = db.scalar(select(models.ParametroPrecificacao).where(models.ParametroPrecificacao.empresa_id == empresa_id))
        if p:
            return p
    return db.scalar(select(models.ParametroPrecificacao).where(models.ParametroPrecificacao.empresa_id.is_(None)))


def montar_entrada(
    db: Session,
    *,
    produto_id: int | None,
    quantidade: int,
    acabamento: str,
    empresa_faturamento_id: int,
    local_faturamento: str | None,
    condicao_pagamento_dias: int,
    margem: float | None,
    comissao: float | None,
    custo_fixo: float | None,
    porta_copo: bool,
    extras: list[dict] | None,
) -> tuple[EntradaCalculo, dict]:
    empresa = db.get(models.Empresa, empresa_faturamento_id)
    if not empresa:
        raise ValueError("Empresa de faturamento não encontrada")
    param = parametros(db, empresa_faturamento_id)

    if local_faturamento:
        aliquota = aliquota_do_local(db, local_faturamento)
        local = local_faturamento
    else:
        aliquota, local = aliquota_da_empresa(db, empresa)

    componentes: list[Componente] = []
    produto = db.get(models.Produto, produto_id) if produto_id else None
    if produto:
        componentes.append(Componente(f"Insumo {produto.nome}", D(str(produto.custo_base)), grupo="insumo"))
    if acabamento and acabamento != "sem_label":
        componentes.append(Componente(f"Label {acabamento}", preco_label(db, acabamento, quantidade), grupo="label"))
    if porta_copo:
        pc = db.scalar(select(models.ComponenteCusto).where(models.ComponenteCusto.nome.ilike("%porta%")))
        componentes.append(Componente("Porta-copo PVC", D(str(pc.valor)) if pc else D("0.25"), grupo="porta_copo"))
    for ex in extras or []:
        componentes.append(Componente(str(ex.get("nome", "Extra")), D(str(ex.get("valor", 0))), grupo="outros"))
    if not componentes:
        componentes.append(Componente("Custo base", D(0), grupo="insumo"))

    entrada = EntradaCalculo(
        quantidade=quantidade,
        componentes=componentes,
        aliquota_imposto=aliquota,
        margem=D(str(margem)) if margem is not None else D(str(param.margem_padrao)),
        comissao=D(str(comissao)) if comissao is not None else D(str(param.comissao_padrao)),
        custo_fixo=D(str(custo_fixo)) if custo_fixo is not None else D(str(param.custo_fixo_padrao)),
        condicao_pagamento_dias=condicao_pagamento_dias,
        juros_mes=D(str(param.juros_mes)),
    )
    contexto = {
        "empresa": empresa.nome,
        "regime": empresa.regime,
        "local_faturamento": local,
        "aliquota_imposto": float(aliquota),
    }
    return entrada, contexto


def calcular_com_contexto(db: Session, **kw) -> dict:
    entrada, contexto = montar_entrada(db, **kw)
    resultado = calcular(entrada)
    return {**resultado.as_dict(), **contexto}
