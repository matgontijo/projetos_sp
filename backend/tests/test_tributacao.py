"""Perfis de tributação por operação — o caso real que motivou o recurso.

BR26_085 é venda para fins de exportação (CFOP 5502): PIS, COFINS e ICMS não
incidem. A empresa tem a tabela cheia (19,05%) no cadastro e o app cobrava
5.012,15 de imposto num projeto que deve 894,56 (3,40% — só CSLL/IRPJ/Add).
"""

import pytest
from sqlalchemy.orm import Session

from app import models
from app.services import calculo
from tests.conftest import criar_projeto, criar_titulo

TABELA_CHEIA = [
    {"nome": "PIS", "aliquota": 0.65},
    {"nome": "COFINS", "aliquota": 3.0},
    {"nome": "ICMS", "aliquota": 12.0},
    {"nome": "CSLL", "aliquota": 1.2},
    {"nome": "IRPJ", "aliquota": 1.08},
    {"nome": "Add. IRPJ", "aliquota": 1.12},
]
FINS_EXPORTACAO = [
    {"nome": "CSLL", "aliquota": 1.2},
    {"nome": "IRPJ", "aliquota": 1.08},
    {"nome": "Add. IRPJ", "aliquota": 1.12},
]


@pytest.fixture()
def empresa_aliquota(db: Session) -> models.Empresa:
    """JPDV como está em produção: calcula tudo por alíquota, tabela cheia."""
    row = models.Empresa(
        nome="JPDV", cnpj="00", app_key_enc="x", app_secret_enc="y",
        regime="nota", fonte_imposto="aliquota", impostos=TABELA_CHEIA,
    )
    db.add(row)
    db.commit()
    return row


def com_perfil(db: Session, empresa: models.Empresa, projeto: str, perfil: str, itens: list) -> None:
    db.add(models.PerfilTributacao(empresa_id=empresa.id, nome=perfil, impostos=itens))
    db.add(models.TributacaoProjeto(chave_projeto=calculo.chave_projeto(projeto), perfil=perfil))
    db.commit()


def test_sem_perfil_vale_a_tabela_padrao(db: Session, empresa_aliquota):
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_titulo(db, empresa_aliquota, "receber", 100, 26310.50, projeto=1)

    linha = calculo.fechar_projetos(db, [empresa_aliquota.id])["projetos"][0]
    assert linha["imposto"] == pytest.approx(5012.15, abs=0.01)  # 19,05%


