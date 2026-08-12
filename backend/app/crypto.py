"""Criptografia (Fernet) das credenciais Omie em repouso.

A chave vem de APP_ENCRYPTION_KEY; sem ela, uma chave local e criada em
backend/.secret_key (uso apenas em desenvolvimento). As credenciais nunca
sao logadas nem retornadas pela API.
"""

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet

from .config import BASE_DIR, settings

_KEY_FILE = BASE_DIR / ".secret_key"


def _como_chave_fernet(segredo: str) -> bytes:
    """Aceita uma chave Fernet pronta OU qualquer segredo forte (deriva via SHA-256).

    Permite usar segredos gerados por plataformas de deploy (ex.: generateValue
    do Render), que nao vem no formato base64 de 32 bytes exigido pelo Fernet.
    """
    try:
        Fernet(segredo.encode())
        return segredo.encode()
    except Exception:
        return base64.urlsafe_b64encode(hashlib.sha256(segredo.encode()).digest())


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    key = settings.app_encryption_key.strip()
    if not key:
        # Em producao (Postgres) o disco e efemero: gerar uma chave local aqui
        # significaria uma chave DIFERENTE a cada deploy — e todas as credenciais
        # Omie ficariam ilegiveis em silencio. Melhor falhar alto e claro.
        if settings.database_url.startswith("postgresql"):
            raise RuntimeError(
                "APP_ENCRYPTION_KEY nao esta definida. Em producao ela e obrigatoria: "
                "sem uma chave fixa, as credenciais Omie criptografadas ficam ilegiveis "
                "apos o proximo deploy. Defina APP_ENCRYPTION_KEY no ambiente."
            )
        # Desenvolvimento (SQLite): chave local em arquivo, so para nao exigir setup.
        if _KEY_FILE.exists():
            key = _KEY_FILE.read_text(encoding="utf-8").strip()
        else:
            key = Fernet.generate_key().decode()
            _KEY_FILE.write_text(key, encoding="utf-8")
    return Fernet(_como_chave_fernet(key))


def encrypt_str(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_str(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
