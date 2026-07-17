"""Orçamento comercial: snapshot imutável, autoria, numeração e transições de status."""

import pytest
from fastapi import HTTPException

from app import models
from app.precificacao import seeds
from app.routers import orcamentos as r


@pytest.fixture()
def usuario(db):
    u = models.Usuario(nome="Vendedora", email="vend@x.com", senha_hash="x", papel="comercial")
    db.add(u)
    db.commit()
    return u


@pytest.fixture()
def db_seed(db, empresa):
    seeds.semear(db)
    empresa.regime = "simples"
    db.commit()
    return db


def _payload(empresa_id: int, **kw):
    item = dict(
        quantidade=1500, acabamento="liso", empresa_faturamento_id=empresa_id,
        condicao_pagamento_dias=0, margem=0.15, comissao=0.025, custo_fixo=0.0,
        extras=[{"nome": "Tirante", "valor": 2.2667}],
    )
    item.update(kw)
    return r.OrcamentoIn(cliente="Paróquia Guadalupe", itens=[r.ItemIn(**item)])


def test_criar_congela_snapshot_e_autoria(db_seed, empresa, usuario):
    resp = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    orc = db_seed.get(models.OrcamentoVenda, resp["id"])
    assert orc.numero.startswith("ORC")
    assert orc.criado_por == "Vendedora" and orc.criado_por_id == usuario.id
    assert orc.status == "rascunho"
    # snapshot congela o cálculo completo (auditoria)
    assert orc.snapshot["itens"][0]["aliquota_imposto"] == 0.105
    assert orc.snapshot["itens"][0]["componentes"]
    assert float(orc.total) > 0
    # itens gravados
    itens = db_seed.query(models.ItemOrcamento).filter_by(orcamento_id=orc.id).all()
    assert len(itens) == 1 and itens[0].quantidade == 1500


def test_numeracao_automatica_incrementa(db_seed, empresa, usuario):
    n1 = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)["numero"]
    n2 = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)["numero"]
    assert n1 != n2
    assert int(n2.split("_")[1]) == int(n1.split("_")[1]) + 1


def test_enviado_vira_imutavel(db_seed, empresa, usuario):
    resp = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    r.mudar_status(resp["id"], r.StatusIn(status="enviado"), db_seed, usuario)
    orc = db_seed.get(models.OrcamentoVenda, resp["id"])
    assert orc.status == "enviado" and orc.enviado_em is not None
    # excluir enviado → 409
    with pytest.raises(HTTPException) as exc:
        r.excluir_orcamento(resp["id"], db_seed, usuario)
    assert exc.value.status_code == 409
    # voltar para rascunho → 409 (nunca regride)
    with pytest.raises(HTTPException) as exc:
        r.mudar_status(resp["id"], r.StatusIn(status="rascunho"), db_seed, usuario)
    assert exc.value.status_code == 409


def test_rascunho_pode_ser_excluido(db_seed, empresa, usuario):
    resp = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    assert r.excluir_orcamento(resp["id"], db_seed, usuario) == {"ok": True}
    assert db_seed.get(models.OrcamentoVenda, resp["id"]) is None


def test_preco_recalculado_no_servidor(db_seed, empresa, usuario):
    """O cliente não manda preço: o servidor recalcula tudo (teste-ouro no snapshot)."""
    resp = r.criar_orcamento(_payload(empresa.id, acabamento="sem_label", custo_fixo=0.001), db_seed, usuario)
    orc = db_seed.get(models.OrcamentoVenda, resp["id"])
    assert abs(float(orc.preco_unitario) - 3.1526) < 0.01  # 2,2667/0,719 (ouro BR26_266)


def test_pdf_gera_bytes_validos(db_seed, empresa, usuario):
    resp = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    saida = r.pdf_orcamento(resp["id"], db_seed, usuario)
    assert saida.body[:5] == b"%PDF-"
    assert len(saida.body) > 800


def test_resumo_executivo(db_seed, empresa, usuario):
    r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    resp = r.criar_orcamento(_payload(empresa.id), db_seed, usuario)
    r.mudar_status(resp["id"], r.StatusIn(status="enviado"), db_seed, usuario)
    resumo = r.resumo_executivo(db_seed, usuario)
    assert resumo["orcamentos_mes"] == 2
    assert resumo["por_status"]["enviado"] == 1
    assert resumo["ticket_medio"] > 0
    assert resumo["ranking_produtos"]
