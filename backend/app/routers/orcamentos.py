"""Orçamentos comerciais: snapshot imutável, auditoria, PDF, export e resumo."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..auth import guarda_precificacao
from ..db import get_db
from ..precificacao import documentos, servico
from ..routers.precificacao import CalculoIn

router = APIRouter(prefix="/api/orcamentos", tags=["orcamentos"])

STATUS_VALIDOS = {"rascunho", "enviado", "aprovado"}


def _numero_automatico(db: Session) -> str:
    ano = datetime.now(timezone.utc).strftime("%y")
    prefixo = f"ORC{ano}_"
    ultimo = db.scalar(
        select(models.OrcamentoVenda.numero)
        .where(models.OrcamentoVenda.numero.like(f"{prefixo}%"))
        .order_by(models.OrcamentoVenda.id.desc())
        .limit(1)
    )
    seq = int(ultimo.split("_")[1]) + 1 if ultimo else 1
    return f"{prefixo}{seq:03d}"


def _imutavel_guard(orc: models.OrcamentoVenda) -> None:
    if orc.status != "rascunho":
        raise HTTPException(status_code=409, detail=f"Orçamento {orc.numero} está '{orc.status}' e é imutável (auditoria)")


class ItemIn(CalculoIn):
    descricao: str = ""


class OrcamentoIn(BaseModel):
    numero: str = ""  # vazio = gera automático (ORC26_001...)
    cliente: str = ""
    itens: list[ItemIn] = Field(min_length=1)


def _calcular_item(db: Session, item: ItemIn) -> dict:
    return servico.calcular_com_contexto(
        db,
        produto_id=item.produto_id,
        quantidade=item.quantidade,
        acabamento=item.acabamento,
        empresa_faturamento_id=item.empresa_faturamento_id,
        local_faturamento=item.local_faturamento,
        condicao_pagamento_dias=item.condicao_pagamento_dias,
        margem=item.margem,
        comissao=item.comissao,
        custo_fixo=item.custo_fixo,
        porta_copo=item.porta_copo,
        extras=item.extras,
    )


def _descricao_item(db: Session, item: ItemIn) -> str:
    if item.descricao:
        return item.descricao
    produto = db.get(models.Produto, item.produto_id) if item.produto_id else None
    nome = produto.nome if produto else "Produto"
    acab = f" — label {item.acabamento}" if item.acabamento and item.acabamento != "sem_label" else ""
    return f"{nome}{acab}"


@router.post("")
def criar_orcamento(
    payload: OrcamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(guarda_precificacao),
):
    """Recalcula NO SERVIDOR (nunca confia no preço do cliente) e congela o snapshot."""
    resultados = [_calcular_item(db, item) for item in payload.itens]
    total = sum(r["total"] for r in resultados)
    primeiro = payload.itens[0]

    orc = models.OrcamentoVenda(
        numero=payload.numero.strip() or _numero_automatico(db),
        cliente=payload.cliente.strip(),
        empresa_faturamento_id=primeiro.empresa_faturamento_id,
        condicao_pagamento_dias=primeiro.condicao_pagamento_dias,
        preco_unitario=resultados[0]["preco_a_prazo" if primeiro.condicao_pagamento_dias else "preco_a_vista"],
        total=total,
        snapshot={"itens": resultados, "entradas": [i.model_dump() for i in payload.itens], "total": total},
        status="rascunho",
        criado_por=usuario.nome,
        criado_por_id=usuario.id,
    )
    db.add(orc)
    db.flush()
    for item, resultado in zip(payload.itens, resultados):
        db.add(
            models.ItemOrcamento(
                orcamento_id=orc.id,
                produto_id=item.produto_id,
                descricao=_descricao_item(db, item),
                quantidade=item.quantidade,
                acabamento=item.acabamento,
                preco_unitario=resultado["preco_a_prazo" if item.condicao_pagamento_dias else "preco_a_vista"],
                total=resultado["total"],
                snapshot=resultado,
            )
        )
    db.commit()
    return {"id": orc.id, "numero": orc.numero, "total": float(orc.total), "status": orc.status}


def _serializar(orc: models.OrcamentoVenda, empresa_nome: str | None, qtd: int | None = None) -> dict:
    return {
        "id": orc.id,
        "numero": orc.numero,
        "cliente": orc.cliente,
        "empresa": empresa_nome or "",
        "empresa_faturamento_id": orc.empresa_faturamento_id,
        "status": orc.status,
        "quantidade": qtd or 0,
        "preco_unitario": float(orc.preco_unitario),
        "total": float(orc.total),
        "condicao": "À vista" if orc.condicao_pagamento_dias == 0 else f"{orc.condicao_pagamento_dias} dias",
        "condicao_pagamento_dias": orc.condicao_pagamento_dias,
        "criado_por": orc.criado_por,
        "criado_em": orc.criado_em.isoformat() if orc.criado_em else None,
    }


def _listar(db: Session, cliente: str | None, empresa_id: int | None, status: str | None,
            de: str | None, ate: str | None) -> list[dict]:
    q = (
        select(models.OrcamentoVenda, models.Empresa.nome, func.coalesce(func.sum(models.ItemOrcamento.quantidade), 0))
        .join(models.Empresa, models.Empresa.id == models.OrcamentoVenda.empresa_faturamento_id, isouter=True)
        .join(models.ItemOrcamento, models.ItemOrcamento.orcamento_id == models.OrcamentoVenda.id, isouter=True)
        .group_by(models.OrcamentoVenda.id, models.Empresa.nome)
        .order_by(models.OrcamentoVenda.id.desc())
    )
    if cliente:
        q = q.where(models.OrcamentoVenda.cliente.ilike(f"%{cliente}%"))
    if empresa_id:
        q = q.where(models.OrcamentoVenda.empresa_faturamento_id == empresa_id)
    if status:
        q = q.where(models.OrcamentoVenda.status == status)
    if de:
        q = q.where(func.date(models.OrcamentoVenda.criado_em) >= de)
    if ate:
        q = q.where(func.date(models.OrcamentoVenda.criado_em) <= ate)
    return [_serializar(orc, nome, int(qtd)) for orc, nome, qtd in db.execute(q).all()]


@router.get("")
def listar_orcamentos(
    cliente: str | None = None,
    empresa_id: int | None = None,
    status: str | None = None,
    de: str | None = None,
    ate: str | None = None,
    db: Session = Depends(get_db),
    _: models.Usuario = Depends(guarda_precificacao),
):
    return _listar(db, cliente, empresa_id, status, de, ate)


@router.get("/resumo")
def resumo_executivo(db: Session = Depends(get_db), _: models.Usuario = Depends(guarda_precificacao)):
    """Dashboard executivo: mês corrente + ranking de produtos (só leitura)."""
    inicio_mes = datetime.now(timezone.utc).strftime("%Y-%m-01")
    todos = _listar(db, None, None, None, None, None)
    mes = [o for o in todos if (o["criado_em"] or "") >= inicio_mes]
    validos = [o for o in mes if o["status"] != "rascunho"] or mes
    margens = []
    for orc in db.scalars(select(models.OrcamentoVenda)).all():
        for item in (orc.snapshot or {}).get("itens", []):
            if item.get("margem") is not None:
                margens.append(float(item["margem"]))
    ranking_q = (
        select(models.ItemOrcamento.descricao, func.count().label("n"), func.sum(models.ItemOrcamento.total))
        .group_by(models.ItemOrcamento.descricao)
        .order_by(func.sum(models.ItemOrcamento.total).desc())
        .limit(8)
    )
    return {
        "orcamentos_mes": len(mes),
        "total_mes": sum(o["total"] for o in mes),
        "ticket_medio": (sum(o["total"] for o in validos) / len(validos)) if validos else 0,
        "margem_media": (sum(margens) / len(margens)) if margens else 0,
        "por_status": {s: sum(1 for o in todos if o["status"] == s) for s in STATUS_VALIDOS},
        "ranking_produtos": [
            {"produto": d, "orcamentos": int(n), "total": float(t or 0)} for d, n, t in db.execute(ranking_q).all()
        ],
    }


@router.get("/export")
def exportar_orcamentos(
    formato: str = "xlsx",
    cliente: str | None = None,
    empresa_id: int | None = None,
    status: str | None = None,
    de: str | None = None,
    ate: str | None = None,
    db: Session = Depends(get_db),
    _: models.Usuario = Depends(guarda_precificacao),
):
    linhas = _listar(db, cliente, empresa_id, status, de, ate)
    for l in linhas:
        l["criado_em"] = (l["criado_em"] or "")[:10]
    if formato == "csv":
        return Response(
            content=documentos.orcamentos_csv(linhas).encode("utf-8-sig"),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="orcamentos.csv"'},
        )
    return Response(
        content=documentos.orcamentos_xlsx(linhas),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="orcamentos.xlsx"'},
    )


@router.get("/{orcamento_id}")
def detalhe_orcamento(orcamento_id: int, db: Session = Depends(get_db), _: models.Usuario = Depends(guarda_precificacao)):
    orc = db.get(models.OrcamentoVenda, orcamento_id)
    if not orc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    empresa = db.get(models.Empresa, orc.empresa_faturamento_id) if orc.empresa_faturamento_id else None
    itens = db.scalars(select(models.ItemOrcamento).where(models.ItemOrcamento.orcamento_id == orc.id)).all()
    return {
        **_serializar(orc, empresa.nome if empresa else None, sum(i.quantidade for i in itens)),
        "snapshot": orc.snapshot,
        "itens": [
            {
                "descricao": i.descricao,
                "quantidade": i.quantidade,
                "acabamento": i.acabamento,
                "preco_unitario": float(i.preco_unitario),
                "total": float(i.total),
            }
            for i in itens
        ],
    }


class StatusIn(BaseModel):
    status: str


@router.post("/{orcamento_id}/status")
def mudar_status(
    orcamento_id: int,
    payload: StatusIn,
    db: Session = Depends(get_db),
    _: models.Usuario = Depends(guarda_precificacao),
):
    """rascunho → enviado → aprovado. Nunca volta (imutabilidade/auditoria)."""
    orc = db.get(models.OrcamentoVenda, orcamento_id)
    if not orc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    if payload.status not in STATUS_VALIDOS:
        raise HTTPException(status_code=422, detail="Status inválido")
    ordem = ["rascunho", "enviado", "aprovado"]
    if ordem.index(payload.status) <= ordem.index(orc.status):
        raise HTTPException(status_code=409, detail=f"Orçamento '{orc.status}' não pode voltar para '{payload.status}'")
    orc.status = payload.status
    if payload.status == "enviado" and not orc.enviado_em:
        orc.enviado_em = datetime.now(timezone.utc)
    db.commit()
    return {"id": orc.id, "status": orc.status}


@router.delete("/{orcamento_id}")
def excluir_orcamento(
    orcamento_id: int,
    db: Session = Depends(get_db),
    _: models.Usuario = Depends(guarda_precificacao),
):
    orc = db.get(models.OrcamentoVenda, orcamento_id)
    if not orc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    _imutavel_guard(orc)  # só rascunho pode ser excluído
    db.delete(orc)
    db.commit()
    return {"ok": True}


@router.post("/{orcamento_id}/pdf")
def pdf_orcamento(orcamento_id: int, db: Session = Depends(get_db), _: models.Usuario = Depends(guarda_precificacao)):
    orc = db.get(models.OrcamentoVenda, orcamento_id)
    if not orc:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    empresa = db.get(models.Empresa, orc.empresa_faturamento_id) if orc.empresa_faturamento_id else None
    itens = db.scalars(select(models.ItemOrcamento).where(models.ItemOrcamento.orcamento_id == orc.id)).all()
    conteudo = documentos.proposta_pdf(
        orc,
        [
            {"descricao": i.descricao, "quantidade": i.quantidade, "preco_unitario": float(i.preco_unitario), "total": float(i.total)}
            for i in itens
        ],
        empresa.nome if empresa else "",
    )
    return Response(
        content=conteudo,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="proposta_{orc.numero}.pdf"'},
    )
