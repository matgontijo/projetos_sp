"""Testes do router de empresas e do auto-reparo de schema."""

from sqlalchemy import create_engine, inspect, text


def test_bootstrap_adiciona_coluna_que_falta():
    """Producao nao roda Alembic: colunas novas precisam ser adicionadas no startup."""
    from app.bootstrap import garantir_colunas

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE titulo (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE empresa (id INTEGER PRIMARY KEY, nome TEXT)"))
        conn.execute(text("INSERT INTO empresa (id, nome) VALUES (1, 'X')"))

    garantir_colunas(engine)

    colunas_titulo = {c["name"] for c in inspect(engine).get_columns("titulo")}
    colunas_empresa = {c["name"] for c in inspect(engine).get_columns("empresa")}
    assert "codigo_vendedor" in colunas_titulo
    assert "aliquota_extra" in colunas_empresa
    with engine.connect() as conn:
        assert conn.execute(text("SELECT aliquota_extra FROM empresa")).scalar() == 0
    # idempotente
    garantir_colunas(engine)

from app import models
from app.routers.empresas import atualizar
from app.schemas import EmpresaUpdate

from .conftest import criar_nfe, criar_projeto, criar_titulo


def _contagens(db, empresa_id):
    return {
        "titulos": db.query(models.Titulo).filter_by(empresa_id=empresa_id).count(),
        "nfes": db.query(models.NFe).filter_by(empresa_id=empresa_id).count(),
        "projetos": db.query(models.Projeto).filter_by(empresa_id=empresa_id).count(),
    }


def test_trocar_credenciais_limpa_cache(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)
    criar_nfe(db, empresa, 555, projeto=100, v_icms=10.0)
    assert _contagens(db, empresa.id) == {"titulos": 1, "nfes": 1, "projetos": 1}

    atualizar(empresa.id, EmpresaUpdate(app_key="nova_chave", app_secret="novo_segredo"), db)

    assert _contagens(db, empresa.id) == {"titulos": 0, "nfes": 0, "projetos": 0}


def test_atualizar_sem_credenciais_preserva_cache(db, empresa):
    criar_projeto(db, empresa, 100, "BR26_055")
    criar_titulo(db, empresa, "receber", 1, 1000.0, projeto=100)

    atualizar(empresa.id, EmpresaUpdate(nome="Novo Nome", regime="simples", simples_anexo="I"), db)

    assert _contagens(db, empresa.id)["titulos"] == 1
    assert _contagens(db, empresa.id)["projetos"] == 1
