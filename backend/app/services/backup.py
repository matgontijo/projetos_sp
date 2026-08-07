"""Backup e restauração do TRABALHO HUMANO — o que uma nova sincronização não traz.

O Postgres free do Render expira em 30 dias e apaga tudo. Da Omie voltam
títulos, NF-e, projetos e clientes; NÃO voltam: contas de usuário, empresas
cadastradas, o mapeamento de categorias, os ajustes com motivo, os dois ok da
conferência, orçamentos, comentários, preferências e os cadastros de
precificação. É isso que este módulo salva num JSON e devolve depois.

Duas decisões de desenho:

1. CHAVES NATURAIS, nunca ids locais. `ajuste.alvo_id` aponta para o id
   autoincremento de um título/NF-e — que MUDA depois de re-sincronizar num
   banco novo. O backup grava a identidade estável (empresa + tipo + código de
   lançamento da Omie; empresa + id da NF) e a restauração resolve para os ids
   novos. Ajuste cujo alvo ainda não foi sincronizado fica pendente e é
   informado — restaurar de novo DEPOIS do sync completa o serviço (idempotente).

2. A restauração NUNCA sobrescreve o que já existe — só preenche o que falta.
   Regra única, previsível e segura para rodar quantas vezes for preciso.

Atenção às credenciais Omie: elas viajam CRIPTOGRAFADAS (Fernet). Restaurar em
um servidor com APP_ENCRYPTION_KEY diferente deixa as credenciais ilegíveis —
o arquivo carrega uma impressão digital da chave e a restauração avisa quando
não bate (basta recadastrar as chaves das empresas na tela).
"""

import hashlib
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect as sa_inspect, select
from sqlalchemy.orm import Session

from .. import models
from ..config import settings
from ..crypto import _fernet

VERSAO = 1


# ---------------------------------------------------------------- utilidades


def _digital_da_chave() -> str:
    """Impressão digital (não reversível) da chave de criptografia em uso."""
    try:
        chave = _fernet()._signing_key + _fernet()._encryption_key
    except Exception:
        chave = settings.app_encryption_key.encode()
    return hashlib.sha256(chave).hexdigest()[:12]


