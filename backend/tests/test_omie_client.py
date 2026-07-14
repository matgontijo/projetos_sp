"""Testes do cliente Omie: paginacao completa, faults, backoff e 425."""

import httpx
import pytest
import respx

from app.omie.client import (
    OmieClient,
    OmieError,
    OmieRateLimitError,
    OmieTransportError,
)

BASE = "https://app.omie.com.br/api/v1"
URL_CR = f"{BASE}/financas/contareceber/"


def _client() -> OmieClient:
    # sleep neutro para os testes nao esperarem throttle/backoff
    return OmieClient("k", "s", base_url=BASE, min_interval=0, sleep=lambda _s: None)


def _page(pagina: int, total_paginas: int, registros: list[dict]) -> dict:
    return {
        "pagina": pagina,
        "total_de_paginas": total_paginas,
        "registros": len(registros),
        "total_de_registros": 250,
        "conta_receber_cadastro": registros,
    }


@respx.mock
def test_paginacao_itera_todas_as_paginas():
    paginas = {
        1: _page(1, 3, [{"codigo_lancamento_omie": 1}, {"codigo_lancamento_omie": 2}]),
        2: _page(2, 3, [{"codigo_lancamento_omie": 3}]),
        3: _page(3, 3, [{"codigo_lancamento_omie": 4}]),
    }

    def responder(request: httpx.Request):
        import json

        body = json.loads(request.content)
        assert body["call"] == "ListarContasReceber"
        assert body["param"][0]["registros_por_pagina"] == 100
        return httpx.Response(200, json=paginas[body["param"][0]["pagina"]])

    respx.post(URL_CR).mock(side_effect=responder)

    registros = list(
        _client().paginate("financas/contareceber", "ListarContasReceber", {}, list_keys=("conta_receber_cadastro",))
    )
    assert [r["codigo_lancamento_omie"] for r in registros] == [1, 2, 3, 4]


@respx.mock
def test_faultstring_vira_erro_de_negocio_sem_retry():
    rota = respx.post(URL_CR).mock(
        return_value=httpx.Response(
            500, json={"faultstring": "ERROR: Chave de acesso invalida", "faultcode": "SOAP-ENV:Client-101"}
        )
    )
    with pytest.raises(OmieError) as exc:
        _client().call("financas/contareceber", "ListarContasReceber", {})
    assert "Chave de acesso" in str(exc.value)
    assert rota.call_count == 1  # erro de negocio nao retenta


@respx.mock
def test_sem_registros_retorna_lista_vazia():
    respx.post(URL_CR).mock(
        return_value=httpx.Response(
            500, json={"faultstring": "ERROR: Não existem registros para a página [1]!", "faultcode": "SOAP-ENV:Client-5113"}
        )
    )
    registros = list(
        _client().paginate("financas/contareceber", "ListarContasReceber", {}, list_keys=("conta_receber_cadastro",))
    )
    assert registros == []


@respx.mock
def test_erro_transiente_500_faz_retry_e_recupera():
    respostas = [
        httpx.Response(500, text="Internal Server Error"),
        httpx.Response(200, json=_page(1, 1, [{"codigo_lancamento_omie": 7}])),
    ]
    rota = respx.post(URL_CR).mock(side_effect=respostas)
    data = _client().call("financas/contareceber", "ListarContasReceber", {"pagina": 1})
    assert data["conta_receber_cadastro"][0]["codigo_lancamento_omie"] == 7
    assert rota.call_count == 2


@respx.mock
def test_transiente_persistente_estoura_apos_tentativas():
    rota = respx.post(URL_CR).mock(return_value=httpx.Response(502, text="Bad Gateway"))
    with pytest.raises(OmieTransportError):
        _client().call("financas/contareceber", "ListarContasReceber", {})
    assert rota.call_count == 4  # 1 tentativa + 3 retries


@respx.mock
def test_fault_de_instabilidade_faz_retry():
    """'SOAP-ERROR: Broken response...' e instabilidade da Omie, nao erro de negocio."""
    respostas = [
        httpx.Response(500, json={"faultstring": "SOAP-ERROR: Broken response from Application Server (BG)"}),
        httpx.Response(200, json=_page(1, 1, [{"codigo_lancamento_omie": 9}])),
    ]
    rota = respx.post(URL_CR).mock(side_effect=respostas)
    data = _client().call("financas/contareceber", "ListarContasReceber", {"pagina": 1})
    assert data["conta_receber_cadastro"][0]["codigo_lancamento_omie"] == 9
    assert rota.call_count == 2


@respx.mock
def test_http_425_bloqueio_falha_imediatamente():
    rota = respx.post(URL_CR).mock(return_value=httpx.Response(425, text="Too Early"))
    with pytest.raises(OmieRateLimitError):
        _client().call("financas/contareceber", "ListarContasReceber", {})
    assert rota.call_count == 1
