from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..auth import (
    PAPEIS,
    autenticar,
    criar_sessao,
    encerrar_sessao,
    exigir_admin,
    hash_senha,
    usuario_logado,
)
from ..db import get_db

# rotas abertas (login/setup); as demais rotas do app usam a guarda global
router = APIRouter(prefix="/api/auth", tags=["auth"])
router_usuarios = APIRouter(prefix="/api/usuarios", tags=["usuarios"], dependencies=[Depends(exigir_admin)])


class LoginIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=1)


class SetupIn(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=128)


def _usuario_out(u: models.Usuario) -> dict:
    return {"id": u.id, "nome": u.nome, "email": u.email, "papel": u.papel, "ativo": u.ativo}


@router.get("/precisa-setup")
def precisa_setup(db: Session = Depends(get_db)):
    return {"precisa_setup": (db.scalar(select(func.count(models.Usuario.id))) or 0) == 0}


@router.post("/setup", status_code=201)
def setup(payload: SetupIn, db: Session = Depends(get_db)):
    """Cria a PRIMEIRA conta (administradora). So funciona com o app vazio."""
    if (db.scalar(select(func.count(models.Usuario.id))) or 0) > 0:
        raise HTTPException(status_code=403, detail="O app já tem usuários — peça acesso a uma administradora")
    usuario = models.Usuario(
        nome=payload.nome.strip(),
        email=payload.email.strip().lower(),
        senha_hash=hash_senha(payload.senha),
        papel="admin",
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"token": criar_sessao(db, usuario), "usuario": _usuario_out(usuario)}


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    usuario = autenticar(db, payload.email, payload.senha)
    if not usuario:
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    return {"token": criar_sessao(db, usuario), "usuario": _usuario_out(usuario)}


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    if authorization and authorization.lower().startswith("bearer "):
        encerrar_sessao(db, authorization[7:].strip())
    return {"ok": True}


@router.get("/eu")
def eu(usuario: models.Usuario = Depends(usuario_logado)):
    return _usuario_out(usuario)


# ---------- gestao de usuarios (somente admin) ----------


class UsuarioIn(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=128)
    papel: str = "financeiro"


class UsuarioUpdate(BaseModel):
    nome: str | None = None
    papel: str | None = None
    ativo: bool | None = None
    senha: str | None = Field(default=None, min_length=8, max_length=128)


@router_usuarios.get("")
def listar_usuarios(db: Session = Depends(get_db)):
    return [_usuario_out(u) for u in db.scalars(select(models.Usuario).order_by(models.Usuario.nome)).all()]


@router_usuarios.post("", status_code=201)
def criar_usuario(payload: UsuarioIn, db: Session = Depends(get_db)):
    if payload.papel not in PAPEIS:
        raise HTTPException(status_code=422, detail="Papel deve ser admin, financeiro ou leitura")
    if db.scalar(select(models.Usuario).where(models.Usuario.email == payload.email.strip().lower())):
        raise HTTPException(status_code=422, detail="Já existe usuário com esse e-mail")
    usuario = models.Usuario(
        nome=payload.nome.strip(),
        email=payload.email.strip().lower(),
        senha_hash=hash_senha(payload.senha),
        papel=payload.papel,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return _usuario_out(usuario)


@router_usuarios.put("/{usuario_id}")
def atualizar_usuario(
    usuario_id: int,
    payload: UsuarioUpdate,
    db: Session = Depends(get_db),
    admin: models.Usuario = Depends(exigir_admin),
):
    usuario = db.get(models.Usuario, usuario_id)
    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if payload.papel is not None:
        if payload.papel not in PAPEIS:
            raise HTTPException(status_code=422, detail="Papel deve ser admin, financeiro ou leitura")
        if usuario.id == admin.id and payload.papel != "admin":
            raise HTTPException(status_code=422, detail="Você não pode rebaixar a própria conta")
        usuario.papel = payload.papel
    if payload.nome:
        usuario.nome = payload.nome.strip()
    if payload.ativo is not None:
        if usuario.id == admin.id and not payload.ativo:
            raise HTTPException(status_code=422, detail="Você não pode desativar a própria conta")
        usuario.ativo = payload.ativo
    if payload.senha:
        usuario.senha_hash = hash_senha(payload.senha)
    db.commit()
    return _usuario_out(usuario)
