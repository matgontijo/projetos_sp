"""Testes das regras de fechamento: agrupamento, custos, impostos, margem e ajustes."""

from datetime import date

import pytest

from app import models
from app.services import calculo

from .conftest import criar_nfe, criar_projeto, criar_titulo, mapear_categoria


def _linha(resultado: dict, projeto: str) -> dict:
    return next(p for p in resultado["projetos"] if p["projeto"].upper() == projeto.upper())


def test_agrupa_receita_por_projeto(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_projeto(db, empresa, 200, "BR26_060")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    criar_titulo(db, empresa, "receber", 2, 500.0, projeto=100)
    criar_titulo(db, empresa, "receber", 3, 300.0, projeto=200)

    resultado = calculo.fechar_projetos(db, [empresa.id])

    assert _linha(resultado, "BR26_055")["receita"] == 1500.0
    assert _linha(resultado, "BR26_060")["receita"] == 300.0
    assert resultado["consolidado"]["receita"] == 1800.0


def test_consolida_mesmo_projeto_entre_empresas(db, empresa):
    """Cenario real: o MESMO projeto e faturado por duas empresas (Presumido + Simples).

    A chave de consolidacao e o numero do projeto (nome), nao o codigo interno.
    """
    empresa2 = models.Empresa(
        nome="Empresa Simples", cnpj="2", app_key_enc="x", app_secret_enc="y",
        regime="simples", simples_anexo="I",
    )
    db.add(empresa2)
    db.commit()
    db.add(models.SimplesPeriodo(empresa_id=empresa2.id, competencia="2026-05", rbt12=300_000))
    db.commit()

    # mesmo numero de projeto, codigos internos diferentes em cada conta Omie
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_projeto(db, empresa2, 900, "BR26_055")
    mapear_categoria(db, empresa, "2.01.01", "producao")

    # empresa 1 (Presumido): receita 10k, custo 4k, NF-e com 1.2k de impostos
    criar_titulo(db, empresa, "receber", 1, 10_000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 2, 4_000.0, projeto=100, categoria="2.01.01")
    criar_nfe(db, empresa, 555, projeto=100, v_icms=1_200.0)
    # empresa 2 (Simples): receita 5k na mesma obra -> DAS efetivo 5,32%
    criar_titulo(db, empresa2, "receber", 3, 5_000.0, projeto=900, emissao=date(2026, 5, 10))

    resultado = calculo.fechar_projetos(db, [empresa.id, empresa2.id])

    assert resultado["consolidado"]["qtd_projetos"] == 1  # uma linha so
    linha = _linha(resultado, "BR26_055")
    assert linha["receita"] == 15_000.0
    assert linha["producao"] == 4_000.0
    assert linha["imposto_nfe"] == 1_200.0
    # Simples aplicado SO sobre os 5k da empresa Simples: 5000 x 5,32% = 266
    assert linha["imposto_simples"] == pytest.approx(266.0)
    assert linha["resultado"] == pytest.approx(15_000 - 4_000 - 1_200 - 266)
    assert "Empresa Simples" in linha["empresas"] and "Empresa Teste" in linha["empresas"]

    # filtrando so a empresa Simples, ve-se apenas a parcela dela
    so_simples = calculo.fechar_projetos(db, [empresa2.id])
    assert _linha(so_simples, "BR26_055")["receita"] == 5_000.0


def test_titulo_cancelado_fica_fora(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    criar_titulo(db, empresa, "receber", 2, 999.0, projeto=100, status="CANCELADO")

    resultado = calculo.fechar_projetos(db, [empresa.id])
    assert _linha(resultado, "BR26_055")["receita"] == 1000.0


def test_custos_por_grupo_do_mapeamento(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    mapear_categoria(db, empresa, "2.02.01", "frete")
    criar_titulo(db, empresa, "receber", 1, 10000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 10, 4000.0, projeto=100, categoria="2.01.01")
    criar_titulo(db, empresa, "pagar", 11, 500.0, projeto=100, categoria="2.02.01")
    criar_titulo(db, empresa, "pagar", 12, 200.0, projeto=100, categoria="9.99.99")  # nao mapeada

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")

    assert linha["producao"] == 4000.0
    assert linha["frete"] == 500.0
    assert linha["outros"] == 200.0
    assert linha["nao_classificado"] == 200.0
    assert linha["custo_total"] == 4700.0
    assert linha["resultado"] == 5300.0
    assert linha["margem"] == pytest.approx(0.53)


def test_rateio_de_categorias_divide_o_titulo(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    mapear_categoria(db, empresa, "2.02.01", "frete")
    criar_titulo(
        db, empresa, "pagar", 10, 1000.0, projeto=100, categoria="2.01.01",
        rateio=[
            {"codigo_categoria": "2.01.01", "valor": 700.0, "percentual": 70},
            {"codigo_categoria": "2.02.01", "valor": 300.0, "percentual": 30},
        ],
    )

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")
    assert linha["producao"] == 700.0
    assert linha["frete"] == 300.0


def test_cp_de_imposto_nao_soma_no_custo(db, empresa):
    """Tributo apurado (CP gerado pela Omie) e visivel mas nao duplica o imposto da NF-e."""
    criar_projeto(db, empresa, 100, "BR26_055")
    mapear_categoria(db, empresa, "2.09.01", "imposto")
    criar_titulo(db, empresa, "receber", 1, 10000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 10, 1200.0, projeto=100, categoria="2.09.01")
    criar_nfe(db, empresa, 555, projeto=100, v_icms=800.0, v_pis=100.0, v_cofins=300.0)

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")

    assert linha["imposto"] == 1200.0  # so o destacado na NF-e
    assert linha["cp_impostos"] == 1200.0  # informativo
    assert linha["custo_total"] == 1200.0  # nao soma os 1200 do CP de tributos
    assert linha["resultado"] == 8800.0


def test_imposto_nfe_soma_todos_os_tributos_destacados(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_nfe(
        db, empresa, 555, projeto=100,
        v_icms=100.0, v_st=50.0, v_fcp=10.0, v_fcpst=5.0, v_ipi=80.0, v_pis=16.5, v_cofins=76.0,
        v_ibs=0.0, v_cbs=0.0,
    )
    criar_nfe(db, empresa, 556, projeto=100, v_icms=999.0, cancelada=True)  # cancelada fora

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")
    assert linha["imposto"] == pytest.approx(337.5)
    assert linha["qtd_nfe"] == 1


def test_nfe_liga_ao_projeto_pelo_fallback_dos_titulos(db, empresa):
    """NF sem pedido.nIdProjeto usa titulos[].nCodProjeto (resolvido no sync)."""
    from app.services.sync import _projeto_da_nf

    reg = {"pedido": {}, "titulos": [{"nCodTitulo": 1, "nCodProjeto": 0}, {"nCodTitulo": 2, "nCodProjeto": 100}]}
    assert _projeto_da_nf(reg) == 100
    reg_pedido = {"pedido": {"nIdProjeto": 200}, "titulos": [{"nCodProjeto": 100}]}
    assert _projeto_da_nf(reg_pedido) == 200
    assert _projeto_da_nf({"pedido": {}, "titulos": []}) is None


def test_sem_projeto_agrupa_em_bucket_proprio(db, empresa):
    criar_titulo(db, empresa, "receber", 1, 700.0, projeto=None)
    resultado = calculo.fechar_projetos(db, [empresa.id])
    linha = _linha(resultado, calculo.SEM_PROJETO_NOME)
    assert linha["projeto"] == "Sem projeto"
    assert linha["receita"] == 700.0


def test_margem_zero_quando_receita_zero(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    criar_titulo(db, empresa, "pagar", 10, 400.0, projeto=100, categoria="2.01.01")

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")
    assert linha["receita"] == 0.0
    assert linha["margem"] == 0.0
    assert linha["resultado"] == -400.0


def test_filtro_de_periodo_por_emissao(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 100.0, projeto=100, emissao=date(2026, 4, 30))
    criar_titulo(db, empresa, "receber", 2, 200.0, projeto=100, emissao=date(2026, 5, 15))

    resultado = calculo.fechar_projetos(db, [empresa.id], de=date(2026, 5, 1), ate=date(2026, 5, 31))
    assert _linha(resultado, "BR26_055")["receita"] == 200.0


def test_consolidado_e_margem_media(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    criar_projeto(db, empresa, 200, "B")
    mapear_categoria(db, empresa, "2.01.01", "producao")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    criar_titulo(db, empresa, "pagar", 2, 600.0, projeto=100, categoria="2.01.01")
    criar_titulo(db, empresa, "receber", 3, 1000.0, projeto=200)
    criar_titulo(db, empresa, "pagar", 4, 900.0, projeto=200, categoria="2.01.01")

    consolidado = calculo.fechar_projetos(db, [empresa.id])["consolidado"]
    assert consolidado["receita"] == 2000.0
    assert consolidado["resultado"] == 500.0
    assert consolidado["margem_media"] == pytest.approx(0.25)
    assert consolidado["qtd_projetos"] == 2


def test_detalhe_consolidado_entre_empresas(db, empresa):
    empresa2 = models.Empresa(nome="Empresa 2", cnpj="2", app_key_enc="x", app_secret_enc="y")
    db.add(empresa2)
    db.commit()
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_projeto(db, empresa2, 900, "br26_055")  # caixa diferente: mesma chave
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    criar_titulo(db, empresa2, "receber", 2, 400.0, projeto=900)
    criar_nfe(db, empresa2, 700, projeto=900, v_icms=48.0)

    detalhe = calculo.detalhe_projeto(db, [empresa.id, empresa2.id], "BR26_055")

    assert detalhe["fechamento"]["receita"] == 1400.0
    assert {t["empresa_nome"] for t in detalhe["titulos"]} == {"Empresa Teste", "Empresa 2"}
    assert len(detalhe["nfes"]) == 1
    assert detalhe["nfes"][0]["empresa_nome"] == "Empresa 2"


# --- Ajustes manuais auditaveis ---


def test_ajuste_reclassifica_grupo_do_titulo(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    mapear_categoria(db, empresa, "2.02.01", "frete")
    titulo = criar_titulo(db, empresa, "pagar", 10, 500.0, projeto=100, categoria="2.02.01")
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo="grupo",
                         valor_anterior="frete", valor_novo="producao", usuario="tester"))
    db.commit()

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "BR26_055")
    assert linha["frete"] == 0.0
    assert linha["producao"] == 500.0


def test_ajuste_move_titulo_de_projeto(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    criar_projeto(db, empresa, 200, "B")
    titulo = criar_titulo(db, empresa, "receber", 1, 800.0, projeto=100)
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo="codigo_projeto",
                         valor_anterior="100", valor_novo="200", usuario="tester"))
    db.commit()

    resultado = calculo.fechar_projetos(db, [empresa.id])
    assert _linha(resultado, "B")["receita"] == 800.0
    assert all(p["projeto"] != "A" or p["receita"] == 0 for p in resultado["projetos"])


def test_ajuste_corrige_imposto_da_nfe(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    nfe = criar_nfe(db, empresa, 555, projeto=100, v_icms=1000.0)
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="nfe", alvo_id=nfe.id, campo="valor_imposto",
                         valor_anterior="1000.00", valor_novo="850,50", usuario="tester"))
    db.commit()

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "A")
    assert linha["imposto"] == pytest.approx(850.5)


def test_ajuste_exclui_titulo_do_fechamento(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    titulo2 = criar_titulo(db, empresa, "receber", 2, 400.0, projeto=100)
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo2.id, campo="excluir",
                         valor_anterior="N", valor_novo="S", usuario="tester"))
    db.commit()

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "A")
    assert linha["receita"] == 1000.0


def test_ultimo_ajuste_vence(db, empresa):
    criar_projeto(db, empresa, 100, "A")
    mapear_categoria(db, empresa, "2.02.01", "frete")
    titulo = criar_titulo(db, empresa, "pagar", 10, 500.0, projeto=100, categoria="2.02.01")
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo="grupo",
                         valor_anterior="frete", valor_novo="producao", usuario="tester"))
    db.add(models.Ajuste(empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo="grupo",
                         valor_anterior="producao", valor_novo="outros", usuario="tester"))
    db.commit()

    linha = _linha(calculo.fechar_projetos(db, [empresa.id]), "A")
    assert linha["producao"] == 0.0
    assert linha["outros"] == 500.0
