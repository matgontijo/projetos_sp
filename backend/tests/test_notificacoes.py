"""Central de notificações: alertas do fechamento com leitura POR PESSOA."""

from sqlalchemy.orm import Session

from app import cache, models
from app.routers.notificacoes import MarcarIn, listar, marcar_lidas
from tests.conftest import criar_projeto, criar_titulo


def usuario(db: Session, nome: str) -> models.Usuario:
    row = models.Usuario(nome=nome, email=f"{nome.lower()}@teste.com", senha_hash="x", papel="financeiro")
    db.add(row)
    db.commit()
    return row


def cenario_com_prejuizo(db: Session, empresa: models.Empresa) -> None:
    criar_projeto(db, empresa, 1, "BR26_900")
    criar_titulo(db, empresa, "receber", 500, 10_000.0, projeto=1)
    criar_titulo(db, empresa, "pagar", 501, 14_000.0, projeto=1, categoria="6.1.1")
    db.add(models.CategoriaGrupo(empresa_id=empresa.id, codigo_categoria="6.1.1", grupo="producao"))
    db.commit()
    cache.invalidar()


def test_alerta_vira_notificacao_nao_lida(db: Session, empresa: models.Empresa):
    cenario_com_prejuizo(db, empresa)
    maria = usuario(db, "Maria")

    saida = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)

    assert saida["nao_lidas"] >= 1
    prejuizo = next(i for i in saida["itens"] if "prejuízo" in i["titulo"])
    assert prejuizo["lida"] is False
    assert prejuizo["gravidade"] == "critica"
    assert len(prejuizo["chave"]) == 16


def test_marcar_lida_zera_o_contador_so_para_quem_marcou(db: Session, empresa: models.Empresa):
    cenario_com_prejuizo(db, empresa)
    maria, joao = usuario(db, "Maria"), usuario(db, "Joao")

    antes = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)
    chaves = [i["chave"] for i in antes["itens"]]
    marcar_lidas(MarcarIn(chaves=chaves), db, maria)

    depois_maria = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)
    depois_joao = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=joao)
    assert depois_maria["nao_lidas"] == 0
    assert all(i["lida"] for i in depois_maria["itens"])
    # o estado é pessoal: o João continua com tudo por ler
    assert depois_joao["nao_lidas"] == len(depois_joao["itens"])


def test_marcar_duas_vezes_nao_duplica(db: Session, empresa: models.Empresa):
    cenario_com_prejuizo(db, empresa)
    maria = usuario(db, "Maria")
    chaves = [i["chave"] for i in listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)["itens"]]

    marcar_lidas(MarcarIn(chaves=chaves), db, maria)
    marcar_lidas(MarcarIn(chaves=chaves), db, maria)  # segunda passada: sem erro de unique

    total = db.query(models.NotificacaoLida).filter_by(usuario_id=maria.id).count()
    assert total == len(chaves)


def test_conferencia_pendente_entra_como_notificacao(db: Session, empresa: models.Empresa):
    cenario_com_prejuizo(db, empresa)
    maria = usuario(db, "Maria")

    saida = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)

    pendencia = next(i for i in saida["itens"] if "conferência" in i["titulo"])
    assert pendencia["rota"] == "/projetos?conf=pendente"


def test_alerta_que_mudou_volta_como_nao_lido(db: Session, empresa: models.Empresa):
    """A chave é hash do conteúdo: alerta com números novos é notificação nova."""
    cenario_com_prejuizo(db, empresa)
    maria = usuario(db, "Maria")
    chaves = [i["chave"] for i in listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)["itens"]]
    marcar_lidas(MarcarIn(chaves=chaves), db, maria)

    # o prejuízo piora: o detalhe muda, a chave muda, a notificação renasce
    criar_titulo(db, empresa, "pagar", 502, 5_000.0, projeto=1, categoria="6.1.1")
    cache.invalidar()

    saida = listar(empresa_ids=None, de=None, ate=None, db=db, usuario=maria)
    prejuizo = next(i for i in saida["itens"] if "prejuízo" in i["titulo"])
    assert prejuizo["lida"] is False
