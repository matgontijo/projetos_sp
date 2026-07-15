"""Orcado x Realizado, aprovacao de fechamento e comentarios — por projeto (chave BR)."""

from datetime import date
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..services.calculo import chave_projeto, fechar_projetos
from .projetos import _empresa_ids

router = APIRouter(prefix="/api", tags=["extras"])


def _usuario(x_usuario: str) -> str:
    return unquote(x_usuario or "") or "não identificado"


# ---------- Orcado x Realizado ----------


class OrcamentoIn(BaseModel):
    nome: str = Field(min_length=1)
    receita_prevista: float | None = Field(default=None, ge=0)
    custo_previsto: float | None = Field(default=None, ge=0)


@router.get("/orcamentos")
def obter_orcamento(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    row = db.get(models.Orcamento, chave_projeto(nome))
    if not row:
        return {"nome": nome, "receita_prevista": None, "custo_previsto": None, "atualizado_por": "", "atualizado_em": None}
    return {
        "nome": row.nome_exibicao or nome,
        "receita_prevista": float(row.receita_prevista) if row.receita_prevista is not None else None,
        "custo_previsto": float(row.custo_previsto) if row.custo_previsto is not None else None,
        "atualizado_por": row.atualizado_por,
        "atualizado_em": row.atualizado_em.isoformat() if row.atualizado_em else None,
    }


@router.put("/orcamentos")
def salvar_orcamento(payload: OrcamentoIn, db: Session = Depends(get_db), x_usuario: str = Header(default="")):
    chave = chave_projeto(payload.nome)
    row = db.get(models.Orcamento, chave)
    if row is None:
        row = models.Orcamento(chave_projeto=chave)
        db.add(row)
    row.nome_exibicao = payload.nome
    row.receita_prevista = payload.receita_prevista
    row.custo_previsto = payload.custo_previsto
    row.atualizado_por = _usuario(x_usuario)
    db.commit()
    return obter_orcamento(payload.nome, db)


# ---------- Fechamento aprovado ----------


class AprovacaoIn(BaseModel):
    nome: str = Field(min_length=1)
    empresa_ids: str | None = None
    de: date | None = None
    ate: date | None = None


@router.post("/aprovacoes", status_code=201)
def aprovar(payload: AprovacaoIn, db: Session = Depends(get_db), x_usuario: str = Header(default="")):
    ids = _empresa_ids(db, payload.empresa_ids)
    fechamento = fechar_projetos(db, ids, payload.de, payload.ate)
    chave = chave_projeto(payload.nome)
    linha = next((p for p in fechamento["projetos"] if chave_projeto(p["projeto"]) == chave), None)
    if not linha:
        raise HTTPException(status_code=404, detail="Projeto sem fechamento no período/empresas informados")
    row = models.FechamentoAprovado(
        chave_projeto=chave,
        nome=linha["projeto"],
        periodo_de=payload.de,
        periodo_ate=payload.ate,
        dados=linha,
        usuario=_usuario(x_usuario),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _aprovacao_out(row)


def _aprovacao_out(row: models.FechamentoAprovado) -> dict:
    return {
        "id": row.id,
        "nome": row.nome,
        "periodo_de": row.periodo_de.isoformat() if row.periodo_de else None,
        "periodo_ate": row.periodo_ate.isoformat() if row.periodo_ate else None,
        "dados": row.dados,
        "usuario": row.usuario,
        "criado_em": row.criado_em.isoformat(),
    }


@router.get("/aprovacoes")
def listar_aprovacoes(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(models.FechamentoAprovado)
        .where(models.FechamentoAprovado.chave_projeto == chave_projeto(nome))
        .order_by(models.FechamentoAprovado.id.desc())
    ).all()
    return [_aprovacao_out(r) for r in rows]


# ---------- Comentarios ----------


class ComentarioIn(BaseModel):
    nome: str = Field(min_length=1)
    texto: str = Field(min_length=1, max_length=4000)


@router.get("/comentarios")
def listar_comentarios(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(models.Comentario)
        .where(models.Comentario.chave_projeto == chave_projeto(nome))
        .order_by(models.Comentario.id.desc())
    ).all()
    return [
        {"id": c.id, "texto": c.texto, "usuario": c.usuario, "criado_em": c.criado_em.isoformat()} for c in rows
    ]


@router.post("/comentarios", status_code=201)
def comentar(payload: ComentarioIn, db: Session = Depends(get_db), x_usuario: str = Header(default="")):
    row = models.Comentario(chave_projeto=chave_projeto(payload.nome), texto=payload.texto.strip(), usuario=_usuario(x_usuario))
    db.add(row)
    db.commit()
    return listar_comentarios(payload.nome, db)
