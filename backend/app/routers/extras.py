"""Orcado x Realizado, dupla conferencia e comentarios — por projeto (chave BR)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import cache, models
from ..auth import exigir_admin, guarda_custeio, usuario_logado
from ..db import get_db
from ..services import conferencia
from ..services.calculo import chave_projeto, fechar_projetos
from .projetos import _empresa_ids

router = APIRouter(prefix="/api", tags=["extras"])


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
def salvar_orcamento(
    payload: OrcamentoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_logado),
):
    chave = chave_projeto(payload.nome)
    row = db.get(models.Orcamento, chave)
    if row is None:
        row = models.Orcamento(chave_projeto=chave)
        db.add(row)
    row.nome_exibicao = payload.nome
    row.receita_prevista = payload.receita_prevista
    row.custo_previsto = payload.custo_previsto
    row.atualizado_por = usuario.nome
    db.commit()
    cache.invalidar()  # alertas de orcamento estourado dependem disto
    return obter_orcamento(payload.nome, db)


# ---------- Dupla conferencia (dois ok por projeto) ----------


class AprovacaoIn(BaseModel):
    nome: str = Field(min_length=1)
    empresa_ids: str | None = None
    de: date | None = None
    ate: date | None = None


@router.post("/aprovacoes", status_code=201)
def aprovar(
    payload: AprovacaoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(guarda_custeio),
):
    """Da o proximo ok do projeto: 1o = conferencia, 2o = aprovacao (outra pessoa)."""
    ids = _empresa_ids(db, payload.empresa_ids)
    fechamento = fechar_projetos(db, ids, payload.de, payload.ate)
    chave = chave_projeto(payload.nome)
    linha = next((p for p in fechamento["projetos"] if chave_projeto(p["projeto"]) == chave), None)
    if not linha:
        raise HTTPException(status_code=404, detail="Projeto sem fechamento no período/empresas informados")
    try:
        row = conferencia.registrar(db, usuario, payload.nome, linha, payload.de, payload.ate)
    except conferencia.ConferenciaInvalida as erro:
        raise HTTPException(status_code=erro.status, detail=erro.mensagem) from erro
    return _aprovacao_out(row)


class LoteIn(BaseModel):
    nomes: list[str] = Field(min_length=1, max_length=1000)
    empresa_ids: str | None = None
    de: date | None = None
    ate: date | None = None


@router.post("/aprovacoes/lote")
def aprovar_lote(
    payload: LoteIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(guarda_custeio),
):
    """Da o proximo ok de varios projetos de uma vez.

    Recusa individual nao derruba o lote — devolve o que foi aplicado e o que
    sobrou, com o motivo de cada um.
    """
    ids = _empresa_ids(db, payload.empresa_ids)
    fechamento = fechar_projetos(db, ids, payload.de, payload.ate)
    por_chave = {chave_projeto(p["projeto"]): p for p in fechamento["projetos"]}

    linhas: dict[str, dict] = {}
    recusados: list[dict] = []
    for nome in payload.nomes:
        linha = por_chave.get(chave_projeto(nome))
        if linha is None:
            recusados.append({"projeto": nome, "motivo": "Sem fechamento no período/empresas selecionados"})
        else:
            linhas[nome] = linha

    aplicados, recusados_regra = conferencia.registrar_lote(db, usuario, linhas, payload.de, payload.ate)
    return {"aplicados": aplicados, "recusados": recusados + recusados_regra}


@router.delete("/aprovacoes/{ok_id}")
def desfazer_aprovacao(
    ok_id: int,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(exigir_admin),
):
    """Desfaz um ok — so admin. A linha fica no historico, marcada como desfeita."""
    try:
        row = conferencia.revogar(db, admin, ok_id)
    except conferencia.ConferenciaInvalida as erro:
        raise HTTPException(status_code=erro.status, detail=erro.mensagem) from erro
    return _aprovacao_out(row)


def _aprovacao_out(row: models.FechamentoAprovado) -> dict:
    return {
        "id": row.id,
        "nome": row.nome,
        "nivel": row.nivel,
        "rotulo": conferencia.ROTULO_NIVEL.get(row.nivel, ""),
        "periodo_de": row.periodo_de.isoformat() if row.periodo_de else None,
        "periodo_ate": row.periodo_ate.isoformat() if row.periodo_ate else None,
        "dados": row.dados,
        "usuario": row.usuario,
        "criado_em": row.criado_em.isoformat(),
        "revogado_em": row.revogado_em.isoformat() if row.revogado_em else None,
        "revogado_por": row.revogado_por,
    }


@router.get("/aprovacoes")
def listar_aprovacoes(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    """Historico completo do projeto, do mais recente ao mais antigo (inclui desfeitos)."""
    return [_aprovacao_out(r) for r in conferencia.historico(db, nome)]


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
def comentar(
    payload: ComentarioIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_logado),
):
    row = models.Comentario(chave_projeto=chave_projeto(payload.nome), texto=payload.texto.strip(), usuario=usuario.nome)
    db.add(row)
    db.commit()
    return listar_comentarios(payload.nome, db)
