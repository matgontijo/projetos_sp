from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..auth import guarda_precificacao
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


@router.post("/calcular")
def calcular(payload: CalculoIn, db: Session = Depends(get_db)):
    """Calcula o preço em tempo real, sem salvar (usado pela calculadora)."""
    return servico.calcular_com_contexto(
        db,
        produto_id=payload.produto_id,
        quantidade=payload.quantidade,
        acabamento=payload.acabamento,
        empresa_faturamento_id=payload.empresa_faturamento_id,
        local_faturamento=payload.local_faturamento,
        condicao_pagamento_dias=payload.condicao_pagamento_dias,
        margem=payload.margem,
        comissao=payload.comissao,
        custo_fixo=payload.custo_fixo,
        porta_copo=payload.porta_copo,
        extras=payload.extras,
    )
