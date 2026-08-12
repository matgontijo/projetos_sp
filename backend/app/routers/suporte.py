"""Chat de suporte dentro do app.

Cada usuário tem UMA conversa com o suporte. Quem atende é a conta cujo e-mail
está em SUPORTE_EMAIL (a do desenvolvedor) — para ela, a mesma API vira caixa
de entrada: lista as conversas e responde qualquer uma. Mensagem nova do
cliente dispara aviso por e-mail/WhatsApp (services/notificar), em segundo
plano e melhor-esforço.

A leitura marca como lida a mensagem do OUTRO lado — abrir a conversa é o ato
de ler, ninguém precisa clicar em "marcar como lida".
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models
from ..auth import usuario_sessao
from ..config import settings
from ..db import get_db
from ..models import utcnow
from ..services import notificar

router = APIRouter(prefix="/api/suporte", tags=["suporte"])


def _sou_suporte(usuario: models.Usuario) -> bool:
    alvo = settings.suporte_email.strip().lower()
    return bool(alvo) and usuario.email.strip().lower() == alvo


def _mensagem_out(m: models.MensagemSuporte) -> dict:
    return {
        "id": m.id,
        "autor": m.autor,
        "texto": m.texto,
        "criado_em": m.criado_em.isoformat(),
        "lida": m.lida_em is not None,
    }


def _marcar_lidas(db: Session, usuario_id: int, autor_visto: str) -> None:
    rows = db.scalars(
        select(models.MensagemSuporte).where(
            models.MensagemSuporte.usuario_id == usuario_id,
            models.MensagemSuporte.autor == autor_visto,
            models.MensagemSuporte.lida_em.is_(None),
        )
    ).all()
    for row in rows:
        row.lida_em = utcnow()
    if rows:
        db.commit()


@router.get("/resumo")
def resumo(db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_sessao)):
    """O que o botão do chat precisa: quantas mensagens esperam ESTA pessoa."""
    if _sou_suporte(usuario):
        nao_lidas = db.scalar(
            select(func.count(models.MensagemSuporte.id)).where(
                models.MensagemSuporte.autor == "cliente",
                models.MensagemSuporte.lida_em.is_(None),
            )
        )
    else:
        nao_lidas = db.scalar(
            select(func.count(models.MensagemSuporte.id)).where(
                models.MensagemSuporte.usuario_id == usuario.id,
                models.MensagemSuporte.autor == "suporte",
                models.MensagemSuporte.lida_em.is_(None),
            )
        )
    return {"nao_lidas": int(nao_lidas or 0), "sou_suporte": _sou_suporte(usuario)}


@router.get("/conversas")
def conversas(db: Session = Depends(get_db), usuario: models.Usuario = Depends(usuario_sessao)):
    """Caixa de entrada do suporte: uma linha por conversa, mais novas primeiro."""
    if not _sou_suporte(usuario):
        raise HTTPException(status_code=403, detail="Somente a conta de suporte vê as conversas")
    saida = []
    usuarios = db.scalars(select(models.Usuario)).all()
    for pessoa in usuarios:
        ultima = db.scalar(
            select(models.MensagemSuporte)
            .where(models.MensagemSuporte.usuario_id == pessoa.id)
            .order_by(models.MensagemSuporte.id.desc())
            .limit(1)
        )
        if ultima is None:
            continue
        nao_lidas = db.scalar(
            select(func.count(models.MensagemSuporte.id)).where(
                models.MensagemSuporte.usuario_id == pessoa.id,
                models.MensagemSuporte.autor == "cliente",
                models.MensagemSuporte.lida_em.is_(None),
            )
        )
        saida.append(
            {
                "usuario_id": pessoa.id,
                "nome": pessoa.nome,
                "email": pessoa.email,
                "ultima": ultima.texto[:80],
                "quando": ultima.criado_em.isoformat(),
                "nao_lidas": int(nao_lidas or 0),
            }
        )
    saida.sort(key=lambda c: c["quando"], reverse=True)
    return saida


@router.get("/mensagens")
def mensagens(
    usuario_id: int | None = Query(default=None, description="só o suporte pode abrir a conversa de outra pessoa"),
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_sessao),
):
    if usuario_id is not None and usuario_id != usuario.id:
        if not _sou_suporte(usuario):
            raise HTTPException(status_code=403, detail="Você só pode ver a sua própria conversa")
        alvo = usuario_id
        _marcar_lidas(db, alvo, "cliente")  # o suporte abriu: viu o que o cliente escreveu
    else:
        alvo = usuario.id
        _marcar_lidas(db, alvo, "suporte")  # o cliente abriu: viu as respostas

    rows = db.scalars(
        select(models.MensagemSuporte)
        .where(models.MensagemSuporte.usuario_id == alvo)
        .order_by(models.MensagemSuporte.id)
    ).all()
    dono = db.get(models.Usuario, alvo)
    return {
        "usuario": {"id": alvo, "nome": dono.nome if dono else ""},
        "mensagens": [_mensagem_out(m) for m in rows],
    }


class MensagemIn(BaseModel):
    texto: str = Field(min_length=1, max_length=4000)
    usuario_id: int | None = None  # o suporte responde apontando a conversa


@router.post("/mensagens", status_code=201)
def enviar(
    payload: MensagemIn,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(usuario_sessao),
):
    texto = payload.texto.strip()
    if not texto:
        raise HTTPException(status_code=422, detail="Mensagem vazia")

    if payload.usuario_id is not None and payload.usuario_id != usuario.id:
        # resposta do suporte na conversa de alguém
        if not _sou_suporte(usuario):
            raise HTTPException(status_code=403, detail="Você só pode escrever na sua própria conversa")
        if not db.get(models.Usuario, payload.usuario_id):
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        row = models.MensagemSuporte(usuario_id=payload.usuario_id, autor="suporte", texto=texto)
        db.add(row)
        db.commit()
        db.refresh(row)
        return _mensagem_out(row)

    # mensagem do cliente na própria conversa -> avisa quem atende
    row = models.MensagemSuporte(usuario_id=usuario.id, autor="cliente", texto=texto)
    db.add(row)
    db.commit()
    db.refresh(row)
    notificar.avisar_nova_mensagem(usuario.nome, usuario.email, texto)
    return _mensagem_out(row)
