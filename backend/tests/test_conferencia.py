"""Dupla conferencia: um projeto so fecha com DOIS ok, de pessoas diferentes."""

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import cache, models
from app.routers.extras import AprovacaoIn, aprovar, desfazer_aprovacao, listar_aprovacoes
from app.routers.projetos import fechamento as rota_fechamento
from app.services import conferencia
from tests.conftest import criar_projeto, criar_titulo


def criar_usuario(db: Session, nome: str, papel: str = "financeiro", pode_aprovar: bool = False) -> models.Usuario:
    row = models.Usuario(
        nome=nome,
        email=f"{nome.lower().replace(' ', '.')}@teste.com",
        senha_hash="x",
        papel=papel,
        pode_aprovar=pode_aprovar,
    )
    db.add(row)
    db.commit()
    return row


def linha(nome: str = "BR26_055", resultado: float = 1000.0) -> dict:
    return {"projeto": nome, "resultado": resultado, "receita": 5000.0}


@pytest.fixture()
def maria(db: Session) -> models.Usuario:
    return criar_usuario(db, "Maria")


@pytest.fixture()
def joao(db: Session) -> models.Usuario:
    """O aprovador — e quem esta marcado no cadastro que da o 2o ok."""
    return criar_usuario(db, "Joao", pode_aprovar=True)


def test_projeto_novo_esta_pendente(db: Session):
    status = conferencia.status_do_projeto(db, "BR26_055", 1000.0)
    assert status["status"] == "pendente"
    assert status["oks"] == 0
    assert status["divergente"] is False


def test_primeiro_ok_deixa_conferido(db: Session, maria: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)

    status = conferencia.status_do_projeto(db, "BR26_055", 1000.0)
    assert status["status"] == "conferido"
    assert status["oks"] == 1
    assert status["conferido_por"] == "Maria"
    assert status["aprovado_por"] == ""


