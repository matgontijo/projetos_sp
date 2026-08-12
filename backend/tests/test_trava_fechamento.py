"""Fechamento aprovado é TRAVADO: dois ok vigentes bloqueiam edição manual.

A sincronização continua fluindo (dados da Omie não param), e a divergência já
é sinalizada; o que trava é a mão humana — ajuste e troca de tributação.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.routers.ajustes import criar as criar_ajuste
from app.routers.extras import TributacaoIn, definir_tributacao
from app.services import conferencia
from tests.conftest import criar_projeto, criar_titulo


def usuario(db: Session, nome: str, aprova: bool = False) -> models.Usuario:
    row = models.Usuario(
        nome=nome, email=f"{nome.lower()}@teste.com", senha_hash="x",
        papel="financeiro", pode_aprovar=aprova,
    )
    db.add(row)
    db.commit()
    return row


def aprovar_projeto(db: Session, nome: str) -> models.FechamentoAprovado:
    maria = usuario(db, f"Maria{nome[-3:]}")
    joao = usuario(db, f"Joao{nome[-3:]}", aprova=True)
    linha = {"projeto": nome, "resultado": 1000.0}
    conferencia.registrar(db, maria, nome, linha, None, None)
    return conferencia.registrar(db, joao, nome, linha, None, None)


def ajuste(empresa_id: int, alvo_id: int, campo: str = "grupo", valor: str = "frete") -> schemas.AjusteCreate:
    return schemas.AjusteCreate(
        empresa_id=empresa_id, alvo_tipo="titulo", alvo_id=alvo_id,
        campo=campo, valor_novo=valor, motivo="teste",
    )


def test_ajuste_em_projeto_aprovado_e_bloqueado(db: Session, empresa: models.Empresa):
    criar_projeto(db, empresa, 1, "BR26_100")
    titulo = criar_titulo(db, empresa, "pagar", 500, 800.0, projeto=1, categoria="6.1.1")
    aprovar_projeto(db, "BR26_100")
    quem = usuario(db, "Editor")

    with pytest.raises(HTTPException) as exc:
        criar_ajuste(ajuste(empresa.id, titulo.id), db, quem)
    assert exc.value.status_code == 409
    assert "travados" in exc.value.detail


def test_desfazer_o_segundo_ok_destrava(db: Session, empresa: models.Empresa):
    criar_projeto(db, empresa, 1, "BR26_101")
    titulo = criar_titulo(db, empresa, "pagar", 501, 800.0, projeto=1, categoria="6.1.1")
    ok2 = aprovar_projeto(db, "BR26_101")
    admin = usuario(db, "Chefe", aprova=True)
    admin.papel = "admin"
    db.commit()

    conferencia.revogar(db, admin, ok2.id)

    quem = usuario(db, "Editora")
    saida = criar_ajuste(ajuste(empresa.id, titulo.id), db, quem)
    assert saida.campo == "grupo"  # passou


def test_mover_para_projeto_aprovado_e_bloqueado(db: Session, empresa: models.Empresa):
    """Sem isso, dava para inflar um fechamento já assinado empurrando custo para ele."""
    criar_projeto(db, empresa, 1, "BR26_102")  # aprovado
    criar_projeto(db, empresa, 2, "BR26_103")  # livre
    titulo_livre = criar_titulo(db, empresa, "pagar", 502, 800.0, projeto=2, categoria="6.1.1")
    aprovar_projeto(db, "BR26_102")
    quem = usuario(db, "Editor2")

    with pytest.raises(HTTPException) as exc:
        criar_ajuste(ajuste(empresa.id, titulo_livre.id, campo="codigo_projeto", valor="1"), db, quem)
    assert exc.value.status_code == 409
    assert "destino" in exc.value.detail


def test_titulo_movido_para_fora_continua_editavel(db: Session, empresa: models.Empresa):
    """O que foi movido PARA FORA do projeto aprovado (antes da aprovação) é livre."""
    criar_projeto(db, empresa, 1, "BR26_104")
    criar_projeto(db, empresa, 2, "BR26_105")
    titulo = criar_titulo(db, empresa, "pagar", 503, 800.0, projeto=1, categoria="6.1.1")
    quem = usuario(db, "Editor3")
    # move para o BR26_105 ANTES de aprovar o BR26_104
    criar_ajuste(ajuste(empresa.id, titulo.id, campo="codigo_projeto", valor="2"), db, quem)
    aprovar_projeto(db, "BR26_104")

    # o título agora pertence ao BR26_105 (livre): editar pode
    saida = criar_ajuste(ajuste(empresa.id, titulo.id), db, quem)
    assert saida.valor_novo == "frete"


def test_tributacao_de_projeto_aprovado_e_bloqueada(db: Session, empresa: models.Empresa):
    criar_projeto(db, empresa, 1, "BR26_106")
    criar_titulo(db, empresa, "receber", 504, 10_000.0, projeto=1)
    db.add(models.PerfilTributacao(empresa_id=empresa.id, nome="Fins de exportação", impostos=[]))
    db.commit()
    aprovar_projeto(db, "BR26_106")
    quem = usuario(db, "Editor4")

    with pytest.raises(HTTPException) as exc:
        definir_tributacao(TributacaoIn(nome="BR26_106", perfil="Fins de exportação"), db, quem)
    assert exc.value.status_code == 409
