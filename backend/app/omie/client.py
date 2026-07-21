"""Cliente HTTP da API Omie.

Regras observadas da documentacao oficial:
- Toda chamada e um POST JSON {call, app_key, app_secret, param: [{...}]}.
- Erros de negocio retornam HTTP 500 com {"faultstring", "faultcode"} — nao retentar.
- "Nao existem registros" tambem vem como fault — tratado como resultado vazio.
- HTTP 425 = bloqueio de 30 min por consumo indevido — falhar com mensagem clara.
- Maximo de 100 registros por pagina; iterar ate total_de_paginas.
- Limite de ~240 req/min por IP+key+metodo — throttle entre chamadas.
"""

import logging
import re
import time
from collections.abc import Iterator
from typing import Any

import httpx

logger = logging.getLogger(__name__)

MAX_POR_PAGINA = 100
_RETRIES_TRANSIENTES = 3
_BACKOFF_BASE = 1.5  # segundos: 1.5, 3, 6

# Chaves possiveis de paginacao na resposta (endpoints de produto podem variar)
_KEYS_TOTAL_PAGINAS = ("total_de_paginas", "nTotPaginas", "total_paginas")
_RE_SEM_REGISTROS = re.compile(r"n[aã]o\s+exist[e|em]+\s+registros?", re.IGNORECASE)
# Faults de instabilidade do servidor Omie (nao sao erro de negocio) — retentar
_RE_FAULT_TRANSIENTE = re.compile(r"SOAP-ERROR|Broken response|Application Server", re.IGNORECASE)


class OmieError(Exception):
    """Erro de negocio retornado pela Omie (faultstring)."""

    def __init__(self, faultstring: str, faultcode: str = ""):
        super().__init__(faultstring)
        self.faultstring = faultstring
        self.faultcode = faultcode


class OmieNoRecordsError(OmieError):
    """Fault 'nao existem registros' — tratado como lista vazia na paginacao."""


class OmieRateLimitError(OmieError):
    """HTTP 425 — API bloqueada por ~30 minutos por consumo indevido."""


class OmieTransportError(Exception):
    """Falha de rede/timeout apos esgotar as tentativas."""


class OmieClient:
    def __init__(
        self,
        app_key: str,
        app_secret: str,
        base_url: str = "https://app.omie.com.br/api/v1",
        timeout: float = 90.0,
        min_interval: float = 0.35,
        http: httpx.Client | None = None,
        sleep=time.sleep,
    ):
        self._app_key = app_key
        self._app_secret = app_secret
        self.base_url = base_url.rstrip("/")
        self.min_interval = min_interval
        self._sleep = sleep
        self._last_request_at = 0.0
        self._http = http or httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "OmieClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_interval:
            self._sleep(self.min_interval - elapsed)
        self._last_request_at = time.monotonic()

    def call(self, endpoint: str, method: str, param: dict[str, Any]) -> dict[str, Any]:
        """Executa uma chamada; retenta apenas falhas transientes (rede/5xx sem fault)."""
        url = f"{self.base_url}/{endpoint.strip('/')}/"
        body = {
            "call": method,
            "app_key": self._app_key,
            "app_secret": self._app_secret,
            "param": [param],
        }
        last_exc: Exception | None = None
        for attempt in range(_RETRIES_TRANSIENTES + 1):
            self._throttle()
            try:
                resp = self._http.post(url, json=body)
            except httpx.HTTPError as exc:
                last_exc = exc
                logger.warning("Omie %s/%s: falha de rede (tentativa %d): %s", endpoint, method, attempt + 1, exc)
                self._sleep(_BACKOFF_BASE * (2**attempt))
                continue

            if resp.status_code == 425:
                raise OmieRateLimitError(
                    "API Omie bloqueada temporariamente por excesso/consumo indevido (HTTP 425). "
                    "Aguarde ~30 minutos e tente novamente.",
                    faultcode="HTTP-425",
                )

            data = self._parse_json(resp)
            if data is not None and "faultstring" in data:
                faultstring = str(data.get("faultstring", ""))
                faultcode = str(data.get("faultcode", ""))
                if _RE_SEM_REGISTROS.search(faultstring):
                    raise OmieNoRecordsError(faultstring, faultcode)
                if _RE_FAULT_TRANSIENTE.search(faultstring):
                    # instabilidade do servidor Omie disfarçada de fault — retentar
                    last_exc = OmieError(faultstring, faultcode)
                    logger.warning(
                        "Omie %s/%s: fault transiente (tentativa %d): %s", endpoint, method, attempt + 1, faultstring
                    )
                    self._sleep(_BACKOFF_BASE * (2**attempt))
                    continue
                raise OmieError(faultstring, faultcode)

            if resp.status_code >= 500 or data is None:
                # 5xx sem faultstring (instabilidade) — retenta com backoff
                last_exc = httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}", request=resp.request, response=resp
                )
                logger.warning(
                    "Omie %s/%s: HTTP %d sem fault (tentativa %d)", endpoint, method, resp.status_code, attempt + 1
                )
                self._sleep(_BACKOFF_BASE * (2**attempt))
                continue

            resp.raise_for_status()
            return data

        raise OmieTransportError(
            f"Falha ao chamar Omie {endpoint}/{method} apos {_RETRIES_TRANSIENTES + 1} tentativas: {last_exc}"
        )

    @staticmethod
    def _parse_json(resp: httpx.Response) -> dict[str, Any] | None:
        try:
            data = resp.json()
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    def paginate(
        self,
        endpoint: str,
        method: str,
        param: dict[str, Any],
        list_keys: tuple[str, ...],
        per_page: int = MAX_POR_PAGINA,
        page_field: str = "pagina",
        per_page_field: str = "registros_por_pagina",
    ) -> Iterator[dict[str, Any]]:
        """Itera TODAS as paginas do metodo, cedendo registro a registro."""
        pagina = 1
        while True:
            page_param = {**param, page_field: pagina, per_page_field: per_page}
            try:
                data = self.call(endpoint, method, page_param)
            except OmieNoRecordsError:
                return
            registros: list[Any] = []
            for key in list_keys:
                if isinstance(data.get(key), list):
                    registros = data[key]
                    break
            yield from registros

            total_paginas = None
            for key in _KEYS_TOTAL_PAGINAS:
                if data.get(key):
                    total_paginas = int(data[key])
                    break
            if total_paginas is None:
                # Alguns endpoints (ex.: PesquisarPedCompra) nao devolvem total de
                # paginas: segue enquanto a pagina vier cheia; a pagina seguinte
                # sem registros encerra via OmieNoRecordsError.
                if len(registros) < per_page:
                    return
            elif pagina >= total_paginas:
                return
            pagina += 1
