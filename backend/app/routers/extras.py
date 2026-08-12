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
    # o que a proposta projetava de LUCRO (pode ser negativo em projeto-isca)
    resultado_previsto: float | None = None
    # legado: telas antigas ainda podem mandar os dois
    receita_prevista: float | None = Field(default=None, ge=0)
    custo_previsto: float | None = Field(default=None, ge=0)


def _projetado(row: models.Orcamento) -> float | None:
    """Resultado projetado: o campo direto ou, nos registros antigos, receita − custo."""
    if row.resultado_previsto is not None:
        return float(row.resultado_previsto)
    if row.receita_prevista is not None and row.custo_previsto is not None:
        return float(row.receita_prevista) - float(row.custo_previsto)
    return None


@router.get("/orcamentos")
def obter_orcamento(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    row = db.get(models.Orcamento, chave_projeto(nome))
    if not row:
        return {
            "nome": nome,
            "resultado_previsto": None,
            "receita_prevista": None,
            "custo_previsto": None,
            "atualizado_por": "",
            "atualizado_em": None,
        }
    return {
        "nome": row.nome_exibicao or nome,
        "resultado_previsto": _projetado(row),
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
    row.resultado_previsto = payload.resultado_previsto
    if payload.receita_prevista is not None or payload.custo_previsto is not None:
        row.receita_prevista = payload.receita_prevista
        row.custo_previsto = payload.custo_previsto
    elif payload.resultado_previsto is not None:
        # a tela agora pede so o resultado: os campos antigos nao valem mais
        row.receita_prevista = None
        row.custo_previsto = None
    row.atualizado_por = usuario.nome
    db.commit()
    cache.invalidar()  # os alertas de projeto abaixo do projetado dependem disto
    return obter_orcamento(payload.nome, db)


# ---------- Tributação do projeto (perfil de operação) ----------
# A operação muda o imposto: venda padrão SP paga a tabela cheia; fins de
# exportação (CFOP 5502) não tem PIS/COFINS/ICMS. O projeto aponta um perfil
# cadastrado nas empresas; sem escolha, vale a tabela padrão de cada uma.


class TributacaoIn(BaseModel):
    nome: str = Field(min_length=1)
    perfil: str | None = None  # None = voltar ao padrão da empresa


@router.get("/tributacao")
def obter_tributacao(nome: str = Query(min_length=1), db: Session = Depends(get_db)):
    row = db.get(models.TributacaoProjeto, chave_projeto(nome))
    # opções = nomes de perfil existentes nas empresas ativas (união, sem repetição)
    nomes_perfis = sorted(
        {
            p.nome
            for p in db.scalars(
                select(models.PerfilTributacao).join(
                    models.Empresa, models.Empresa.id == models.PerfilTributacao.empresa_id
                ).where(models.Empresa.ativa)
            ).all()
        },
        key=str.lower,
    )
    return {
        "nome": nome,
        "perfil": row.perfil if row else None,
        "opcoes": nomes_perfis,
        "atualizado_por": row.atualizado_por if row else "",
        "atualizado_em": row.atualizado_em.isoformat() if row and row.atualizado_em else None,
    }


@router.put("/tributacao")
def definir_tributacao(
    payload: TributacaoIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(guarda_custeio),
):
    # tributação muda o imposto do fechamento: projeto aprovado está travado
    if conferencia.projeto_aprovado(db, payload.nome):
        raise HTTPException(status_code=409, detail=conferencia.TRAVADO_MENSAGEM)
    chave = chave_projeto(payload.nome)
    row = db.get(models.TributacaoProjeto, chave)
    if payload.perfil is None:
        if row is not None:
            db.delete(row)
    else:
        existe = db.scalar(
            select(models.PerfilTributacao).where(models.PerfilTributacao.nome == payload.perfil)
        )
        if existe is None:
            raise HTTPException(status_code=422, detail="Perfil inexistente — cadastre em Empresas primeiro")
        if row is None:
            row = models.TributacaoProjeto(chave_projeto=chave)
            db.add(row)
        row.perfil = payload.perfil
        row.atualizado_por = usuario.nome
    db.commit()
    cache.invalidar()  # o imposto do projeto mudou
    return obter_tributacao(payload.nome, db)


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
