"""Fluxo de caixa por mês de vencimento e a margem prevista do comparativo."""

from datetime import date

from app import models
from app.routers.orcamentos import _margem_prevista
from app.services.analises import fluxo_mensal

from .conftest import criar_projeto, criar_titulo


def _venc(db, titulo: models.Titulo, dia: date) -> None:
    titulo.data_vencimento = dia
    db.commit()


def test_fluxo_agrupa_por_mes_de_vencimento(db, empresa):
    criar_projeto(db, empresa, 10, "BR26_001")
    t1 = criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=10, status="RECEBIDO")
    _venc(db, t1, date(2026, 6, 15))
    t2 = criar_titulo(db, empresa, "receber", 2, 500.0, projeto=10, status="EMABERTO")
    _venc(db, t2, date(2026, 7, 10))
    t3 = criar_titulo(db, empresa, "pagar", 3, 300.0, projeto=10, status="PAGO")
    _venc(db, t3, date(2026, 6, 20))
    # sem vencimento: cai no mês da emissão (2026-05)
    criar_titulo(db, empresa, "pagar", 4, 200.0, projeto=10, status="EMABERTO")

    resultado = fluxo_mensal(db, [empresa.id], None, None)
    por_mes = {m["mes"]: m for m in resultado["meses"]}

    assert por_mes["2026-05"]["saidas"] == 200.0
    assert por_mes["2026-05"]["aberto_saidas"] == 200.0
    assert por_mes["2026-06"]["entradas"] == 1000.0
    assert por_mes["2026-06"]["aberto_entradas"] == 0.0  # já recebido
    assert por_mes["2026-06"]["saldo"] == 700.0
    assert por_mes["2026-07"]["aberto_entradas"] == 500.0
    # acumulado: -200 (mai) + 700 (jun) + 500 (jul)
    assert por_mes["2026-07"]["acumulado"] == 1000.0
    assert resultado["projetos"] == ["BR26_001"]


def test_fluxo_filtra_por_projeto_e_ignora_cancelado(db, empresa):
    criar_projeto(db, empresa, 10, "BR26_001")
    criar_projeto(db, empresa, 11, "BR26_002")
    t1 = criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=10, status="EMABERTO")
    _venc(db, t1, date(2026, 6, 15))
    t2 = criar_titulo(db, empresa, "receber", 2, 999.0, projeto=11, status="EMABERTO")
    _venc(db, t2, date(2026, 6, 16))
    t3 = criar_titulo(db, empresa, "receber", 3, 50.0, projeto=10, status="CANCELADO")
    _venc(db, t3, date(2026, 6, 17))

    resultado = fluxo_mensal(db, [empresa.id], None, None, projeto="BR26_001")
    assert len(resultado["meses"]) == 1
    assert resultado["meses"][0]["entradas"] == 1000.0  # só o projeto pedido, sem o cancelado
    # a lista de projetos serve ao filtro do front: traz todos, não só o filtrado
    assert resultado["projetos"] == ["BR26_001", "BR26_002"]


def test_margem_prevista_pondera_pelo_total_dos_itens():
    orc = models.OrcamentoVenda(
        snapshot={"itens": [
            {"margem": 0.20, "total": 100.0},
            {"margem": 0.30, "total": 300.0},
        ]}
    )
    assert _margem_prevista(orc) == 0.275


def test_margem_prevista_sem_itens_e_zero():
    assert _margem_prevista(models.OrcamentoVenda(snapshot={})) == 0.0
