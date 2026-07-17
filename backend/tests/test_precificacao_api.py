"""Testes da camada de serviço + papéis do módulo de precificação."""

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import models
from app.auth import guarda_custeio, guarda_precificacao
from app.precificacao import seeds, servico


def _req(metodo="GET"):
    return Request({"type": "http", "method": metodo, "headers": []})


@pytest.fixture()
def db_seed(db):
    seeds.semear(db)  # semeia no próprio banco do teste
    return db


def test_seeds_criam_aliquotas_e_labels(db_seed):
    aliq = servico.aliquota_do_local(db_seed, "Simples Nacional (todos estados)")
    assert float(aliq) == 0.105
    assert float(servico.aliquota_do_local(db_seed, "São Paulo (revenda)")) == 0.07
    # label liso 1.500 un = R$ 1,70 (faixa 1500)
    from decimal import Decimal
    assert servico.preco_label(db_seed, "liso", 1500) == Decimal("1.7000")
    # 1.499 cai na faixa 1.200 (R$ 1,80)
    assert servico.preco_label(db_seed, "liso", 1499) == Decimal("1.8000")


def test_aliquota_muda_com_o_regime_da_empresa(db_seed, empresa):
    empresa.regime = "simples"
    db_seed.commit()
    aliq_s, local_s = servico.aliquota_da_empresa(db_seed, empresa)
    assert float(aliq_s) == 0.105 and "Simples" in local_s

    empresa.regime = "nota"
    db_seed.commit()
    aliq_n, _ = servico.aliquota_da_empresa(db_seed, empresa)
    assert float(aliq_n) == 0.135  # Presumido padrão (demais estados)


def test_calculo_com_contexto_troca_imposto_pela_empresa(db_seed, empresa):
    empresa.regime = "simples"
    db_seed.commit()
    r = servico.calcular_com_contexto(
        db_seed, produto_id=None, quantidade=1500, acabamento="sem_label",
        empresa_faturamento_id=empresa.id, local_faturamento=None,
        condicao_pagamento_dias=0, margem=0.15, comissao=0.025, custo_fixo=0.0,
        porta_copo=False, extras=[{"nome": "Tirante", "valor": 2.266666666666667}],
    )
    assert r["aliquota_imposto"] == 0.105
    assert abs(r["preco_a_vista"] - 3.1525) < 0.01  # bate com o teste-ouro


def test_papel_comercial_bloqueado_no_custeio():
    comercial = models.Usuario(nome="Vend", email="v@v.com", senha_hash="x", papel="comercial")
    with pytest.raises(HTTPException) as exc:
        guarda_custeio(comercial)  # type: ignore[arg-type]
    assert exc.value.status_code == 403
    # mas passa na precificação
    assert guarda_precificacao(comercial).papel == "comercial"  # type: ignore[arg-type]


def test_papel_leitura_bloqueado_na_precificacao():
    leitor = models.Usuario(nome="L", email="l@l.com", senha_hash="x", papel="leitura")
    with pytest.raises(HTTPException):
        guarda_precificacao(leitor)  # type: ignore[arg-type]
    # leitura acessa custeio (GET)
    assert guarda_custeio(leitor).papel == "leitura"  # type: ignore[arg-type]


def test_admin_e_financeiro_acessam_ambos():
    for papel in ("admin", "financeiro"):
        u = models.Usuario(nome=papel, email=f"{papel}@x.com", senha_hash="x", papel=papel)
        assert guarda_custeio(u).papel == papel  # type: ignore[arg-type]
        assert guarda_precificacao(u).papel == papel  # type: ignore[arg-type]
