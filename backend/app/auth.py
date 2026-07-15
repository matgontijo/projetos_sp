"""Autenticacao propria: senha com scrypt (stdlib), sessao opaca com hash em banco.

Papeis: 'admin' (tudo + gerencia usuarios), 'financeiro' (opera tudo),
'leitura' (so consulta + simulador). A guarda global bloqueia escrita para
'leitura'; gestao de usuarios exige 'admin'.
"""

import hashlib
import hmac
import secrets
import time
from datetime import timedelta

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models
from .db import get_db
from .models import utcnow

PAPEIS = {"admin", "financeiro", "leitura"}
_SESSAO_DIAS = 30
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1


def hash_senha(senha: str) -> str:
    sal = secrets.token_bytes(16)
    digest = hashlib.scrypt(senha.encode(), salt=sal, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${sal.hex()}${digest.hex()}"


def verificar_senha(senha: str, guardado: str) -> bool:
    try:
        _, n, r, p, sal_hex, hash_hex = guardado.split("$")
        digest = hashlib.scrypt(senha.encode(), salt=bytes.fromhex(sal_hex), n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def criar_sessao(db: Session, usuario: models.Usuario) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        models.Sessao(
            usuario_id=usuario.id,
            token_hash=_token_hash(token),
            expira_em=utcnow() + timedelta(days=_SESSAO_DIAS),
        )
    )
    db.commit()
    return token


def encerrar_sessao(db: Session, token: str) -> None:
    sessao = db.scalar(select(models.Sessao).where(models.Sessao.token_hash == _token_hash(token)))
    if sessao:
        db.delete(sessao)
        db.commit()


def autenticar(db: Session, email: str, senha: str) -> models.Usuario | None:
    usuario = db.scalar(select(models.Usuario).where(models.Usuario.email == email.strip().lower()))
    if not usuario or not usuario.ativo or not verificar_senha(senha, usuario.senha_hash):
        time.sleep(0.4)  # nivelar o tempo de resposta p/ dificultar forca bruta
        return None
    return usuario


def usuario_do_token(db: Session, token: str) -> models.Usuario | None:
    sessao = db.scalar(select(models.Sessao).where(models.Sessao.token_hash == _token_hash(token)))
    if not sessao:
        return None
    expira = sessao.expira_em
    agora = utcnow()
    if expira.tzinfo is None:  # SQLite devolve naive
        agora = agora.replace(tzinfo=None)
    if expira < agora:
        db.delete(sessao)
        db.commit()
        return None
    usuario = db.get(models.Usuario, sessao.usuario_id)
    return usuario if usuario and usuario.ativo else None


def _extrair_token(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def usuario_logado(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> models.Usuario:
    """Guarda global: exige sessao valida; 'leitura' nao pode escrever."""
    token = _extrair_token(authorization)
    usuario = usuario_do_token(db, token) if token else None
    if not usuario:
        raise HTTPException(status_code=401, detail="Faça login para continuar")
    if usuario.papel == "leitura" and request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(status_code=403, detail="Seu acesso é somente leitura")
    return usuario


def exigir_admin(usuario: models.Usuario = Depends(usuario_logado)) -> models.Usuario:
    if usuario.papel != "admin":
        raise HTTPException(status_code=403, detail="Apenas administradoras podem gerenciar usuários")
    return usuario
