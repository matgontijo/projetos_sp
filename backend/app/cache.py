"""Cache em memoria do fechamento, com invalidacao por versao.

Os dados so mudam quando ha ESCRITA (sincronizacao, ajuste, classificacao,
orcamento, config, empresas) — cada escrita chama `invalidar()`, que sobe a
versao e descarta tudo. Leituras repetidas (dashboard dispara 4 calculos!)
viram acesso a dicionario.

Nota de operacao: cache por processo (o deploy roda 1 worker uvicorn). Se um
dia houver multiplos workers, trocar por chave de versao no banco.
"""

import threading
from typing import Any

_lock = threading.Lock()
_versao = 0
_dados: dict[tuple, tuple[int, Any]] = {}
_MAX_ENTRADAS = 256


def invalidar() -> None:
    global _versao
    with _lock:
        _versao += 1
        _dados.clear()


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
