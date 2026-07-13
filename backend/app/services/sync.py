"""Sincronizacao Omie -> cache local (upsert idempotente por empresa+periodo)."""

import logging
import re
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..db import SessionLocal
from ..models import utcnow
from ..omie import api as omie_api
from ..omie.client import OmieClient

logger = logging.getLogger(__name__)

# Categorias com cara de tributo sao pre-sugeridas como grupo 'imposto'
_RE_IMPOSTO = re.compile(
    r"icms|ipi|pis|cofins|iss|csll|irpj|irrf|inss|das\b|simples|imposto|tribut|fgts|difal|ibs\b|cbs\b",
    re.IGNORECASE,
)


def _num(value) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _data(value) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _int_ou_none(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n or None


# --- Upserts por recurso -----------------------------------------------------


def sync_projetos(db: Session, empresa: models.Empresa, client: OmieClient) -> int:
    registros = omie_api.listar_projetos(client)
    existentes = {
        p.codigo_omie: p
        for p in db.scalars(select(models.Projeto).where(models.Projeto.empresa_id == empresa.id))
    }
    for reg in registros:
        codigo = _int_ou_none(reg.get("codigo"))
        if not codigo:
            continue
        row = existentes.get(codigo)
        if row is None:
            row = models.Projeto(empresa_id=empresa.id, codigo_omie=codigo)
            db.add(row)
            existentes[codigo] = row
        row.cod_int = str(reg.get("codInt") or "")
        row.nome = str(reg.get("nome") or "")
        row.inativo = str(reg.get("inativo") or "N").upper() == "S"
    db.commit()
    return len(registros)


def sync_clientes(db: Session, empresa: models.Empresa, client: OmieClient) -> int:
    registros = omie_api.listar_clientes_resumido(client)
    existentes = {
        c.codigo_cliente_omie: c
        for c in db.scalars(select(models.Cliente).where(models.Cliente.empresa_id == empresa.id))
    }
    for reg in registros:
        codigo = _int_ou_none(reg.get("codigo_cliente"))
        if not codigo:
            continue
        row = existentes.get(codigo)
        if row is None:
            row = models.Cliente(empresa_id=empresa.id, codigo_cliente_omie=codigo)
            db.add(row)
            existentes[codigo] = row
        row.razao_social = str(reg.get("razao_social") or "")
        row.nome_fantasia = str(reg.get("nome_fantasia") or "")
        row.cnpj_cpf = str(reg.get("cnpj_cpf") or "")
    db.commit()
    return len(registros)


def sync_categorias(db: Session, empresa: models.Empresa, client: OmieClient) -> int:
    registros = omie_api.listar_categorias(client)
    existentes = {
        c.codigo_categoria: c
        for c in db.scalars(select(models.CategoriaGrupo).where(models.CategoriaGrupo.empresa_id == empresa.id))
    }
    for reg in registros:
        codigo = str(reg.get("codigo") or "").strip()
        if not codigo:
            continue
        descricao = str(reg.get("descricao") or "")
        row = existentes.get(codigo)
        if row is None:
            row = models.CategoriaGrupo(
                empresa_id=empresa.id,
                codigo_categoria=codigo,
                # pre-sugestao: tributos gerados pela Omie nunca podem cair em producao/frete
                grupo="imposto" if _RE_IMPOSTO.search(descricao) else None,
                atualizado_por="sync (sugestão automática)" if _RE_IMPOSTO.search(descricao) else "",
            )
            db.add(row)
            existentes[codigo] = row
        row.descricao = descricao
    db.commit()
    return len(registros)


def _upsert_titulos(db: Session, empresa: models.Empresa, tipo: str, registros: list[dict]) -> int:
    existentes = {
        t.codigo_lancamento_omie: t
        for t in db.scalars(
            select(models.Titulo).where(models.Titulo.empresa_id == empresa.id, models.Titulo.tipo == tipo)
        )
    }
    qtd = 0
    for reg in registros:
        codigo = _int_ou_none(reg.get("codigo_lancamento_omie"))
        if not codigo:
            continue
        row = existentes.get(codigo)
        if row is None:
            row = models.Titulo(empresa_id=empresa.id, tipo=tipo, codigo_lancamento_omie=codigo)
            db.add(row)
            existentes[codigo] = row
        row.codigo_projeto_omie = _int_ou_none(reg.get("codigo_projeto"))
        row.valor_documento = _num(reg.get("valor_documento"))
        row.codigo_categoria = str(reg.get("codigo_categoria") or "")
        rateio = reg.get("categorias")
        row.categorias_rateio = rateio if isinstance(rateio, list) and rateio else None
        row.data_emissao = _data(reg.get("data_emissao"))
        row.data_vencimento = _data(reg.get("data_vencimento"))
        row.status_titulo = str(reg.get("status_titulo") or "")
        row.codigo_cliente_fornecedor = _int_ou_none(reg.get("codigo_cliente_fornecedor"))
        row.numero_documento = str(reg.get("numero_documento") or "")
        row.numero_documento_fiscal = str(reg.get("numero_documento_fiscal") or "")
        row.raw = reg
        row.synced_at = utcnow()
        qtd += 1
    db.commit()
    return qtd


def sync_contas_receber(db: Session, empresa: models.Empresa, client: OmieClient, de: date, ate: date) -> int:
    registros = omie_api.listar_contas_receber(client, de, ate)
    return _upsert_titulos(db, empresa, "receber", registros)


def sync_contas_pagar(db: Session, empresa: models.Empresa, client: OmieClient, de: date, ate: date) -> int:
    registros = omie_api.listar_contas_pagar(client, de, ate)
    return _upsert_titulos(db, empresa, "pagar", registros)


def _projeto_da_nf(reg: dict) -> int | None:
    """Projeto efetivo da NF: pedido.nIdProjeto, senao o 1o nCodProjeto dos titulos."""
    pedido = reg.get("pedido") or {}
    projeto = _int_ou_none(pedido.get("nIdProjeto"))
    if projeto:
        return projeto
    for titulo in reg.get("titulos") or []:
        projeto = _int_ou_none((titulo or {}).get("nCodProjeto"))
        if projeto:
            return projeto
    return None


def sync_nfe(db: Session, empresa: models.Empresa, client: OmieClient, de: date, ate: date) -> int:
    registros = omie_api.listar_nfs(client, de, ate)
    existentes = {
        n.id_nf: n for n in db.scalars(select(models.NFe).where(models.NFe.empresa_id == empresa.id))
    }
    qtd = 0
    for reg in registros:
        compl = reg.get("compl") or {}
        ide = reg.get("ide") or {}
        id_nf = _int_ou_none(compl.get("nIdNF"))
        if not id_nf:
            continue
        row = existentes.get(id_nf)
        if row is None:
            row = models.NFe(empresa_id=empresa.id, id_nf=id_nf)
            db.add(row)
            existentes[id_nf] = row
        icms_tot = (reg.get("total") or {}).get("ICMSTot") or {}
        dest = reg.get("nfDestInt") or {}
        row.n_nf = str(ide.get("nNF") or "")
        row.serie = str(ide.get("serie") or "")
        row.chave = str(compl.get("cChaveNFe") or "")
        row.d_emi = _data(ide.get("dEmi"))
        row.tp_nf = str(ide.get("tpNF") or "1")
        row.cancelada = bool(str(ide.get("dCan") or "").strip())
        row.id_pedido = _int_ou_none(compl.get("nIdPedido"))
        row.codigo_projeto_omie = _projeto_da_nf(reg)
        row.dest_nome = str(dest.get("cRazao") or "")
        row.dest_cnpj = str(dest.get("cnpj_cpf") or "")
        row.v_nf = _num(icms_tot.get("vNF"))
        row.v_prod = _num(icms_tot.get("vProd"))
        row.v_icms = _num(icms_tot.get("vICMS"))
        row.v_st = _num(icms_tot.get("vST"))
        row.v_fcp = _num(icms_tot.get("vFCP"))
        row.v_fcpst = _num(icms_tot.get("vFCPST"))
        row.v_ipi = _num(icms_tot.get("vIPI"))
        row.v_pis = _num(icms_tot.get("vPIS"))
        row.v_cofins = _num(icms_tot.get("vCOFINS"))
        # Reforma tributaria: campos ainda nao publicados pela Omie; mapeados com tolerancia
        row.v_ibs = _num(icms_tot.get("vIBS"))
        row.v_cbs = _num(icms_tot.get("vCBS"))
        row.titulos = reg.get("titulos") if isinstance(reg.get("titulos"), list) else None
        row.raw = reg
        row.synced_at = utcnow()
        qtd += 1
    db.commit()
    return qtd


# --- Orquestracao ------------------------------------------------------------

RECURSOS = ("projetos", "categorias", "clientes", "contas_receber", "contas_pagar", "nfe")


def executar_sync_empresa(empresa_id: int, de: date, ate: date, build_client) -> None:
    """Roda a sincronizacao completa de uma empresa, registrando cada recurso em sync_log.

    Executa em background (threadpool do FastAPI); abre a propria sessao.
    """
    db = SessionLocal()
    try:
        empresa = db.get(models.Empresa, empresa_id)
        if empresa is None:
            return
        with build_client(empresa) as client:
            for recurso in RECURSOS:
                log = models.SyncLog(empresa_id=empresa_id, recurso=recurso, periodo_de=de, periodo_ate=ate)
                db.add(log)
                db.commit()
                try:
                    if recurso == "projetos":
                        qtd = sync_projetos(db, empresa, client)
                    elif recurso == "categorias":
                        qtd = sync_categorias(db, empresa, client)
                    elif recurso == "clientes":
                        qtd = sync_clientes(db, empresa, client)
                    elif recurso == "contas_receber":
                        qtd = sync_contas_receber(db, empresa, client, de, ate)
                    elif recurso == "contas_pagar":
                        qtd = sync_contas_pagar(db, empresa, client, de, ate)
                    else:
                        qtd = sync_nfe(db, empresa, client, de, ate)
                    log.status = "concluido"
                    log.qtd_registros = qtd
                except Exception as exc:  # noqa: BLE001 — erro vai para o log de sync
                    db.rollback()
                    logger.exception("Sync %s falhou (empresa %d)", recurso, empresa_id)
                    log = db.get(models.SyncLog, log.id)
                    log.status = "erro"
                    log.mensagem = str(exc)[:2000]
                log.concluido_em = utcnow()
                db.commit()
    finally:
        db.close()
