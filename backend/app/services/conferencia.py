"""Dupla conferencia por projeto — o projeto so esta fechado com DOIS 'ok'.

Regra (definida pela cliente):
- 1o ok, "conferencia": qualquer usuario que possa escrever no custeio.
- 2o ok, "aprovacao": SO quem estiver marcado como aprovador no cadastro
  (`usuario.pode_aprovar`) e NUNCA a mesma pessoa que deu o 1o ok.
- A ordem e fixa: o 2o ok so existe depois do 1o.
- Cada ok congela os numeros que a pessoa viu. Se o fechamento mudar depois
  (ajuste manual, nova sincronizacao), os ok CONTINUAM valendo e o projeto passa
  a exibir 'mudou depois da conferencia' — nada se perde para auditoria.
- Desfazer um ok e privilegio de admin, e nunca apaga a linha (revogacao).
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from ..models import utcnow
from .calculo import chave_projeto

NIVEL_CONFERENCIA = 1
NIVEL_APROVACAO = 2
ROTULO_NIVEL = {NIVEL_CONFERENCIA: "conferência", NIVEL_APROVACAO: "aprovação"}

# Diferenca de resultado abaixo de um centavo nao e mudanca real (evita alarme
# falso por arredondamento). Mesma tolerancia que a tela ja usava.
TOLERANCIA = 0.01


class ConferenciaInvalida(Exception):
    """Regra da dupla conferencia violada — o router converte em HTTP."""

    def __init__(self, mensagem: str, status: int = 409):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


def _oks_vigentes(db: Session, chaves: list[str]) -> dict[str, dict[int, models.FechamentoAprovado]]:
    """{chave_projeto: {nivel: ok}} considerando so os ok nao revogados."""
    if not chaves:
        return {}
    rows = db.scalars(
        select(models.FechamentoAprovado)
        .where(
            models.FechamentoAprovado.chave_projeto.in_(chaves),
            models.FechamentoAprovado.revogado_em.is_(None),
        )
        .order_by(models.FechamentoAprovado.id)
    ).all()
    vigentes: dict[str, dict[int, models.FechamentoAprovado]] = {}
    for row in rows:  # ordem crescente de id -> o mais recente de cada nivel vence
        vigentes.setdefault(row.chave_projeto, {})[row.nivel] = row
    return vigentes


def _mesma_pessoa(ok: models.FechamentoAprovado, usuario: models.Usuario) -> bool:
    if ok.usuario_id is not None:
        return ok.usuario_id == usuario.id
    # ok antigo (anterior a dupla conferencia) nao guardava o id — cai no nome
    return bool(ok.usuario) and ok.usuario.strip().lower() == usuario.nome.strip().lower()


def _resultado_do_ok(ok: models.FechamentoAprovado | None) -> float | None:
    if ok is None:
        return None
    try:
        return float((ok.dados or {}).get("resultado") or 0)
    except (TypeError, ValueError):
        return None


def bloco_status(oks: dict[int, models.FechamentoAprovado], resultado_atual: float | None) -> dict:
    """Status de conferencia de UM projeto, ja comparado com os numeros de agora."""
    conferido = oks.get(NIVEL_CONFERENCIA)
    aprovado = oks.get(NIVEL_APROVACAO)

    if aprovado is not None:
        status = "aprovado"
    elif conferido is not None:
        status = "conferido"
    else:
        status = "pendente"

    def mudou(ok: models.FechamentoAprovado | None) -> bool:
        congelado = _resultado_do_ok(ok)
        if congelado is None or resultado_atual is None:
            return False
        return abs(congelado - resultado_atual) > TOLERANCIA

    vigente = aprovado or conferido
    return {
        "status": status,
        "oks": 2 if aprovado is not None else (1 if conferido is not None else 0),
        "conferido_id": conferido.id if conferido else None,
        "conferido_por": conferido.usuario if conferido else "",
        "conferido_em": conferido.criado_em.isoformat() if conferido else None,
        "aprovado_id": aprovado.id if aprovado else None,
        "aprovado_por": aprovado.usuario if aprovado else "",
        "aprovado_em": aprovado.criado_em.isoformat() if aprovado else None,
        "resultado_conferido": _resultado_do_ok(vigente),
        # os numeros mudaram depois de algum ok que ainda vale
        "divergente": mudou(conferido) or mudou(aprovado),
    }


def anotar_fechamento(db: Session, fechamento: dict) -> dict:
    """Devolve uma COPIA do fechamento com o status de conferencia por projeto.

    Copia porque o fechamento vem do cache em memoria — mutar contaminaria as
    proximas leituras, que nao sao invalidadas quando alguem da um ok.
    """
    projetos = fechamento.get("projetos") or []
    vigentes = _oks_vigentes(db, list({chave_projeto(p.get("projeto", "")) for p in projetos}))

    contagem = {"pendente": 0, "conferido": 0, "aprovado": 0}
    divergentes = 0
    anotados = []
    for projeto in projetos:
        oks = vigentes.get(chave_projeto(projeto.get("projeto", "")), {})
        bloco = bloco_status(oks, projeto.get("resultado"))
        contagem[bloco["status"]] += 1
        if bloco["divergente"]:
            divergentes += 1
        anotados.append({**projeto, "conferencia": bloco})

    consolidado = {
        **(fechamento.get("consolidado") or {}),
        "qtd_pendentes": contagem["pendente"],
        "qtd_conferidos": contagem["conferido"],
        "qtd_aprovados": contagem["aprovado"],
        "qtd_divergentes": divergentes,
    }
    return {**fechamento, "projetos": anotados, "consolidado": consolidado}


def status_do_projeto(db: Session, nome: str, resultado_atual: float | None) -> dict:
    chave = chave_projeto(nome)
    return bloco_status(_oks_vigentes(db, [chave]).get(chave, {}), resultado_atual)


def _proximo_nivel(oks: dict[int, models.FechamentoAprovado], usuario: models.Usuario) -> int:
    """Qual ok esta pessoa pode dar agora — ou por que nao pode.

    Regra unica, usada tanto no ok avulso quanto no lote.
    """
    if NIVEL_APROVACAO in oks:
        raise ConferenciaInvalida("Este projeto já tem os dois ok — está conferido e aprovado.")

    conferido = oks.get(NIVEL_CONFERENCIA)
    if conferido is None:
        return NIVEL_CONFERENCIA

    # "voce mesmo conferiu" vem ANTES de "voce nao e aprovador": quando as duas
    # sao verdade, a primeira e a que explica a situacao real e o que fazer.
    if _mesma_pessoa(conferido, usuario):
        raise ConferenciaInvalida(
            "Você deu o 1º ok neste projeto — o 2º tem de ser de outra pessoa. "
            "Cadastre quem vai aprovar em Empresas → Equipe e marque a conta como aprovadora."
        )
    if not usuario.pode_aprovar:
        raise ConferenciaInvalida(
            "O 2º ok é de quem está marcado como aprovador no cadastro. "
            "Peça a uma administradora para marcar a sua conta em Empresas → Equipe.",
            status=403,
        )
    return NIVEL_APROVACAO


def _novo_ok(
    usuario: models.Usuario, chave: str, nome: str, nivel: int, linha: dict, de: date | None, ate: date | None
) -> models.FechamentoAprovado:
    return models.FechamentoAprovado(
        chave_projeto=chave,
        nome=linha.get("projeto") or nome,
        nivel=nivel,
        periodo_de=de,
        periodo_ate=ate,
        dados=linha,
        usuario=usuario.nome,
        usuario_id=usuario.id,
    )


def registrar(
    db: Session,
    usuario: models.Usuario,
    nome: str,
    linha: dict,
    de: date | None,
    ate: date | None,
) -> models.FechamentoAprovado:
    """Da o proximo ok do projeto — o nivel sai do estado atual, nao do cliente."""
    chave = chave_projeto(nome)
    oks = _oks_vigentes(db, [chave]).get(chave, {})
    nivel = _proximo_nivel(oks, usuario)

    row = _novo_ok(usuario, chave, nome, nivel, linha, de, ate)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def registrar_lote(
    db: Session,
    usuario: models.Usuario,
    linhas_por_nome: dict[str, dict],
    de: date | None,
    ate: date | None,
) -> tuple[list[dict], list[dict]]:
    """Da o proximo ok de VARIOS projetos de uma vez — (aplicados, recusados).

    Um projeto recusado (ja aprovado, ou aguardando outra pessoa) nao derruba os
    demais: a pessoa que confere em massa quer o que der para conferir, e a lista
    do que sobrou. Um unico commit no fim.
    """
    chaves = {nome: chave_projeto(nome) for nome in linhas_por_nome}
    vigentes = _oks_vigentes(db, list(set(chaves.values())))

    aplicados: list[dict] = []
    recusados: list[dict] = []
    for nome, linha in linhas_por_nome.items():
        chave = chaves[nome]
        try:
            nivel = _proximo_nivel(vigentes.get(chave, {}), usuario)
        except ConferenciaInvalida as erro:
            recusados.append({"projeto": nome, "motivo": erro.mensagem})
            continue
        db.add(_novo_ok(usuario, chave, nome, nivel, linha, de, ate))
        aplicados.append({"projeto": nome, "nivel": nivel, "rotulo": ROTULO_NIVEL[nivel]})

    if aplicados:
        db.commit()
    return aplicados, recusados


def revogar(db: Session, admin: models.Usuario, ok_id: int) -> models.FechamentoAprovado:
    """Desfaz um ok (so admin). Nao apaga: marca a revogacao e mantem o historico."""
    row = db.get(models.FechamentoAprovado, ok_id)
    if row is None:
        raise ConferenciaInvalida("Ok não encontrado", status=404)
    if row.revogado_em is not None:
        raise ConferenciaInvalida("Este ok já havia sido desfeito.")
    if row.nivel == NIVEL_CONFERENCIA:
        # a aprovacao se apoia na conferencia: desfazer a base primeiro deixaria
        # um 2o ok orfao, sem o 1o
        vigentes = _oks_vigentes(db, [row.chave_projeto]).get(row.chave_projeto, {})
        if NIVEL_APROVACAO in vigentes:
            raise ConferenciaInvalida("Desfaça primeiro o 2º ok (aprovação) deste projeto.")
    row.revogado_em = utcnow()
    row.revogado_por = admin.nome
    db.commit()
    db.refresh(row)
    return row


def projeto_aprovado(db: Session, nome: str) -> bool:
    """True se o projeto tem os DOIS ok vigentes — e portanto está travado."""
    chave = chave_projeto(nome)
    return NIVEL_APROVACAO in _oks_vigentes(db, [chave]).get(chave, {})


def nome_projeto_do_alvo(db: Session, alvo_tipo: str, alvo_id: int) -> str | None:
    """Projeto ATUAL de um título/NF-e, respeitando ajustes de 'mover' vigentes."""
    registro = db.get(models.Titulo if alvo_tipo == "titulo" else models.NFe, alvo_id)
    if registro is None:
        return None
    ultimo_mover = db.scalar(
        select(models.Ajuste)
        .where(
            models.Ajuste.alvo_tipo == alvo_tipo,
            models.Ajuste.alvo_id == alvo_id,
            models.Ajuste.campo == "codigo_projeto",
        )
        .order_by(models.Ajuste.id.desc())
        .limit(1)
    )
    try:
        codigo = int(ultimo_mover.valor_novo) if ultimo_mover else registro.codigo_projeto_omie
    except (TypeError, ValueError):
        codigo = registro.codigo_projeto_omie
    if not codigo:
        return None
    projeto = db.scalar(
        select(models.Projeto).where(
            models.Projeto.empresa_id == registro.empresa_id, models.Projeto.codigo_omie == codigo
        )
    )
    return (projeto.nome.strip() if projeto and projeto.nome else None) or f"Projeto {codigo}"


TRAVADO_MENSAGEM = (
    "Este projeto está conferido e aprovado (dois ok) — os números estão travados. "
    "Para editar, uma administradora precisa desfazer o 2º ok no detalhe do projeto."
)


def historico(db: Session, nome: str) -> list[models.FechamentoAprovado]:
    return list(
        db.scalars(
            select(models.FechamentoAprovado)
            .where(models.FechamentoAprovado.chave_projeto == chave_projeto(nome))
            .order_by(models.FechamentoAprovado.id.desc())
        ).all()
    )