def _valor(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    return v


def _linha(obj: Any, excluir: set[str] = frozenset()) -> dict:
    """Todas as colunas do modelo (menos `id` e as pedidas), já serializáveis."""
    cols = sa_inspect(obj.__class__).columns
    return {
        c.key: _valor(getattr(obj, c.key))
        for c in cols
        if c.key != "id" and c.key not in excluir
    }


def _aplicar(obj: Any, dados: dict, excluir: set[str] = frozenset()) -> None:
    """Preenche um modelo a partir do dict, convertendo datas pelos tipos das colunas."""
    cols = {c.key: c for c in sa_inspect(obj.__class__).columns}
    for chave, valor in dados.items():
        col = cols.get(chave)
        if col is None or chave == "id" or chave in excluir:
            continue
        tipo = type(col.type).__name__
        if valor is not None and tipo == "DateTime":
            valor = datetime.fromisoformat(valor)
        elif valor is not None and tipo == "Date":
            valor = date.fromisoformat(valor)
        setattr(obj, chave, valor)


def _chave_empresa(e: models.Empresa) -> dict:
    """Identidade estável da empresa: CNPJ quando há; senão o nome."""
    return {"cnpj": (e.cnpj or "").strip(), "nome": e.nome}


def _resolver_empresa(db: Session, ek: dict | None) -> models.Empresa | None:
    if not ek:
        return None
    if ek.get("cnpj"):
        e = db.scalar(select(models.Empresa).where(models.Empresa.cnpj == ek["cnpj"]))
        if e:
            return e
    return db.scalar(select(models.Empresa).where(models.Empresa.nome == ek.get("nome", "")))


# ------------------------------------------------------------------- exportar


def exportar(db: Session) -> dict:
    """Tudo que é trabalho humano, num dict pronto para virar arquivo JSON."""
    empresas = db.scalars(select(models.Empresa)).all()
    usuarios = db.scalars(select(models.Usuario)).all()
    email_por_id = {u.id: u.email for u in usuarios}
    ek_por_id = {e.id: _chave_empresa(e) for e in empresas}

    # alvos dos ajustes -> identidade estável na Omie
    titulos = {
        t.id: {"tipo": t.tipo, "codigo_lancamento_omie": t.codigo_lancamento_omie, "empresa": ek_por_id.get(t.empresa_id)}
        for t in db.scalars(select(models.Titulo)).all()
    }
    nfes = {
        n.id: {"id_nf": n.id_nf, "empresa": ek_por_id.get(n.empresa_id)}
        for n in db.scalars(select(models.NFe)).all()
    }

    def ajuste_out(a: models.Ajuste) -> dict | None:
        alvo = titulos.get(a.alvo_id) if a.alvo_tipo == "titulo" else nfes.get(a.alvo_id)
        if alvo is None:
            return None  # alvo sumiu do cache local; sem identidade não há como restaurar
        return {**_linha(a, excluir={"empresa_id", "alvo_id"}), "empresa": ek_por_id.get(a.empresa_id), "alvo": alvo}

    produtos = db.scalars(select(models.Produto)).all()
    nome_produto_por_id = {p.id: p.nome for p in produtos}

    def orcamento_venda_out(o: models.OrcamentoVenda) -> dict:
        itens = db.scalars(
            select(models.ItemOrcamento).where(models.ItemOrcamento.orcamento_id == o.id)
        ).all()
        return {
            **_linha(o, excluir={"empresa_faturamento_id", "criado_por_id"}),
            "empresa_faturamento": ek_por_id.get(o.empresa_faturamento_id),
            "criado_por_email": email_por_id.get(o.criado_por_id),
            "itens": [
                {**_linha(i, excluir={"orcamento_id", "produto_id"}), "produto_nome": nome_produto_por_id.get(i.produto_id)}
                for i in itens
            ],
        }

    return {
        "formato": "custeio-backup",
        "versao": VERSAO,
        "gerado_em": datetime.now().astimezone().isoformat(),
        "digital_chave_criptografia": _digital_da_chave(),
        "tabelas": {
            "usuarios": [_linha(u) for u in usuarios],
            "empresas": [_linha(e) for e in empresas],
            "categorias_grupo": [
                {**_linha(c, excluir={"empresa_id"}), "empresa": ek_por_id.get(c.empresa_id)}
                for c in db.scalars(select(models.CategoriaGrupo)).all()
            ],
            "ajustes": [a for a in (ajuste_out(x) for x in db.scalars(select(models.Ajuste)).all()) if a],
            "fechamentos_aprovados": [
                {**_linha(f, excluir={"usuario_id"}), "usuario_email": email_por_id.get(f.usuario_id)}
                for f in db.scalars(select(models.FechamentoAprovado)).all()
            ],
            "orcamentos": [_linha(o) for o in db.scalars(select(models.Orcamento)).all()],
            "comentarios": [_linha(c) for c in db.scalars(select(models.Comentario)).all()],
            "configuracoes": [_linha(c) for c in db.scalars(select(models.Configuracao)).all()],
            "simples_periodos": [
                {**_linha(s, excluir={"empresa_id"}), "empresa": ek_por_id.get(s.empresa_id)}
                for s in db.scalars(select(models.SimplesPeriodo)).all()
            ],
            "produtos": [_linha(p) for p in produtos],
            "tabela_labels": [_linha(t) for t in db.scalars(select(models.TabelaLabel)).all()],
            "tabela_aliquotas": [_linha(t) for t in db.scalars(select(models.TabelaAliquota)).all()],
            "componentes_custo": [_linha(c) for c in db.scalars(select(models.ComponenteCusto)).all()],
            "parametros_precificacao": [
                {**_linha(p, excluir={"empresa_id"}), "empresa": ek_por_id.get(p.empresa_id)}
                for p in db.scalars(select(models.ParametroPrecificacao)).all()
            ],
            "orcamentos_venda": [orcamento_venda_out(o) for o in db.scalars(select(models.OrcamentoVenda)).all()],
        },
    }


# ------------------------------------------------------------------ restaurar


class _Contagem:
    def __init__(self) -> None:
        self.criados: dict[str, int] = {}
        self.pulados: dict[str, int] = {}
        self.pendentes: dict[str, int] = {}

    def criado(self, tabela: str) -> None:
        self.criados[tabela] = self.criados.get(tabela, 0) + 1

    def pulado(self, tabela: str) -> None:
        self.pulados[tabela] = self.pulados.get(tabela, 0) + 1

    def pendente(self, tabela: str) -> None:
        self.pendentes[tabela] = self.pendentes.get(tabela, 0) + 1


def restaurar(db: Session, dados: dict) -> dict:
    """Devolve o backup ao banco. Nunca sobrescreve; só cria o que falta.

    Idempotente: rodar duas vezes não duplica nada. Ajustes cujo título/NF-e
    ainda não existe (banco pré-sincronização) ficam pendentes — rode o sync e
    restaure de novo.
    """
    if dados.get("formato") != "custeio-backup":
        raise ValueError("Este arquivo não é um backup do app")
    if int(dados.get("versao", 0)) > VERSAO:
        raise ValueError("Backup de uma versão mais nova do app — atualize o app antes de restaurar")

    t = dados.get("tabelas", {})
    c = _Contagem()

    def existe(stmt) -> bool:
        return db.scalar(stmt) is not None

    # --- usuários (por e-mail) ---
    for u in t.get("usuarios", []):
        if existe(select(models.Usuario).where(models.Usuario.email == u.get("email", ""))):
            c.pulado("usuarios")
            continue
        novo = models.Usuario()
        _aplicar(novo, u)
        db.add(novo)
        c.criado("usuarios")
    db.flush()

    # --- empresas (por CNPJ, senão nome) ---
    for e in t.get("empresas", []):
        if _resolver_empresa(db, {"cnpj": e.get("cnpj", ""), "nome": e.get("nome", "")}):
            c.pulado("empresas")
            continue
        nova = models.Empresa()
        _aplicar(nova, e)
        db.add(nova)
        c.criado("empresas")
    db.flush()

    emails = {u.email: u.id for u in db.scalars(select(models.Usuario)).all()}

    # --- mapeamento de categorias ---
    for cg in t.get("categorias_grupo", []):
        empresa = _resolver_empresa(db, cg.get("empresa"))
        if empresa is None:
            c.pendente("categorias_grupo")
            continue
        if existe(
            select(models.CategoriaGrupo).where(
                models.CategoriaGrupo.empresa_id == empresa.id,
                models.CategoriaGrupo.codigo_categoria == cg.get("codigo_categoria", ""),
            )
        ):
            c.pulado("categorias_grupo")
            continue
        novo = models.CategoriaGrupo(empresa_id=empresa.id)
        _aplicar(novo, cg, excluir={"empresa"})
        db.add(novo)
        c.criado("categorias_grupo")

    # --- ajustes (alvo por identidade Omie; pendente se ainda nao sincronizado) ---
    for a in t.get("ajustes", []):
        empresa = _resolver_empresa(db, a.get("empresa"))
        alvo = a.get("alvo") or {}
        alvo_id = None
        if empresa is not None:
            if a.get("alvo_tipo") == "titulo":
                alvo_id = db.scalar(
                    select(models.Titulo.id).where(
                        models.Titulo.empresa_id == empresa.id,
                        models.Titulo.tipo == alvo.get("tipo", ""),
                        models.Titulo.codigo_lancamento_omie == int(alvo.get("codigo_lancamento_omie") or 0),
                    )
                )
            else:
                alvo_id = db.scalar(
                    select(models.NFe.id).where(
                        models.NFe.empresa_id == empresa.id,
                        models.NFe.id_nf == int(alvo.get("id_nf") or 0),
                    )
                )
        if alvo_id is None:
            c.pendente("ajustes")
            continue
        if existe(
            select(models.Ajuste).where(
                models.Ajuste.empresa_id == empresa.id,
                models.Ajuste.alvo_tipo == a.get("alvo_tipo", ""),
                models.Ajuste.alvo_id == alvo_id,
                models.Ajuste.campo == a.get("campo", ""),
                models.Ajuste.criado_em == datetime.fromisoformat(a["criado_em"]) if a.get("criado_em") else True,
            )
        ):
            c.pulado("ajustes")
            continue
        novo = models.Ajuste(empresa_id=empresa.id, alvo_id=alvo_id)
        _aplicar(novo, a, excluir={"empresa", "alvo"})
        db.add(novo)
        c.criado("ajustes")

    # --- conferências (identidade: projeto + nível + quem + quando) ---
    for f in t.get("fechamentos_aprovados", []):
        criado_em = datetime.fromisoformat(f["criado_em"]) if f.get("criado_em") else None
        if existe(
            select(models.FechamentoAprovado).where(
                models.FechamentoAprovado.chave_projeto == f.get("chave_projeto", ""),
                models.FechamentoAprovado.nivel == int(f.get("nivel") or 1),
                models.FechamentoAprovado.usuario == f.get("usuario", ""),
                models.FechamentoAprovado.criado_em == criado_em,
            )
        ):
            c.pulado("fechamentos_aprovados")
            continue
        novo = models.FechamentoAprovado(usuario_id=emails.get(f.get("usuario_email") or ""))
        _aplicar(novo, f, excluir={"usuario_email"})
        db.add(novo)
        c.criado("fechamentos_aprovados")

    # --- tabelas com chave natural direta ---
    simples = [
        ("orcamentos", models.Orcamento, lambda o: select(models.Orcamento).where(models.Orcamento.chave_projeto == o.get("chave_projeto", "")), frozenset()),
        ("comentarios", models.Comentario, lambda o: select(models.Comentario).where(
            models.Comentario.chave_projeto == o.get("chave_projeto", ""),
            models.Comentario.usuario == o.get("usuario", ""),
            models.Comentario.texto == o.get("texto", ""),
        ), frozenset()),
        ("configuracoes", models.Configuracao, lambda o: select(models.Configuracao).where(models.Configuracao.chave == o.get("chave", "")), frozenset()),
        ("produtos", models.Produto, lambda o: select(models.Produto).where(models.Produto.nome == o.get("nome", "")), frozenset()),
        ("tabela_labels", models.TabelaLabel, lambda o: select(models.TabelaLabel).where(
            models.TabelaLabel.acabamento == o.get("acabamento", ""),
            models.TabelaLabel.quantidade_min == int(o.get("quantidade_min") or 0),
        ), frozenset()),
        ("tabela_aliquotas", models.TabelaAliquota, lambda o: select(models.TabelaAliquota).where(models.TabelaAliquota.local == o.get("local", "")), frozenset()),
        ("componentes_custo", models.ComponenteCusto, lambda o: select(models.ComponenteCusto).where(models.ComponenteCusto.nome == o.get("nome", "")), frozenset()),
    ]
    for tabela, modelo, stmt, excluir in simples:
        for o in t.get(tabela, []):
            if existe(stmt(o)):
                c.pulado(tabela)
                continue
            novo = modelo()
            _aplicar(novo, o, excluir=excluir)
            db.add(novo)
            c.criado(tabela)

    # --- por empresa: simples legado e parametros de precificacao ---
    for tabela, modelo, campos in (
        ("simples_periodos", models.SimplesPeriodo, ("competencia",)),
        ("parametros_precificacao", models.ParametroPrecificacao, ()),
    ):
        for o in t.get(tabela, []):
            empresa = _resolver_empresa(db, o.get("empresa"))
            if o.get("empresa") and empresa is None:
                c.pendente(tabela)
                continue
            filtro = [getattr(modelo, "empresa_id") == (empresa.id if empresa else None)]
            for campo in campos:
                filtro.append(getattr(modelo, campo) == o.get(campo))
            if existe(select(modelo).where(*filtro)):
                c.pulado(tabela)
                continue
            novo = modelo(empresa_id=empresa.id if empresa else None)
            _aplicar(novo, o, excluir={"empresa"})
            db.add(novo)
            c.criado(tabela)

    # --- orcamentos de venda (com itens) ---
    produtos_por_nome = {p.nome: p.id for p in db.scalars(select(models.Produto)).all()}
    for o in t.get("orcamentos_venda", []):
        criado_em = datetime.fromisoformat(o["criado_em"]) if o.get("criado_em") else None
        if existe(
            select(models.OrcamentoVenda).where(
                models.OrcamentoVenda.numero == o.get("numero", ""),
                models.OrcamentoVenda.cliente == o.get("cliente", ""),
                models.OrcamentoVenda.criado_em == criado_em,
            )
        ):
            c.pulado("orcamentos_venda")
            continue
        empresa = _resolver_empresa(db, o.get("empresa_faturamento"))
        novo = models.OrcamentoVenda(
            empresa_faturamento_id=empresa.id if empresa else None,
            criado_por_id=emails.get(o.get("criado_por_email") or ""),
        )
        _aplicar(novo, o, excluir={"empresa_faturamento", "criado_por_email", "itens"})
        db.add(novo)
        db.flush()
        for item in o.get("itens", []):
            novo_item = models.ItemOrcamento(
                orcamento_id=novo.id,
                produto_id=produtos_por_nome.get(item.get("produto_nome") or ""),
            )
            _aplicar(novo_item, item, excluir={"produto_nome"})
            db.add(novo_item)
        c.criado("orcamentos_venda")

    db.commit()

    digital_local = _digital_da_chave()
    digital_backup = dados.get("digital_chave_criptografia", "")
    return {
        "criados": c.criados,
        "pulados": c.pulados,
        "pendentes": c.pendentes,
        "aviso_chave": (
            "A chave de criptografia deste servidor é DIFERENTE da que gerou o backup — "
            "as credenciais Omie restauradas não vão abrir. Recadastre as chaves das "
            "empresas na tela Empresas."
            if digital_backup and digital_backup != digital_local
            else ""
        ),
    }