def test_quem_nao_e_aprovador_no_cadastro_nao_da_o_segundo_ok(db: Session, maria: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    outra = criar_usuario(db, "Ana")  # tambem nao e aprovadora

    with pytest.raises(conferencia.ConferenciaInvalida) as erro:
        conferencia.registrar(db, outra, "BR26_055", linha(), None, None)
    assert erro.value.status == 403
    assert conferencia.status_do_projeto(db, "BR26_055", 1000.0)["oks"] == 1


def test_mesma_pessoa_nao_da_os_dois_oks(db: Session, joao: models.Usuario):
    """Joao pode aprovar, mas nao pode aprovar o que ele mesmo conferiu."""
    conferencia.registrar(db, joao, "BR26_055", linha(), None, None)

    with pytest.raises(conferencia.ConferenciaInvalida) as erro:
        conferencia.registrar(db, joao, "BR26_055", linha(), None, None)
    assert erro.value.status == 409
    assert conferencia.status_do_projeto(db, "BR26_055", 1000.0)["oks"] == 1


def test_dois_oks_de_pessoas_diferentes_aprovam(db: Session, maria: models.Usuario, joao: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    conferencia.registrar(db, joao, "BR26_055", linha(), None, None)

    status = conferencia.status_do_projeto(db, "BR26_055", 1000.0)
    assert status["status"] == "aprovado"
    assert status["oks"] == 2
    assert status["conferido_por"] == "Maria"
    assert status["aprovado_por"] == "Joao"


def test_terceiro_ok_e_recusado(db: Session, maria: models.Usuario, joao: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    conferencia.registrar(db, joao, "BR26_055", linha(), None, None)
    outra = criar_usuario(db, "Ana", papel="admin", pode_aprovar=True)

    with pytest.raises(conferencia.ConferenciaInvalida) as erro:
        conferencia.registrar(db, outra, "BR26_055", linha(), None, None)
    assert erro.value.status == 409


def test_ok_vale_para_o_projeto_mesmo_digitado_diferente(db: Session, maria: models.Usuario):
    """A chave ignora espaco, ponto, hifen e underscore — igual ao fechamento."""
    conferencia.registrar(db, maria, "BR25_485_33.B01.A", linha("BR25_485_33.B01.A"), None, None)

    assert conferencia.status_do_projeto(db, "BR25_485 - 33 B01 A", 1000.0)["status"] == "conferido"


# --- Mudanca depois do ok: avisa, mas nao apaga nada ---


def test_numeros_mudam_depois_do_ok_marca_divergente(db: Session, maria: models.Usuario, joao: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(resultado=1000.0), None, None)
    conferencia.registrar(db, joao, "BR26_055", linha(resultado=1000.0), None, None)

    status = conferencia.status_do_projeto(db, "BR26_055", 900.0)  # um ajuste mexeu no resultado
    assert status["divergente"] is True
    # os ok continuam de pe — o historico nao se perde
    assert status["status"] == "aprovado"
    assert status["oks"] == 2
    assert status["resultado_conferido"] == 1000.0


def test_diferenca_de_centavo_nao_conta_como_mudanca(db: Session, maria: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha(resultado=1000.0), None, None)

    assert conferencia.status_do_projeto(db, "BR26_055", 1000.005)["divergente"] is False
    assert conferencia.status_do_projeto(db, "BR26_055", 1000.02)["divergente"] is True


# --- Desfazer (so admin) ---


def test_desfazer_aprovacao_volta_para_conferido(db: Session, maria: models.Usuario, joao: models.Usuario):
    admin = criar_usuario(db, "Chefe", papel="admin", pode_aprovar=True)
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    ok2 = conferencia.registrar(db, joao, "BR26_055", linha(), None, None)

    conferencia.revogar(db, admin, ok2.id)

    status = conferencia.status_do_projeto(db, "BR26_055", 1000.0)
    assert status["status"] == "conferido"
    assert status["oks"] == 1


def test_nao_desfaz_a_conferencia_com_aprovacao_de_pe(db: Session, maria: models.Usuario, joao: models.Usuario):
    admin = criar_usuario(db, "Chefe", papel="admin", pode_aprovar=True)
    ok1 = conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    conferencia.registrar(db, joao, "BR26_055", linha(), None, None)

    with pytest.raises(conferencia.ConferenciaInvalida):
        conferencia.revogar(db, admin, ok1.id)
    assert conferencia.status_do_projeto(db, "BR26_055", 1000.0)["status"] == "aprovado"


def test_ok_desfeito_fica_no_historico_e_libera_novo_ok(db: Session, maria: models.Usuario):
    admin = criar_usuario(db, "Chefe", papel="admin", pode_aprovar=True)
    ok1 = conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    conferencia.revogar(db, admin, ok1.id)

    assert conferencia.status_do_projeto(db, "BR26_055", 1000.0)["status"] == "pendente"
    # a linha continua la, marcada — nada e apagado
    historico = conferencia.historico(db, "BR26_055")
    assert len(historico) == 1
    assert historico[0].revogado_por == "Chefe"
    # e a mesma pessoa pode conferir de novo: o ok anterior nao vale mais
    conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    assert conferencia.status_do_projeto(db, "BR26_055", 1000.0)["status"] == "conferido"


def test_desfazer_duas_vezes_e_recusado(db: Session, maria: models.Usuario):
    admin = criar_usuario(db, "Chefe", papel="admin", pode_aprovar=True)
    ok1 = conferencia.registrar(db, maria, "BR26_055", linha(), None, None)
    conferencia.revogar(db, admin, ok1.id)

    with pytest.raises(conferencia.ConferenciaInvalida):
        conferencia.revogar(db, admin, ok1.id)


# --- Linhas anteriores a dupla conferencia ---


def test_aprovacao_antiga_sem_usuario_id_conta_como_conferencia(db: Session):
    """O app ja tinha aprovacao simples; aquelas linhas viram o 1o ok."""
    db.add(
        models.FechamentoAprovado(
            chave_projeto="BR26055", nome="BR26_055", dados=linha(), usuario="Maria"  # nivel default = 1
        )
    )
    db.commit()

    status = conferencia.status_do_projeto(db, "BR26_055", 1000.0)
    assert status["status"] == "conferido"
    assert status["conferido_por"] == "Maria"

    # e o app ainda reconhece que foi a Maria, mesmo sem o id gravado
    maria = criar_usuario(db, "Maria", pode_aprovar=True)
    with pytest.raises(conferencia.ConferenciaInvalida):
        conferencia.registrar(db, maria, "BR26_055", linha(), None, None)


# --- Integracao com o fechamento ---


def test_anotar_fechamento_conta_e_nao_altera_o_original(db: Session, maria: models.Usuario, joao: models.Usuario):
    conferencia.registrar(db, maria, "BR26_055", linha("BR26_055"), None, None)
    conferencia.registrar(db, joao, "BR26_055", linha("BR26_055"), None, None)
    conferencia.registrar(db, maria, "BR26_060", linha("BR26_060"), None, None)

    fechamento = {
        "projetos": [linha("BR26_055"), linha("BR26_060"), linha("BR26_070")],
        "consolidado": {"receita": 15000.0},
    }
    anotado = conferencia.anotar_fechamento(db, fechamento)

    assert [p["conferencia"]["status"] for p in anotado["projetos"]] == ["aprovado", "conferido", "pendente"]
    assert anotado["consolidado"]["qtd_aprovados"] == 1
    assert anotado["consolidado"]["qtd_conferidos"] == 1
    assert anotado["consolidado"]["qtd_pendentes"] == 1
    assert anotado["consolidado"]["qtd_divergentes"] == 0
    assert anotado["consolidado"]["receita"] == 15000.0  # o que ja existia continua

    # o fechamento vem do cache em memoria: anotar NAO pode contamina-lo
    assert "conferencia" not in fechamento["projetos"][0]
    assert "qtd_pendentes" not in fechamento["consolidado"]


# --- Rotas HTTP ---


@pytest.fixture()
def projeto_faturado(db: Session, empresa: models.Empresa):
    """Um projeto de venda com receita — o suficiente para gerar linha de fechamento."""
    criar_projeto(db, empresa, 1, "BR26_055")
    criar_titulo(db, empresa, "receber", 100, 5000.0, projeto=1)
    cache.invalidar()  # o cache do fechamento e global ao processo
    return "BR26_055"


def test_rota_da_os_dois_oks_na_ordem(db: Session, projeto_faturado, maria, joao):
    primeiro = aprovar(AprovacaoIn(nome=projeto_faturado), db, maria)
    assert primeiro["nivel"] == 1
    assert primeiro["rotulo"] == "conferência"
    assert primeiro["dados"]["resultado"] == 5000.0  # os numeros ficam congelados

    segundo = aprovar(AprovacaoIn(nome=projeto_faturado), db, joao)
    assert segundo["nivel"] == 2
    assert segundo["rotulo"] == "aprovação"


def test_rota_recusa_segundo_ok_de_quem_nao_aprova(db: Session, projeto_faturado, maria):
    aprovar(AprovacaoIn(nome=projeto_faturado), db, maria)
    outra = criar_usuario(db, "Ana")

    with pytest.raises(HTTPException) as exc:
        aprovar(AprovacaoIn(nome=projeto_faturado), db, outra)
    assert exc.value.status_code == 403


def test_rota_recusa_projeto_sem_fechamento(db: Session, projeto_faturado, maria):
    with pytest.raises(HTTPException) as exc:
        aprovar(AprovacaoIn(nome="BR99_999"), db, maria)
    assert exc.value.status_code == 404


def test_rota_desfazer_marca_e_some_do_status(db: Session, projeto_faturado, maria, joao):
    admin = criar_usuario(db, "Chefe", papel="admin", pode_aprovar=True)
    aprovar(AprovacaoIn(nome=projeto_faturado), db, maria)
    segundo = aprovar(AprovacaoIn(nome=projeto_faturado), db, joao)

    desfeito = desfazer_aprovacao(segundo["id"], db, admin)
    assert desfeito["revogado_por"] == "Chefe"
    assert desfeito["revogado_em"] is not None

    historico = listar_aprovacoes(projeto_faturado, db)
    assert len(historico) == 2  # nada foi apagado
    assert conferencia.status_do_projeto(db, projeto_faturado, 5000.0)["status"] == "conferido"


def test_fechamento_leva_o_status_de_conferencia(db: Session, projeto_faturado, maria):
    antes = rota_fechamento(empresa_ids=None, de=None, ate=None, db=db)
    assert antes["projetos"][0]["conferencia"]["status"] == "pendente"
    assert antes["consolidado"]["qtd_pendentes"] == 1
    assert antes["consolidado"]["qtd_aprovados"] == 0

    aprovar(AprovacaoIn(nome=projeto_faturado), db, maria)

    # dar um ok NAO invalida o cache do fechamento (os numeros nao mudaram),
    # mas o status tem de aparecer na hora mesmo assim
    depois = rota_fechamento(empresa_ids=None, de=None, ate=None, db=db)
    assert depois["projetos"][0]["conferencia"]["status"] == "conferido"
    assert depois["projetos"][0]["conferencia"]["conferido_por"] == "Maria"
    assert depois["consolidado"]["qtd_conferidos"] == 1
    assert depois["consolidado"]["qtd_pendentes"] == 0
