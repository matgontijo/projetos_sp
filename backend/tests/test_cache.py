"""Single-flight do cache: pedidos concorrentes não multiplicam o trabalho pesado.

O cenário real: depois de trocar a tributação de um projeto, o app dispara ao
mesmo tempo o detalhe, o contador da sidebar e o sino — todos precisando do
fechamento recém-invalidado. Sem single-flight, todos recalculam os 778
projetos em paralelo numa CPU pequena; com ele, um calcula e os demais esperam.
"""

import threading
import time

from app import cache


def setup_function():
    cache.invalidar()


def test_pedidos_concorrentes_computam_uma_vez():
    computos = []

    def fabrica_lenta():
        computos.append(1)
        time.sleep(0.15)  # simula o fechamento pesado
        return {"resultado": 42}

    resultados = []
    threads = [
        threading.Thread(target=lambda: resultados.append(cache.obter_ou_computar(("fechamento", "x"), fabrica_lenta)))
        for _ in range(6)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(computos) == 1  # UMA computação para seis pedidos
    assert all(r == {"resultado": 42} for r in resultados)


def test_chaves_diferentes_nao_se_bloqueiam():
    ordem = []

    def fabrica(nome):
        def f():
            ordem.append(nome)
            time.sleep(0.05)
            return nome
        return f

    a = threading.Thread(target=lambda: cache.obter_ou_computar(("a",), fabrica("a")))
    b = threading.Thread(target=lambda: cache.obter_ou_computar(("b",), fabrica("b")))
    inicio = time.monotonic()
    a.start()
    b.start()
    a.join()
    b.join()
    duracao = time.monotonic() - inicio

    assert sorted(ordem) == ["a", "b"]
    assert duracao < 0.14  # rodaram em paralelo, não em fila


def test_invalidar_derruba_o_valor_e_recomputa():
    assert cache.obter_ou_computar(("k",), lambda: 1) == 1
    assert cache.obter_ou_computar(("k",), lambda: 2) == 1  # veio do cache
    cache.invalidar()
    assert cache.obter_ou_computar(("k",), lambda: 3) == 3  # recomputou
