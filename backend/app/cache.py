"""Cache em memoria do fechamento, com invalidacao por versao.

Os dados so mudam quando ha ESCRITA (sincronizacao, ajuste, classificacao,
orcamento, config, empresas) — cada escrita chama `invalidar()`, que sobe a
versao e descarta tudo. Leituras repetidas (dashboard dispara 4 calculos!)
viram acesso a dicionario.

Nota de operacao: cache por processo (o deploy roda 1 worker uvicorn). Se um
dia houver multiplos workers, trocar por chave de versao no banco.
"""

import threading
from typing import Any, Callable

_lock = threading.Lock()
_versao = 0
_dados: dict[tuple, tuple[int, Any]] = {}
_MAX_ENTRADAS = 256

# single-flight: um lock por chave. Depois de invalidar, o dashboard dispara
# varias chamadas AO MESMO TEMPO (fechamento, contador da sidebar, sino,
# detalhe) — sem isto, todas perdem o cache juntas e todas recalculam o
# fechamento inteiro em paralelo, multiplicando o trabalho pesado por 3-4x
# numa CPU que ja e pequena (Render free). Com isto, a primeira calcula e as
# outras ESPERAM o resultado dela.
_computos: dict[tuple, threading.Lock] = {}


def invalidar() -> None:
    global _versao
    with _lock:
        _versao += 1
        _dados.clear()
        _computos.clear()


def obter_ou_computar(chave: tuple, fabrica: Callable[[], Any]) -> Any:
    """Devolve do cache; num miss, so UMA thread computa — as demais aguardam."""
    valor = obter(chave)
    if valor is not None:
        return valor
    with _lock:
        trava = _computos.setdefault(chave, threading.Lock())
    with trava:
        valor = obter(chave)  # alguem pode ter terminado enquanto esperavamos
        if valor is None:
            valor = guardar(chave, fabrica())
        return valor


def obter(chave: tuple) -> Any | None:
    with _lock:
        item = _dados.get(chave)
        if item is not None and item[0] == _versao:
            return item[1]
        return None


def guardar(chave: tuple, valor: Any) -> Any:
    with _lock:
        if len(_dados) >= _MAX_ENTRADAS:
            _dados.clear()
        _dados[chave] = (_versao, valor)
    return valor
