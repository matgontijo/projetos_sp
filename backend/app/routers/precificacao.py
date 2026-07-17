from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..auth import exigir_admin_ou_financeiro, guarda_precificacao
from ..db import get_db
from ..precificacao import servico

router = APIRouter(prefix="/api/precificacao", tags=["precificacao"], dependencies=[Depends(guarda_precificacao)])


@router.get("/empresas")
def empresas_faturamento(db: Session = Depends(get_db)):
    """Empresas para escolher o faturamento (o comercial não acessa o CRUD de custeio)."""
    rows = db.scalars(select(models.Empresa).where(models.Empresa.ativa).order_by(models.Empresa.nome)).all()
    return [{"id": e.id, "nome": e.nome, "regime": e.regime} for e in rows]


@router.get("/opcoes")
def opcoes(db: Session = Depends(get_db)):
    """Tudo que a calculadora precisa: produtos, acabamentos, locais de faturamento, parâmetros."""
    produtos = db.scalars(select(models.Produto).where(models.Produto.ativo).order_by(models.Produto.nome)).all()
    acabamentos = db.scalars(select(models.TabelaLabel.acabamento).distinct()).all()
    locais = db.scalars(select(models.TabelaAliquota).order_by(models.TabelaAliquota.ordem)).all()
    param = servico.parametros(db)
    return {
        "produtos": [{"id": p.id, "nome": p.nome, "categoria": p.categoria, "custo_base": float(p.custo_base)} for p in produtos],
        "acabamentos": sorted(acabamentos),
        "locais": [{"local": l.local, "aliquota": float(l.aliquota), "regime": l.regime} for l in locais],
        "parametros": {
            "margem_padrao": float(param.margem_padrao),
            "comissao_padrao": float(param.comissao_padrao),
            "custo_fixo_padrao": float(param.custo_fixo_padrao),
            "juros_mes": float(param.juros_mes),
            "prazo_padrao": param.prazo_padrao,
        },
    }


class CalculoIn(BaseModel):
    produto_id: int | None = None
    quantidade: int = Field(gt=0)
    acabamento: str = "sem_label"
    empresa_faturamento_id: int
    local_faturamento: str | None = None  # sobrescreve o regime da empresa, se informado
    condicao_pagamento_dias: int = Field(default=0, ge=0)
    margem: float | None = Field(default=None, ge=0, lt=0.95)
    comissao: float | None = Field(default=None, ge=0, lt=0.5)
    custo_fixo: float | None = Field(default=None, ge=0, lt=0.9)
    porta_copo: bool = False
    extras: list[dict] | None = None


def _calcular(db: Session, payload: CalculoIn, empresa_id: int | None = None, local: str | None = ...) -> dict:
    return servico.calcular_com_contexto(
        db,
        produto_id=payload.produto_id,
        quantidade=payload.quantidade,
        acabamento=payload.acabamento,
        empresa_faturamento_id=empresa_id or payload.empresa_faturamento_id,
        local_faturamento=payload.local_faturamento if local is ... else local,
        condicao_pagamento_dias=payload.condicao_pagamento_dias,
        margem=payload.margem,
        comissao=payload.comissao,
        custo_fixo=payload.custo_fixo,
        porta_copo=payload.porta_copo,
        extras=payload.extras,
    )


@router.post("/calcular")
def calcular(payload: CalculoIn, db: Session = Depends(get_db)):
    """Calcula o preço em tempo real, sem salvar (usado pela calculadora)."""
    return _calcular(db, payload)


@router.post("/comparar")
def comparar_empresas(payload: CalculoIn, db: Session = Depends(get_db)):
    """Mesma configuração nas duas empresas: qual faturamento sai mais vantajoso?"""
    empresas = db.scalars(select(models.Empresa).where(models.Empresa.ativa).order_by(models.Empresa.nome)).all()
    cenarios = []
    for e in empresas:
        # local None → alíquota derivada do regime da empresa (nada de digitação)
        r = _calcular(db, payload, empresa_id=e.id, local=None)
        cenarios.append({
            "empresa_id": e.id, "empresa": e.nome, "regime": e.regime,
            "aliquota_imposto": r["aliquota_imposto"], "preco_a_vista": r["preco_a_vista"],
            "preco_a_prazo": r["preco_a_prazo"], "total": r["total"],
        })
    if len(cenarios) >= 2:
        melhor = min(cenarios, key=lambda c: c["total"])
        pior = max(cenarios, key=lambda c: c["total"])
        economia = pior["total"] - melhor["total"]
    else:
        melhor, economia = (cenarios[0] if cenarios else None), 0
    return {"cenarios": cenarios, "melhor_empresa_id": melhor["empresa_id"] if melhor else None, "economia": economia}


