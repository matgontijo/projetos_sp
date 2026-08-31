"""Backup e restauração do trabalho humano.

O cenário que importa: o banco EXPIRA (Render free), a pessoa cria um banco
novo, restaura o backup e re-sincroniza a Omie — nessa ordem ou na inversa.
Os ids locais de título/NF-e mudam; o que segura os ajustes e as conferências
são as chaves naturais.
"""

from datetime import date

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.db import Base
from app.services import backup
from tests.conftest import criar_nfe, criar_projeto, criar_titulo, mapear_categoria


def banco_novo() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def povoar_origem(db: Session) -> models.Empresa:
    """Um banco com trabalho humano de todos os tipos."""
    empresa = models.Empresa(
        nome="JPDV Embalagens", cnpj="11.222.333/0001-44", app_key_enc="k-enc", app_secret_enc="s-enc",
        regime="nota", aliquota_extra=3.4,
    )
    db.add(empresa)
    db.add(models.Usuario(nome="Maria", email="maria@jpdv.com", senha_hash="h1", papel="financeiro"))
    db.add(models.Usuario(nome="João", email="joao@jpdv.com", senha_hash="h2", papel="admin", pode_aprovar=True))
    db.commit()

    criar_projeto(db, empresa, 10, "BR25_600")
    titulo = criar_titulo(db, empresa, "pagar", 555, 1000.0, projeto=10, categoria="6.1.1")
    nfe = criar_nfe(db, empresa, 777, projeto=10, v_icms=120.0)
    mapear_categoria(db, empresa, "6.1.1", "producao")

    db.add(models.Ajuste(
        empresa_id=empresa.id, alvo_tipo="titulo", alvo_id=titulo.id, campo="grupo",
        valor_anterior="producao", valor_novo="frete", motivo="era frete", usuario="Maria",
    ))
    db.add(models.Ajuste(
        empresa_id=empresa.id, alvo_tipo="nfe", alvo_id=nfe.id, campo="valor_imposto",
        valor_anterior="120.0", valor_novo="100.0", motivo="ST destacada errada", usuario="Maria",
    ))
    joao = db.scalar(select(models.Usuario).where(models.Usuario.email == "joao@jpdv.com"))
    db.add(models.FechamentoAprovado(
        chave_projeto="BR25600", nome="BR25_600", nivel=1, dados={"resultado": 500.0},
        usuario="João", usuario_id=joao.id,
    ))
    db.add(models.Orcamento(chave_projeto="BR25600", nome_exibicao="BR25_600", resultado_previsto=77023.20))
    db.add(models.Comentario(chave_projeto="BR25600", texto="margem ok", usuario="Maria"))
    db.add(models.Configuracao(chave="margem_alvo", valor="20"))
    db.add(models.Produto(nome="Copo 500ml", categoria="copo", custo_base=1.25))
    db.add(models.PerfilTributacao(
        empresa_id=empresa.id, nome="Fins de exportação",
        impostos=[{"nome": "CSLL", "aliquota": 1.2}, {"nome": "IRPJ", "aliquota": 1.08}],
    ))
    db.add(models.TributacaoProjeto(chave_projeto="BR25600", perfil="Fins de exportação", atualizado_por="Maria"))
    db.commit()
    return empresa


def test_exportar_leva_o_trabalho_humano_com_chaves_naturais(db: Session):
    povoar_origem(db)
    dados = backup.exportar(db)

    assert dados["formato"] == "custeio-backup"
    t = dados["tabelas"]
    assert len(t["usuarios"]) == 2
    assert len(t["ajustes"]) == 2
    # o ajuste NAO carrega id local: carrega a identidade Omie do alvo
    ajuste_titulo = next(a for a in t["ajustes"] if a["alvo_tipo"] == "titulo")
    assert ajuste_titulo["alvo"]["codigo_lancamento_omie"] == 555
    assert ajuste_titulo["empresa"]["cnpj"] == "11.222.333/0001-44"
    assert "alvo_id" not in ajuste_titulo
    # conferencia assina por e-mail, nao por id
    assert t["fechamentos_aprovados"][0]["usuario_email"] == "joao@jpdv.com"


def test_restaurar_em_banco_novo_resolve_ids_novos(db: Session):
    povoar_origem(db)
    dados = backup.exportar(db)

    destino = banco_novo()
    # simula o banco novo JA sincronizado: mesmos dados Omie, ids locais DIFERENTES
    empresa2 = models.Empresa(nome="JPDV Embalagens", cnpj="11.222.333/0001-44", app_key_enc="x", app_secret_enc="y")
    destino.add(models.Empresa(nome="Outra", cnpj="99", app_key_enc="a", app_secret_enc="b"))  # desloca ids
    destino.add(empresa2)
    destino.commit()
    criar_titulo(destino, empresa2, "pagar", 555, 1000.0, projeto=10, categoria="6.1.1")
    criar_nfe(destino, empresa2, 777, projeto=10, v_icms=120.0)

    resumo = backup.restaurar(destino, dados)

    assert resumo["criados"]["ajustes"] == 2
    ajuste = destino.scalar(select(models.Ajuste).where(models.Ajuste.alvo_tipo == "titulo"))
    titulo = destino.scalar(select(models.Titulo).where(models.Titulo.codigo_lancamento_omie == 555))
    assert ajuste.alvo_id == titulo.id  # id NOVO, resolvido pela chave natural
    assert ajuste.empresa_id == empresa2.id
    # conferencia religada ao usuario restaurado
    ok = destino.scalar(select(models.FechamentoAprovado))
    joao = destino.scalar(select(models.Usuario).where(models.Usuario.email == "joao@jpdv.com"))
    assert ok.usuario_id == joao.id
    assert float(destino.scalar(select(models.Orcamento)).resultado_previsto) == pytest.approx(77023.20)


