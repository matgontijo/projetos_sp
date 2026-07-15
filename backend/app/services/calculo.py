"""Motor de fechamento: agrupa titulos e NF-e por projeto e apura resultado/margem.

Regras (do levantamento de requisitos):
- A operacao fatura o MESMO projeto por mais de uma empresa (ex.: uma no Lucro
  Presumido e outra no Simples). A chave de consolidacao e o NUMERO do projeto
  (campo `nome` do cadastro de projetos da Omie, ex.: BR26_055) — o codigo
  interno e diferente em cada conta Omie.
- receita  = soma dos titulos de Contas a Receber do projeto (cancelados fora)
- custos   = titulos de Contas a Pagar por grupo do mapeamento de categorias
             (producao / frete / comissao / outros; rateio `categorias[]` respeitado)
- comissao ENTRA no custo do projeto (regra da cliente, igual a planilha delas)
- imposto  = tributos destacados nas NF-e do projeto (ICMS, ST, FCP, FCPST, IPI,
             PIS, COFINS, IBS/CBS) + Simples efetivo sobre a parcela da receita
             faturada por empresa marcada como Simples
- CP de tributos (grupo 'imposto') NUNCA soma no custo — o imposto ja vem da NF-e;
  somar de novo duplicaria. Ficam visiveis no detalhe.
- custo_total = producao + frete + imposto + outros
- resultado   = receita - custo_total;  margem = resultado/receita (0 se receita 0)
- Ajustes manuais auditaveis sao aplicados por cima do cache.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from . import simples

SEM_PROJETO_NOME = "Sem projeto"

# Regra de negocio (definida pelas donas): so entra no fechamento PROJETO DE
# VENDA, e projeto de venda e o que comeca com "BR" (ex.: BR26_055). Centros
# de custo cadastrados como projeto na Omie (Administrativo, Estoque, Diversos)
# e lancamentos sem projeto ficam fora — nao aparecem nem somam na receita.
PREFIXO_PROJETO_VENDA = "BR"


def _f(value) -> float:
    return float(value or 0)


def chave_projeto(nome: str) -> str:
    # A numeracao de projetos e digitada com variacoes ("BR25_460 _B10",
    # "BR25_485_33.B01.A" vs "BR25_485 - 33 B01 A"). Espacos, '.', '_' e '-'
    # nao sao significativos na numeracao (que e zero-padded), entao a chave
    # os ignora para unir as duplicatas de digitacao.
    return re.sub(r"[\s._-]+", "", (nome or "")).upper()


def e_projeto_de_venda(nome: str) -> bool:
    return chave_projeto(nome).startswith(PREFIXO_PROJETO_VENDA)


@dataclass
class LinhaFechamento:
    projeto: str  # numero legivel (ex.: BR26_055), consolidado entre empresas
    cliente: str = ""
    receita: float = 0.0
    producao: float = 0.0
    frete: float = 0.0
    comissao: float = 0.0
    outros: float = 0.0
    imposto_nfe: float = 0.0
    imposto_simples: float = 0.0
    imposto_extra: float = 0.0  # % extra s/ receita (ex.: IRPJ/CSLL Presumido)
    cp_impostos: float = 0.0  # informativo, fora do custo
    nao_classificado: float = 0.0  # parcela de 'outros' sem categoria mapeada
    qtd_receber: int = 0
    qtd_pagar: int = 0
    qtd_nfe: int = 0
    empresas: set = field(default_factory=set, repr=False)  # nomes das empresas envolvidas
    _clientes: Counter = field(default_factory=Counter, repr=False)

    @property
    def imposto(self) -> float:
        return self.imposto_nfe + self.imposto_simples + self.imposto_extra

    @property
    def custo_total(self) -> float:
        return self.producao + self.frete + self.comissao + self.imposto + self.outros

    @property
    def resultado(self) -> float:
        return self.receita - self.custo_total

    @property
    def margem(self) -> float:
        return self.resultado / self.receita if self.receita > 0 else 0.0

    def as_dict(self) -> dict:
        return {
            "projeto": self.projeto,
            "empresas": ", ".join(sorted(self.empresas)),
            "cliente": self.cliente,
            "receita": round(self.receita, 2),
            "producao": round(self.producao, 2),
            "frete": round(self.frete, 2),
            "comissao": round(self.comissao, 2),
            "outros": round(self.outros, 2),
            "imposto": round(self.imposto, 2),
            "imposto_nfe": round(self.imposto_nfe, 2),
            "imposto_simples": round(self.imposto_simples, 2),
            "imposto_extra": round(self.imposto_extra, 2),
            "cp_impostos": round(self.cp_impostos, 2),
            "nao_classificado": round(self.nao_classificado, 2),
            "custo_total": round(self.custo_total, 2),
            "resultado": round(self.resultado, 2),
            "margem": round(self.margem, 6),
            "qtd_receber": self.qtd_receber,
            "qtd_pagar": self.qtd_pagar,
            "qtd_nfe": self.qtd_nfe,
        }


class _Ajustes:
    """Ultimo ajuste vigente por (alvo_tipo, alvo_id, campo)."""

    def __init__(self, rows: list[models.Ajuste]):
        self._map: dict[tuple[str, int, str], str] = {}
        for row in rows:  # rows em ordem crescente de id -> ultimo vence
            self._map[(row.alvo_tipo, row.alvo_id, row.campo)] = row.valor_novo

    def get(self, alvo_tipo: str, alvo_id: int, campo: str) -> str | None:
        return self._map.get((alvo_tipo, alvo_id, campo))

    def excluido(self, alvo_tipo: str, alvo_id: int) -> bool:
        return (self.get(alvo_tipo, alvo_id, "excluir") or "").upper() == "S"

    def projeto(self, alvo_tipo: str, alvo_id: int) -> int | None:
        valor = self.get(alvo_tipo, alvo_id, "codigo_projeto")
        if valor is None:
            return None
        try:
            return int(valor)
        except ValueError:
            return None


def _cancelado(status: str) -> bool:
    return (status or "").strip().upper() == "CANCELADO"


def carregar_ajustes(db: Session, empresa_ids: list[int]) -> _Ajustes:
    rows = db.scalars(
        select(models.Ajuste).where(models.Ajuste.empresa_id.in_(empresa_ids)).order_by(models.Ajuste.id)
    ).all()
    return _Ajustes(rows)


def grupos_por_categoria(db: Session, empresa_ids: list[int]) -> dict[tuple[int, str], str | None]:
    rows = db.scalars(select(models.CategoriaGrupo).where(models.CategoriaGrupo.empresa_id.in_(empresa_ids))).all()
    return {(r.empresa_id, r.codigo_categoria): r.grupo for r in rows}


def imposto_da_nfe(nfe: models.NFe) -> float:
    return (
        _f(nfe.v_icms)
        + _f(nfe.v_st)
        + _f(nfe.v_fcp)
        + _f(nfe.v_fcpst)
        + _f(nfe.v_ipi)
        + _f(nfe.v_pis)
        + _f(nfe.v_cofins)
        + _f(nfe.v_ibs)
        + _f(nfe.v_cbs)
    )


def _parcelas_do_titulo(
    titulo: models.Titulo, grupos: dict[tuple[int, str], str | None], grupo_override: str | None
) -> list[tuple[str | None, float]]:
    """(grupo, valor) por parcela do titulo, respeitando rateio de categorias."""
    if grupo_override:
        return [(grupo_override, _f(titulo.valor_documento))]
    rateio = titulo.categorias_rateio or []
    if rateio:
        parcelas = []
        for item in rateio:
            categoria = str((item or {}).get("codigo_categoria") or "")
            valor = _f((item or {}).get("valor"))
            if not valor:
                valor = _f(titulo.valor_documento) * _f((item or {}).get("percentual")) / 100.0
            parcelas.append((grupos.get((titulo.empresa_id, categoria)), valor))
        return parcelas
    return [(grupos.get((titulo.empresa_id, titulo.codigo_categoria)), _f(titulo.valor_documento))]


class _Contexto:
    """Carrega e indexa tudo que o fechamento e o detalhe usam em comum."""

    def __init__(self, db: Session, empresa_ids: list[int], de: date | None, ate: date | None):
        self.db = db
        self.empresa_ids = empresa_ids
        self.empresas = {
            e.id: e for e in db.scalars(select(models.Empresa).where(models.Empresa.id.in_(empresa_ids))).all()
        }
        self.projetos = {
            (p.empresa_id, p.codigo_omie): p
            for p in db.scalars(select(models.Projeto).where(models.Projeto.empresa_id.in_(empresa_ids))).all()
        }
        self.clientes = {
            (c.empresa_id, c.codigo_cliente_omie): c
            for c in db.scalars(select(models.Cliente).where(models.Cliente.empresa_id.in_(empresa_ids))).all()
        }
        self.grupos = grupos_por_categoria(db, empresa_ids)
        self.ajustes = carregar_ajustes(db, empresa_ids)

        query_titulos = select(models.Titulo).where(models.Titulo.empresa_id.in_(empresa_ids))
        if de:
            query_titulos = query_titulos.where(models.Titulo.data_emissao >= de)
        if ate:
            query_titulos = query_titulos.where(models.Titulo.data_emissao <= ate)
        self.titulos = db.scalars(query_titulos.order_by(models.Titulo.data_emissao)).all()

        query_nfe = select(models.NFe).where(models.NFe.empresa_id.in_(empresa_ids))
        if de:
            query_nfe = query_nfe.where(models.NFe.d_emi >= de)
        if ate:
            query_nfe = query_nfe.where(models.NFe.d_emi <= ate)
        self.nfes = db.scalars(query_nfe.order_by(models.NFe.d_emi)).all()

    def nome_empresa(self, empresa_id: int) -> str:
        empresa = self.empresas.get(empresa_id)
        return empresa.nome if empresa else ""

    def nome_projeto(self, empresa_id: int, codigo: int | None) -> str:
        """Nome consolidavel do projeto (numero legivel); codigo e interno por empresa."""
        if not codigo:
            return SEM_PROJETO_NOME
        projeto = self.projetos.get((empresa_id, codigo))
        if projeto and projeto.nome and projeto.nome.strip():
            return projeto.nome.strip()
        return f"Projeto {codigo}"

    def projeto_do_titulo(self, titulo: models.Titulo) -> str:
        # ajuste 0 = "mover para Sem projeto" — distinto de None (sem ajuste)
        ajuste = self.ajustes.projeto("titulo", titulo.id)
        codigo = ajuste if ajuste is not None else titulo.codigo_projeto_omie
        return self.nome_projeto(titulo.empresa_id, codigo)

    def projeto_da_nfe(self, nfe: models.NFe) -> str:
        ajuste = self.ajustes.projeto("nfe", nfe.id)
        codigo = ajuste if ajuste is not None else nfe.codigo_projeto_omie
        return self.nome_projeto(nfe.empresa_id, codigo)


def fechar_projetos(
    db: Session,
    empresa_ids: list[int],
    de: date | None = None,
    ate: date | None = None,
) -> dict:
    """Fechamento por projeto (consolidado entre empresas) + consolidado geral."""
    ctx = _Contexto(db, empresa_ids, de, ate)
    linhas: dict[str, LinhaFechamento] = {}

    def linha(nome: str) -> LinhaFechamento:
        chave = chave_projeto(nome) or chave_projeto(SEM_PROJETO_NOME)
        if chave not in linhas:
            linhas[chave] = LinhaFechamento(projeto=nome)
        return linhas[chave]

    # --- Contas a Receber: receita (+ base do Simples por empresa/competencia) ---
    receita_simples: dict[tuple[int, str, str], float] = defaultdict(float)
    for titulo in ctx.titulos:
        if titulo.tipo != "receber" or _cancelado(titulo.status_titulo):
            continue
        if ctx.ajustes.excluido("titulo", titulo.id):
            continue
        nome = ctx.projeto_do_titulo(titulo)
        if not e_projeto_de_venda(nome):
            continue
        ln = linha(nome)
        valor = _f(titulo.valor_documento)
        ln.receita += valor
        ln.qtd_receber += 1
        ln.empresas.add(ctx.nome_empresa(titulo.empresa_id))
        if titulo.codigo_cliente_fornecedor:
            ln._clientes[(titulo.empresa_id, titulo.codigo_cliente_fornecedor)] += 1
        empresa = ctx.empresas.get(titulo.empresa_id)
        if empresa and empresa.regime == "simples" and titulo.data_emissao:
            competencia = titulo.data_emissao.strftime("%Y-%m")
            receita_simples[(titulo.empresa_id, chave_projeto(nome), competencia)] += valor
        if empresa and _f(empresa.aliquota_extra) > 0:
            # impostos fora da NF-e (ex.: IRPJ/CSLL do Presumido), % sobre a receita
            ln.imposto_extra += valor * _f(empresa.aliquota_extra) / 100.0

    # --- Contas a Pagar: custos por grupo ---
    for titulo in ctx.titulos:
        if titulo.tipo != "pagar" or _cancelado(titulo.status_titulo):
            continue
        if ctx.ajustes.excluido("titulo", titulo.id):
            continue
        nome = ctx.projeto_do_titulo(titulo)
        if not e_projeto_de_venda(nome):
            continue
        ln = linha(nome)
        ln.qtd_pagar += 1
        ln.empresas.add(ctx.nome_empresa(titulo.empresa_id))
        grupo_override = ctx.ajustes.get("titulo", titulo.id, "grupo")
        for grupo, valor in _parcelas_do_titulo(titulo, ctx.grupos, grupo_override):
            if grupo == "ignorar":
                continue
            if grupo == "producao":
                ln.producao += valor
            elif grupo == "frete":
                ln.frete += valor
            elif grupo == "comissao":
                ln.comissao += valor
            elif grupo == "imposto":
                # tributo pago (gerado pela Omie): visivel, mas fora do custo — o
                # imposto do projeto vem da NF-e; somar aqui duplicaria
                ln.cp_impostos += valor
            else:
                ln.outros += valor
                if grupo is None:
                    ln.nao_classificado += valor

    # --- NF-e: impostos destacados ---
    for nfe in ctx.nfes:
        if nfe.cancelada or str(nfe.tp_nf) != "1":
            continue
        if ctx.ajustes.excluido("nfe", nfe.id):
            continue
        nome = ctx.projeto_da_nfe(nfe)
        if not e_projeto_de_venda(nome):
            continue
        ln = linha(nome)
        ln.empresas.add(ctx.nome_empresa(nfe.empresa_id))
        override = ctx.ajustes.get("nfe", nfe.id, "valor_imposto")
        if override is not None:
            try:
                imposto = float(override.replace(",", "."))
            except ValueError:
                imposto = imposto_da_nfe(nfe)
        else:
            imposto = imposto_da_nfe(nfe)
        ln.imposto_nfe += imposto
        ln.qtd_nfe += 1

    # --- Simples Nacional: aliquota efetiva da empresa x receita dela na competencia ---
    aliquotas: dict[tuple[int, str], float] = {}
    for (empresa_id, chave, competencia), valor in receita_simples.items():
        chave_aliq = (empresa_id, competencia)
        if chave_aliq not in aliquotas:
            aliquotas[chave_aliq] = simples.aliquota_da_competencia(db, ctx.empresas[empresa_id], competencia)
        linhas[chave].imposto_simples += valor * aliquotas[chave_aliq]

    # --- Nome do cliente principal ---
    for ln in linhas.values():
        if ln._clientes:
            (empresa_id, codigo_cliente), _ = ln._clientes.most_common(1)[0]
            cliente = ctx.clientes.get((empresa_id, codigo_cliente))
            if cliente:
                ln.cliente = cliente.nome_fantasia or cliente.razao_social

    # so ha linhas de projetos de venda (filtro BR aplicado na entrada)
    resultado = sorted(linhas.values(), key=lambda l: l.receita, reverse=True)
    consolidado = {
        "receita": round(sum(l.receita for l in resultado), 2),
        "producao": round(sum(l.producao for l in resultado), 2),
        "frete": round(sum(l.frete for l in resultado), 2),
        "comissao": round(sum(l.comissao for l in resultado), 2),
        "outros": round(sum(l.outros for l in resultado), 2),
        "imposto": round(sum(l.imposto for l in resultado), 2),
        "cp_impostos": round(sum(l.cp_impostos for l in resultado), 2),
        "nao_classificado": round(sum(l.nao_classificado for l in resultado), 2),
        "custo_total": round(sum(l.custo_total for l in resultado), 2),
        "resultado": round(sum(l.resultado for l in resultado), 2),
        "qtd_projetos": len(resultado),
    }
    receita_total = consolidado["receita"]
    consolidado["margem_media"] = round(consolidado["resultado"] / receita_total, 6) if receita_total > 0 else 0.0

    return {"projetos": [l.as_dict() for l in resultado], "consolidado": consolidado}


def serie_mensal(
    db: Session,
    empresa_ids: list[int],
    de: date | None = None,
    ate: date | None = None,
) -> list[dict]:
    """Receita, custos, impostos e resultado por mes (mesmas regras do consolidado:
    so projetos de venda — numeracao BR)."""
    ctx = _Contexto(db, empresa_ids, de, ate)
    meses: dict[str, dict] = {}

    def mes_de(d: date | None) -> str | None:
        return d.strftime("%Y-%m") if d else None

    def linha(mes: str) -> dict:
        if mes not in meses:
            meses[mes] = {"mes": mes, "receita": 0.0, "custos": 0.0, "imposto": 0.0}
        return meses[mes]

    aliquotas: dict[tuple[int, str], float] = {}
    for titulo in ctx.titulos:
        if _cancelado(titulo.status_titulo) or ctx.ajustes.excluido("titulo", titulo.id):
            continue
        if not e_projeto_de_venda(ctx.projeto_do_titulo(titulo)):
            continue
        mes = mes_de(titulo.data_emissao)
        if not mes:
            continue
        ln = linha(mes)
        if titulo.tipo == "receber":
            valor = _f(titulo.valor_documento)
            ln["receita"] += valor
            empresa = ctx.empresas.get(titulo.empresa_id)
            if empresa and empresa.regime == "simples":
                chave_aliq = (titulo.empresa_id, mes)
                if chave_aliq not in aliquotas:
                    aliquotas[chave_aliq] = simples.aliquota_da_competencia(db, empresa, mes)
                ln["imposto"] += valor * aliquotas[chave_aliq]
            if empresa and _f(empresa.aliquota_extra) > 0:
                ln["imposto"] += valor * _f(empresa.aliquota_extra) / 100.0
        else:
            grupo_override = ctx.ajustes.get("titulo", titulo.id, "grupo")
            for grupo, valor in _parcelas_do_titulo(titulo, ctx.grupos, grupo_override):
                if grupo in ("ignorar", "imposto"):
                    continue  # imposto de CP nao soma (vem da NF-e); ignorar fica fora
                ln["custos"] += valor

    for nfe in ctx.nfes:
        if nfe.cancelada or str(nfe.tp_nf) != "1" or ctx.ajustes.excluido("nfe", nfe.id):
            continue
        if not e_projeto_de_venda(ctx.projeto_da_nfe(nfe)):
            continue
        mes = mes_de(nfe.d_emi)
        if not mes:
            continue
        override = ctx.ajustes.get("nfe", nfe.id, "valor_imposto")
        try:
            imposto = float(override.replace(",", ".")) if override else imposto_da_nfe(nfe)
        except ValueError:
            imposto = imposto_da_nfe(nfe)
        linha(mes)["imposto"] += imposto

    resultado = []
    for mes in sorted(meses):
        ln = meses[mes]
        ln = {k: (round(v, 2) if isinstance(v, float) else v) for k, v in ln.items()}
        ln["resultado"] = round(ln["receita"] - ln["custos"] - ln["imposto"], 2)
        resultado.append(ln)
    return resultado


def detalhe_projeto(
    db: Session,
    empresa_ids: list[int],
    nome_projeto: str,
    de: date | None = None,
    ate: date | None = None,
    fechamento: dict | None = None,
) -> dict:
    """Detalhe aberto de um projeto (consolidado entre as empresas selecionadas)."""
    chave = chave_projeto(nome_projeto)
    if fechamento is None:
        fechamento = fechar_projetos(db, empresa_ids, de, ate)
    linha = next((p for p in fechamento["projetos"] if chave_projeto(p["projeto"]) == chave), None)

    ctx = _Contexto(db, empresa_ids, de, ate)

    titulos_out = []
    for t in ctx.titulos:
        if chave_projeto(ctx.projeto_do_titulo(t)) != chave:
            continue
        grupo_override = ctx.ajustes.get("titulo", t.id, "grupo")
        # mesmas parcelas usadas no fechamento (respeita rateio de categorias),
        # para o detalhe SEMPRE conciliar com a linha consolidada
        parcelas = _parcelas_do_titulo(t, ctx.grupos, grupo_override) if t.tipo == "pagar" else []
        if grupo_override:
            grupo = grupo_override
        elif len(parcelas) > 1:
            grupo = "rateado"
        else:
            grupo = ctx.grupos.get((t.empresa_id, t.codigo_categoria))
        titulos_out.append(
            {
                "id": t.id,
                "empresa_id": t.empresa_id,
                "empresa_nome": ctx.nome_empresa(t.empresa_id),
                "tipo": t.tipo,
                "codigo_lancamento_omie": t.codigo_lancamento_omie,
                "data_emissao": t.data_emissao.isoformat() if t.data_emissao else None,
                "data_vencimento": t.data_vencimento.isoformat() if t.data_vencimento else None,
                "valor_documento": _f(t.valor_documento),
                "codigo_categoria": t.codigo_categoria,
                "grupo": grupo,
                "parcelas": [{"grupo": g, "valor": round(v, 2)} for g, v in parcelas] if len(parcelas) > 1 else [],
                "grupo_ajustado": bool(grupo_override),
                "status_titulo": t.status_titulo,
                "numero_documento": t.numero_documento,
                "numero_documento_fiscal": t.numero_documento_fiscal,
                "cancelado": _cancelado(t.status_titulo),
                "excluido": ctx.ajustes.excluido("titulo", t.id),
                "projeto_ajustado": ctx.ajustes.projeto("titulo", t.id) is not None,
            }
        )

    nfes_out = []
    for n in ctx.nfes:
        if chave_projeto(ctx.projeto_da_nfe(n)) != chave:
            continue
        override = ctx.ajustes.get("nfe", n.id, "valor_imposto")
        try:
            imposto_total = float(override.replace(",", ".")) if override else imposto_da_nfe(n)
        except ValueError:
            imposto_total = imposto_da_nfe(n)
        nfes_out.append(
            {
                "id": n.id,
                "empresa_id": n.empresa_id,
                "empresa_nome": ctx.nome_empresa(n.empresa_id),
                "n_nf": n.n_nf,
                "serie": n.serie,
                "d_emi": n.d_emi.isoformat() if n.d_emi else None,
                "dest_nome": n.dest_nome,
                "v_nf": _f(n.v_nf),
                "v_prod": _f(n.v_prod),
                "v_icms": _f(n.v_icms),
                "v_st": _f(n.v_st),
                "v_fcp": _f(n.v_fcp) + _f(n.v_fcpst),
                "v_ipi": _f(n.v_ipi),
                "v_pis": _f(n.v_pis),
                "v_cofins": _f(n.v_cofins),
                "v_ibs_cbs": _f(n.v_ibs) + _f(n.v_cbs),
                "imposto_total": imposto_total,
                "imposto_ajustado": override is not None,
                "cancelada": n.cancelada,
                "excluida": ctx.ajustes.excluido("nfe", n.id),
                "projeto_ajustado": ctx.ajustes.projeto("nfe", n.id) is not None,
            }
        )

    historico = db.scalars(
        select(models.Ajuste).where(models.Ajuste.empresa_id.in_(empresa_ids)).order_by(models.Ajuste.id.desc())
    ).all()
    ids_titulos = {t["id"] for t in titulos_out}
    ids_nfes = {n["id"] for n in nfes_out}
    ajustes_out = [
        {
            "id": a.id,
            "alvo_tipo": a.alvo_tipo,
            "alvo_id": a.alvo_id,
            "campo": a.campo,
            "valor_anterior": a.valor_anterior,
            "valor_novo": a.valor_novo,
            "motivo": a.motivo,
            "usuario": a.usuario,
            "criado_em": a.criado_em.isoformat(),
        }
        for a in historico
        if (a.alvo_tipo == "titulo" and a.alvo_id in ids_titulos) or (a.alvo_tipo == "nfe" and a.alvo_id in ids_nfes)
    ]

    return {
        "fechamento": linha,
        "titulos": titulos_out,
        "nfes": nfes_out,
        "ajustes": ajustes_out,
    }
