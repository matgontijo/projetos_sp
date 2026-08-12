"""Proteção da chave de criptografia e do SQL de auto-reparo.

Em produção (Postgres) a chave é obrigatória: gerar uma chave efêmera a cada
deploy tornaria as credenciais Omie ilegíveis. Em desenvolvimento (SQLite) o
fallback local continua valendo para não exigir setup.
"""

import pytest

from app import bootstrap, crypto


@pytest.fixture(autouse=True)
def _limpar_cache_fernet():
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


def test_producao_sem_chave_falha_alto(monkeypatch):
    monkeypatch.setattr(crypto.settings, "app_encryption_key", "")
    monkeypatch.setattr(crypto.settings, "database_url", "postgresql+psycopg://x/y")
    with pytest.raises(RuntimeError, match="APP_ENCRYPTION_KEY"):
        crypto._fernet()


def test_dev_sqlite_gera_chave_local(monkeypatch, tmp_path):
    monkeypatch.setattr(crypto.settings, "app_encryption_key", "")
    monkeypatch.setattr(crypto.settings, "database_url", "sqlite:///dev.db")
    monkeypatch.setattr(crypto, "_KEY_FILE", tmp_path / ".secret_key")
    ida = crypto.encrypt_str("segredo omie")
    assert crypto.decrypt_str(ida) == "segredo omie"


def test_chave_definida_criptografa_e_volta(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setattr(crypto.settings, "app_encryption_key", Fernet.generate_key().decode())
    assert crypto.decrypt_str(crypto.encrypt_str("app_key_123")) == "app_key_123"


def test_bootstrap_so_aceita_identificador_seguro():
    assert bootstrap._IDENT.match("empresa")
    assert bootstrap._IDENT.match("fonte_imposto")
    assert not bootstrap._IDENT.match("empresa; DROP TABLE usuario")
    assert not bootstrap._IDENT.match("coluna com espaço")
