"""Testes do router de empresas: troca de credenciais limpa o cache da conta antiga."""

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
