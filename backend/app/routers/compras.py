"""Pedidos de compra: compromissos de saída e crédito de impostos.

Complementa as contas a pagar — o pedido existe ANTES de virar conta, então é
por ele que dá para enxergar a saída comprometida e o crédito de ICMS/PIS/COFINS.
"""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db

router = APIRouter(prefix="/api/compras", tags=["compras"])

# situacao 'pendente' = ainda NAO virou conta a pagar (compromisso puro)
SITUACOES = ("pendente", "faturado", "recebido", "encerrado")


def _empresas(empresa_ids: str | None) -> list[int]:
    if not empresa_ids:
        return []
    return [int(x) for x in empresa_ids.split(",") if x.strip().isdigit()]


@router.get("/pedidos")
def listar_pedidos(
    empresa_ids: str | None = None,
    situacao: str | None = None,
    de: date | None = None,
    ate: date | None = None,
    busca: str | None = None,
    limite: int = Query(default=200, le=500),
    db: Session = Depends(get_db),
):
    q = select(models.PedidoCompra, models.Empresa.nome).join(
        models.Empresa, models.Empresa.id == models.PedidoCompra.empresa_id
    )
    ids = _empresas(empresa_ids)
    if ids:
        q = q.where(models.PedidoCompra.empresa_id.in_(ids))
    if situacao in SITUACOES:
        q = q.where(models.PedidoCompra.situacao == situacao)
    if de:
        q = q.where(models.PedidoCompra.data_inclusao >= de)
    if ate:
        q = q.where(models.PedidoCompra.data_inclusao <= ate)
    if busca:
        alvo = f"%{busca.strip()}%"
        q = q.where(models.PedidoCompra.observacao.ilike(alvo) | models.PedidoCompra.numero.ilike(alvo))
    q = q.order_by(models.PedidoCompra.data_inclusao.desc().nullslast(), models.PedidoCompra.id.desc()).limit(limite)

    linhas = []
    for ped, empresa_nome in db.execute(q).all():
        parcelas = sorted(ped.parcelas, key=lambda p: (p.vencimento or date.max))
        linhas.append({
            "id": ped.id,
            "empresa": empresa_nome,
            "numero": ped.numero,
            "situacao": ped.situacao,
            "etapa": ped.etapa,
            "categoria": ped.codigo_categoria,
            "observacao": ped.observacao,
            "data_inclusao": ped.data_inclusao.isoformat() if ped.data_inclusao else None,
            "data_previsao": ped.data_previsao.isoformat() if ped.data_previsao else None,
            "valor_total": float(ped.valor_total),
            "credito_impostos": round(
                float(ped.valor_icms) + float(ped.valor_pis) + float(ped.valor_cofins), 2
            ),
            "valor_icms": float(ped.valor_icms),
            "valor_ipi": float(ped.valor_ipi),
            "proximo_vencimento": parcelas[0].vencimento.isoformat() if parcelas and parcelas[0].vencimento else None,
            "qtd_parcelas": len(parcelas),
        })
    return linhas


@router.get("/resumo")
def resumo(empresa_ids: str | None = None, db: Session = Depends(get_db)):
    """Quanto está comprometido, quanto já virou conta a pagar e o crédito acumulado."""
    q = select(models.PedidoCompra)
    ids = _empresas(empresa_ids)
    if ids:
        q = q.where(models.PedidoCompra.empresa_id.in_(ids))
    pedidos = db.scalars(q).all()

    hoje = date.today()
    limite_30 = hoje + timedelta(days=30)
    por_situacao = {s: {"qtd": 0, "valor": 0.0} for s in SITUACOES}
    credito = 0.0
    a_vencer_30 = 0.0
    vencido = 0.0

    for p in pedidos:
        bucket = por_situacao.setdefault(p.situacao, {"qtd": 0, "valor": 0.0})
        bucket["qtd"] += 1
        bucket["valor"] += float(p.valor_total)
        credito += float(p.valor_icms) + float(p.valor_pis) + float(p.valor_cofins)
        if p.situacao == "pendente":  # só o que ainda não virou conta a pagar
            for parc in p.parcelas:
                if not parc.vencimento:
                    continue
                if parc.vencimento < hoje:
                    vencido += float(parc.valor)
                elif parc.vencimento <= limite_30:
                    a_vencer_30 += float(parc.valor)

    for b in por_situacao.values():
        b["valor"] = round(b["valor"], 2)
    return {
        "por_situacao": por_situacao,
        "credito_impostos": round(credito, 2),
        "comprometido_30_dias": round(a_vencer_30, 2),
        "comprometido_vencido": round(vencido, 2),
        "total_pedidos": len(pedidos),
    }