# ===================== Cadastros (escrita: admin/financeiro) =====================

_EDITA = [Depends(exigir_admin_ou_financeiro)]


class ProdutoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    categoria: str = "outro"
    unidade: str = "un"
    custo_base: float = Field(default=0, ge=0)
    montagem_por_chapa: int = Field(default=1, ge=1)
    ativo: bool = True


@router.post("/produtos", dependencies=_EDITA)
def criar_produto(payload: ProdutoIn, db: Session = Depends(get_db)):
    p = models.Produto(**payload.model_dump())
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.put("/produtos/{produto_id}", dependencies=_EDITA)
def editar_produto(produto_id: int, payload: ProdutoIn, db: Session = Depends(get_db)):
    p = db.get(models.Produto, produto_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    for campo, valor in payload.model_dump().items():
        setattr(p, campo, valor)
    db.commit()
    return {"ok": True}


@router.delete("/produtos/{produto_id}", dependencies=_EDITA)
def excluir_produto(produto_id: int, db: Session = Depends(get_db)):
    p = db.get(models.Produto, produto_id)
    if not p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    p.ativo = False  # nunca apaga: orçamentos antigos referenciam
    db.commit()
    return {"ok": True}


class FaixaLabelIn(BaseModel):
    quantidade_min: int = Field(gt=0)
    preco_unitario: float = Field(ge=0)


class TabelaLabelIn(BaseModel):
    acabamento: str = Field(min_length=1, max_length=30)
    faixas: list[FaixaLabelIn] = Field(min_length=1)


@router.get("/tabelas-label")
def listar_tabelas_label(db: Session = Depends(get_db)):
    linhas = db.scalars(select(models.TabelaLabel).order_by(models.TabelaLabel.acabamento, models.TabelaLabel.quantidade_min)).all()
    por_acabamento: dict[str, list] = {}
    for l in linhas:
        por_acabamento.setdefault(l.acabamento, []).append({"quantidade_min": l.quantidade_min, "preco_unitario": float(l.preco_unitario)})
    return [{"acabamento": a, "faixas": f} for a, f in sorted(por_acabamento.items())]


@router.put("/tabelas-label", dependencies=_EDITA)
def salvar_tabela_label(payload: TabelaLabelIn, db: Session = Depends(get_db)):
    """Substitui todas as faixas de um acabamento (edição pela tela, atômica)."""
    for antiga in db.scalars(select(models.TabelaLabel).where(models.TabelaLabel.acabamento == payload.acabamento)).all():
        db.delete(antiga)
    for faixa in payload.faixas:
        db.add(models.TabelaLabel(acabamento=payload.acabamento, quantidade_min=faixa.quantidade_min, preco_unitario=faixa.preco_unitario))
    db.commit()
    return {"ok": True, "faixas": len(payload.faixas)}


class AliquotaIn(BaseModel):
    local: str = Field(min_length=1, max_length=60)
    aliquota: float = Field(ge=0, lt=0.6)


@router.put("/tabelas-aliquota", dependencies=_EDITA)
def salvar_aliquota(payload: AliquotaIn, db: Session = Depends(get_db)):
    row = db.scalar(select(models.TabelaAliquota).where(models.TabelaAliquota.local == payload.local))
    if row:
        row.aliquota = payload.aliquota
    else:
        db.add(models.TabelaAliquota(local=payload.local, aliquota=payload.aliquota, ordem=50))
    db.commit()
    return {"ok": True}


class ParametrosIn(BaseModel):
    margem_padrao: float = Field(ge=0, lt=0.9)
    comissao_padrao: float = Field(ge=0, lt=0.5)
    custo_fixo_padrao: float = Field(ge=0, lt=0.9)
    juros_mes: float = Field(ge=0, lt=0.2)
    prazo_padrao: int = Field(ge=0, le=360)


@router.put("/parametros", dependencies=_EDITA)
def salvar_parametros(payload: ParametrosIn, db: Session = Depends(get_db)):
    param = servico.parametros(db)
    for campo, valor in payload.model_dump().items():
        setattr(param, campo, valor)
    db.commit()
    return {"ok": True}