def test_perfil_fins_de_exportacao_reproduz_a_planilha(db: Session, empresa_aliquota):
    """O caso BR26_085, ao centavo: 26.310,50 × 3,40% = 894,56."""
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_titulo(db, empresa_aliquota, "receber", 100, 26310.50, projeto=1)
    com_perfil(db, empresa_aliquota, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    linha = calculo.fechar_projetos(db, [empresa_aliquota.id])["projetos"][0]
    assert linha["imposto"] == pytest.approx(894.56, abs=0.01)
    assert linha["resultado"] == pytest.approx(26310.50 - 894.56, abs=0.01)


def test_perfil_vale_so_para_o_projeto_marcado(db: Session, empresa_aliquota):
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_projeto(db, empresa_aliquota, 2, "BR26_090")
    criar_titulo(db, empresa_aliquota, "receber", 100, 10000.0, projeto=1)
    criar_titulo(db, empresa_aliquota, "receber", 101, 10000.0, projeto=2)
    com_perfil(db, empresa_aliquota, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    linhas = {p["projeto"]: p for p in calculo.fechar_projetos(db, [empresa_aliquota.id])["projetos"]}
    assert linhas["BR26_085"]["imposto"] == pytest.approx(340.0, abs=0.01)   # 3,40%
    assert linhas["BR26_090"]["imposto"] == pytest.approx(1905.0, abs=0.01)  # 19,05%


def test_empresa_sem_o_perfil_continua_na_tabela_padrao(db: Session, empresa_aliquota):
    """O projeto aponta um perfil que ESTA empresa não cadastrou: nada muda para ela."""
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_titulo(db, empresa_aliquota, "receber", 100, 10000.0, projeto=1)
    # perfil escolhido no projeto, mas cadastrado em OUTRA empresa
    outra = models.Empresa(nome="Outra", cnpj="99", app_key_enc="a", app_secret_enc="b")
    db.add(outra)
    db.commit()
    com_perfil(db, outra, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    linha = calculo.fechar_projetos(db, [empresa_aliquota.id])["projetos"][0]
    assert linha["imposto"] == pytest.approx(1905.0, abs=0.01)  # tabela padrão da empresa


def test_simples_ignora_perfil(db: Session):
    """A alíquota do Simples é o DAS — não muda com a operação."""
    simples = models.Empresa(
        nome="Cherry", cnpj="11", app_key_enc="x", app_secret_enc="y",
        regime="simples", aliquota_extra=10.0,
    )
    db.add(simples)
    db.commit()
    criar_projeto(db, simples, 1, "BR26_085")
    criar_titulo(db, simples, "receber", 100, 10000.0, projeto=1)
    com_perfil(db, simples, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    linha = calculo.fechar_projetos(db, [simples.id])["projetos"][0]
    assert linha["imposto_simples"] == pytest.approx(1000.0, abs=0.01)  # 10% do DAS, intacto
    assert linha["imposto"] == pytest.approx(1000.0, abs=0.01)


def test_serie_mensal_usa_o_mesmo_perfil(db: Session, empresa_aliquota):
    """O gráfico de evolução não pode divergir do fechamento."""
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_titulo(db, empresa_aliquota, "receber", 100, 26310.50, projeto=1)
    com_perfil(db, empresa_aliquota, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    serie = calculo.serie_mensal(db, [empresa_aliquota.id])
    assert serie[0]["imposto"] == pytest.approx(894.56, abs=0.01)


def test_consolidado_mistura_perfis_correto(db: Session, empresa_aliquota):
    """Projeto normal + projeto exportação na mesma tela: cada um com sua alíquota."""
    criar_projeto(db, empresa_aliquota, 1, "BR26_085")
    criar_projeto(db, empresa_aliquota, 2, "BR26_090")
    criar_titulo(db, empresa_aliquota, "receber", 100, 26310.50, projeto=1)
    criar_titulo(db, empresa_aliquota, "receber", 101, 10000.0, projeto=2)
    com_perfil(db, empresa_aliquota, "BR26_085", "Fins de exportação", FINS_EXPORTACAO)

    consolidado = calculo.fechar_projetos(db, [empresa_aliquota.id])["consolidado"]
    assert consolidado["imposto"] == pytest.approx(894.56 + 1905.0, abs=0.02)


def test_api_avisa_empresa_sem_o_perfil(db: Session, empresa_aliquota):
    """O buraco silencioso: perfil criado numa empresa, projeto faturado por outra."""
    from app.routers.extras import obter_tributacao

    outra = models.Empresa(nome="Filial Sem Perfil", cnpj="77", app_key_enc="a", app_secret_enc="b", regime="nota")
    db.add(outra)
    db.commit()
    criar_projeto(db, empresa_aliquota, 1, "BR26_200")
    com_perfil(db, empresa_aliquota, "BR26_200", "Fins de exportação", FINS_EXPORTACAO)

    saida = obter_tributacao("BR26_200", db)

    assert saida["perfil"] == "Fins de exportação"
    assert saida["empresas_sem_perfil"] == ["Filial Sem Perfil"]  # a que ficou de fora

    # cadastrando o perfil na outra empresa, o aviso some
    db.add(models.PerfilTributacao(empresa_id=outra.id, nome="Fins de exportação", impostos=FINS_EXPORTACAO))
    db.commit()
    assert obter_tributacao("BR26_200", db)["empresas_sem_perfil"] == []