def test_restaurar_antes_do_sync_deixa_ajustes_pendentes_e_completa_depois(db: Session):
    povoar_origem(db)
    dados = backup.exportar(db)

    destino = banco_novo()
    resumo1 = backup.restaurar(destino, dados)  # banco 100% vazio: nada da Omie ainda

    assert resumo1["criados"]["usuarios"] == 2
    assert resumo1["criados"]["empresas"] == 1
    assert resumo1["pendentes"]["ajustes"] == 2  # sem titulo/nfe nao ha como religar
    assert resumo1["criados"]["fechamentos_aprovados"] == 1  # conferencia nao depende do sync
    # perfis de tributacao e a escolha do projeto voltam junto (a empresa ja foi criada acima)
    assert resumo1["criados"]["perfis_tributacao"] == 1
    assert resumo1["criados"]["tributacoes_projeto"] == 1

    # "sincronizou": os dados da Omie chegaram
    empresa2 = destino.scalar(select(models.Empresa).where(models.Empresa.cnpj == "11.222.333/0001-44"))
    criar_titulo(destino, empresa2, "pagar", 555, 1000.0, projeto=10, categoria="6.1.1")
    criar_nfe(destino, empresa2, 777, projeto=10, v_icms=120.0)

    resumo2 = backup.restaurar(destino, dados)  # segunda passada completa o servico
    assert resumo2["criados"]["ajustes"] == 2
    assert resumo2["pulados"]["usuarios"] == 2  # nada duplicado


def test_restaurar_e_idempotente_e_nao_sobrescreve(db: Session):
    povoar_origem(db)
    dados = backup.exportar(db)

    destino = banco_novo()
    backup.restaurar(destino, dados)
    # a pessoa mexeu no destino depois da 1a restauracao
    orc = destino.scalar(select(models.Orcamento))
    orc.resultado_previsto = 99999.0
    destino.commit()

    resumo = backup.restaurar(destino, dados)

    assert resumo["criados"].get("orcamentos") is None  # nada recriado
    assert float(destino.scalar(select(models.Orcamento)).resultado_previsto) == pytest.approx(99999.0)  # e nada sobrescrito
    assert destino.scalar(select(models.Usuario).where(models.Usuario.email == "maria@jpdv.com")).senha_hash == "h1"


def test_arquivo_que_nao_e_backup_e_recusado(db: Session):
    with pytest.raises(ValueError, match="não é um backup"):
        backup.restaurar(db, {"qualquer": "coisa"})
    with pytest.raises(ValueError, match="versão mais nova"):
        backup.restaurar(db, {"formato": "custeio-backup", "versao": 999, "tabelas": {}})


def test_datas_sobrevivem_ida_e_volta(db: Session):
    povoar_origem(db)
    db.add(models.SimplesPeriodo(empresa_id=db.scalar(select(models.Empresa.id)), competencia="2026-05", rbt12=100000.0))
    db.add(models.FechamentoAprovado(
        chave_projeto="BR25601", nome="BR25_601", nivel=1, periodo_de=date(2026, 1, 1),
        periodo_ate=date(2026, 6, 30), dados={}, usuario="Maria",
    ))
    db.commit()

    destino = banco_novo()
    backup.restaurar(destino, backup.exportar(db))

    ok = destino.scalar(select(models.FechamentoAprovado).where(models.FechamentoAprovado.chave_projeto == "BR25601"))
    assert ok.periodo_de == date(2026, 1, 1)
    assert ok.periodo_ate == date(2026, 6, 30)
    assert destino.scalar(select(models.SimplesPeriodo)).competencia == "2026-05"


def test_restaurar_devolve_classificacao_humana_por_cima_de_sugestao_do_sync(db: Session):
    """Troca de credencial limpa as categorias; o sync recria com sugestão
    automática. Restaurar DEPOIS disso tem que devolver o trabalho humano —
    mas nunca por cima de classificação que outra pessoa já refez."""
    povoar_origem(db)
    dados = backup.exportar(db)

    destino = banco_novo()
    backup.restaurar(destino, dados)

    # simula o pós-limpeza: sync recriou a categoria com sugestão automática
    cg = destino.scalar(select(models.CategoriaGrupo))
    codigo = cg.codigo_categoria
    grupo_humano = cg.grupo
    cg.grupo = "outros"
    cg.atualizado_por = "sync (sugestão automática)"
    destino.commit()

    backup.restaurar(destino, dados)
    cg = destino.scalar(select(models.CategoriaGrupo).where(models.CategoriaGrupo.codigo_categoria == codigo))
    assert cg.grupo == grupo_humano  # o humano do backup venceu a sugestão

    # mas se uma PESSOA reclassificou no destino, o backup não passa por cima
    cg.grupo = "frete"
    cg.atualizado_por = "outra pessoa"
    destino.commit()
    backup.restaurar(destino, dados)
    cg = destino.scalar(select(models.CategoriaGrupo).where(models.CategoriaGrupo.codigo_categoria == codigo))
    assert cg.grupo == "frete"
