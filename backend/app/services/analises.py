"""Analises derivadas do fechamento: clientes (curva ABC), vendedores, ciclo de caixa,
alertas e simulador de preco. Tudo reusa o motor de fechamento (so projetos BR)."""

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models
from .calculo import (
    SEM_PROJETO_NOME,
    _Contexto,
    _cancelado,
    _f,
    aliquota_da_empresa,
    chave_projeto,
    e_projeto_de_venda,
    fechar_projetos,
)

_STATUS_QUITADO = {"RECEBIDO", "PAGO", "LIQUIDADO", "CANCELADO"}


def _brl(valor: float) -> str:
    """R$ em pt-BR (ponto de milhar, virgula decimal) para textos de alerta."""
    inteiro, decimal = f"{abs(valor):,.2f}".split(".")
    return f"{'-' if valor < 0 else ''}R$ {inteiro.replace(',', '.')},{decimal}"


def _quitado(status: str) -> bool:
    return (status or "").strip().upper() in _STATUS_QUITADO


# ---------- Curva ABC de clientes ----------


def ranking_clientes(
    db: Session, empresa_ids: list[int], de: date | None, ate: date | None, fechamento: dict | None = None
) -> list[dict]:
    if fechamento is None:
        fechamento = fechar_projetos(db, empresa_ids, de, ate)
    por_cliente: dict[str, dict] = {}
    for p in fechamento["projetos"]:
        nome = p["cliente"] or "(cliente não identificado)"
        c = por_cliente.setdefault(
            nome, {"cliente": nome, "receita": 0.0, "resultado": 0.0, "qtd_projetos": 0, "projetos_prejuizo": 0}
        )
        c["receita"] += p["receita"]
        c["resultado"] += p["resultado"]
        c["qtd_projetos"] += 1
        if p["resultado"] < 0:
            c["projetos_prejuizo"] += 1

    linhas = sorted(por_cliente.values(), key=lambda c: c["receita"], reverse=True)
    receita_total = sum(c["receita"] for c in linhas) or 1.0
    acumulado = 0.0
    for c in linhas:
        acumulado += c["receita"]
        c["classe"] = "A" if acumulado <= receita_total * 0.8 else ("B" if acumulado <= receita_total * 0.95 else "C")
        c["margem"] = round(c["resultado"] / c["receita"], 6) if c["receita"] > 0 else 0.0
        c["receita"] = round(c["receita"], 2)
        c["resultado"] = round(c["resultado"], 2)
    return linhas


# ---------- Margem por vendedor ----------


def ranking_vendedores(
    db: Session, empresa_ids: list[int], de: date | None, ate: date | None, fechamento: dict | None = None
) -> list[dict]:
    if fechamento is None:
        fechamento = fechar_projetos(db, empresa_ids, de, ate)
    margem_por_chave = {chave_projeto(p["projeto"]): p["margem"] for p in fechamento["projetos"]}

    nomes = {
        (v.empresa_id, v.codigo_omie): v.nome
        for v in db.scalars(select(models.Vendedor).where(models.Vendedor.empresa_id.in_(empresa_ids))).all()
    }

    ctx = _Contexto(db, empresa_ids, de, ate)
    por_vendedor: dict[str, dict] = {}
    sem_vendedor = 0.0
    for t in ctx.titulos:
        if t.tipo != "receber" or _cancelado(t.status_titulo) or ctx.ajustes.excluido("titulo", t.id):
            continue
        nome_projeto = ctx.projeto_do_titulo(t)
        if not e_projeto_de_venda(nome_projeto):
            continue
        valor = _f(t.valor_documento)
        if not t.codigo_vendedor:
            sem_vendedor += valor
            continue
        nome = nomes.get((t.empresa_id, t.codigo_vendedor)) or f"Vendedor {t.codigo_vendedor}"
        v = por_vendedor.setdefault(nome, {"vendedor": nome, "receita": 0.0, "resultado_atribuido": 0.0, "projetos": set()})
        margem = margem_por_chave.get(chave_projeto(nome_projeto), 0.0)
        v["receita"] += valor
        v["resultado_atribuido"] += valor * margem
        v["projetos"].add(chave_projeto(nome_projeto))

    linhas = []
    for v in sorted(por_vendedor.values(), key=lambda x: x["receita"], reverse=True):
        linhas.append(
            {
                "vendedor": v["vendedor"],
                "receita": round(v["receita"], 2),
                "resultado_atribuido": round(v["resultado_atribuido"], 2),
                "margem_media": round(v["resultado_atribuido"] / v["receita"], 6) if v["receita"] > 0 else 0.0,
                "qtd_projetos": len(v["projetos"]),
            }
        )
    return {"vendedores": linhas, "receita_sem_vendedor": round(sem_vendedor, 2)}


# ---------- Ciclo de caixa ----------


def ciclo_de_caixa(db: Session, empresa_ids: list[int], de: date | None, ate: date | None) -> dict:
    ctx = _Contexto(db, empresa_ids, de, ate)
    hoje = date.today()
    por_projeto: dict[str, dict] = {}

    for t in ctx.titulos:
        if _cancelado(t.status_titulo) or ctx.ajustes.excluido("titulo", t.id) or _quitado(t.status_titulo):
            continue
        nome = ctx.projeto_do_titulo(t)
        if not e_projeto_de_venda(nome):
            continue
        chave = chave_projeto(nome)
        p = por_projeto.setdefault(
            chave,
            {"projeto": nome, "receber_aberto": 0.0, "receber_atrasado": 0.0, "pagar_aberto": 0.0,
             "pagar_atrasado": 0.0, "maior_atraso_dias": 0},
        )
        valor = _f(t.valor_documento)
        atrasado = t.data_vencimento is not None and t.data_vencimento < hoje
        if t.tipo == "receber":
            p["receber_aberto"] += valor
            if atrasado:
                p["receber_atrasado"] += valor
                p["maior_atraso_dias"] = max(p["maior_atraso_dias"], (hoje - t.data_vencimento).days)
        else:
            p["pagar_aberto"] += valor
            if atrasado:
                p["pagar_atrasado"] += valor

    linhas = sorted(por_projeto.values(), key=lambda p: p["receber_atrasado"], reverse=True)
    for p in linhas:
        for campo in ("receber_aberto", "receber_atrasado", "pagar_aberto", "pagar_atrasado"):
            p[campo] = round(p[campo], 2)
    totais = {
        "receber_aberto": round(sum(p["receber_aberto"] for p in linhas), 2),
        "receber_atrasado": round(sum(p["receber_atrasado"] for p in linhas), 2),
        "pagar_aberto": round(sum(p["pagar_aberto"] for p in linhas), 2),
        "pagar_atrasado": round(sum(p["pagar_atrasado"] for p in linhas), 2),
    }
    return {"projetos": linhas[:80], "totais": totais}


def fluxo_mensal(
    db: Session, empresa_ids: list[int], de: date | None, ate: date | None, projeto: str | None = None
) -> dict:
    """Fluxo de caixa por mês de VENCIMENTO dos títulos: quanto entra (receber),
    quanto sai (pagar) e o saldo acumulado — inclusive meses futuros, já que o
    vencimento pode cair depois do período de emissão consultado. A parte ainda
    em aberto vem separada: é ela que diz o que de fato falta entrar/sair."""
    ctx = _Contexto(db, empresa_ids, de, ate)
    meses: dict[str, dict] = {}
    nomes: set[str] = set()
    alvo = chave_projeto(projeto) if projeto else None

    for t in ctx.titulos:
        if _cancelado(t.status_titulo) or ctx.ajustes.excluido("titulo", t.id):
            continue
        nome = ctx.projeto_do_titulo(t)
        if not e_projeto_de_venda(nome):
            continue
        nomes.add(nome)
        if alvo and chave_projeto(nome) != alvo:
            continue
        dia = t.data_vencimento or t.data_emissao
        if dia is None:
            continue
        mes = dia.strftime("%Y-%m")
        m = meses.setdefault(
            mes, {"mes": mes, "entradas": 0.0, "saidas": 0.0, "aberto_entradas": 0.0, "aberto_saidas": 0.0}
        )
        valor = _f(t.valor_documento)
        aberto = not _quitado(t.status_titulo)
        if t.tipo == "receber":
            m["entradas"] += valor
            if aberto:
                m["aberto_entradas"] += valor
        else:
            m["saidas"] += valor
            if aberto:
                m["aberto_saidas"] += valor

    serie = sorted(meses.values(), key=lambda m: m["mes"])
    acumulado = 0.0
    for m in serie:
        m["saldo"] = round(m["entradas"] - m["saidas"], 2)
        acumulado += m["saldo"]
        m["acumulado"] = round(acumulado, 2)
        for campo in ("entradas", "saidas", "aberto_entradas", "aberto_saidas"):
            m[campo] = round(m[campo], 2)
    return {"meses": serie, "projetos": sorted(nomes)}


# ---------- Lançamentos sem projeto ----------


def sem_projeto(db: Session, empresa_ids: list[int], de: date | None, ate: date | None) -> dict:
    """O dinheiro que o fechamento NÃO enxerga: títulos e notas lançados na Omie
    sem projeto. É vazamento silencioso — o número do app parece completo e não
    é. Esta visão lista o que precisa ser classificado na Omie (e re-buscado)."""
    ctx = _Contexto(db, empresa_ids, de, ate)
    nomes_empresa = {
        e.id: e.nome for e in db.scalars(select(models.Empresa).where(models.Empresa.id.in_(empresa_ids))).all()
    }
    itens: list[dict] = []
    totais = {"receber": 0.0, "pagar": 0.0, "nfe": 0.0}

    for t in ctx.titulos:
        if _cancelado(t.status_titulo) or ctx.ajustes.excluido("titulo", t.id):
            continue
        if ctx.projeto_do_titulo(t) != SEM_PROJETO_NOME:
            continue
        valor = _f(t.valor_documento)
        totais[t.tipo] += valor
        itens.append({
            "origem": "titulo",
            "tipo": t.tipo,
            "empresa": nomes_empresa.get(t.empresa_id, ""),
            "data": t.data_emissao.isoformat() if t.data_emissao else None,
            "valor": round(valor, 2),
            "categoria": t.codigo_categoria,
            "documento": t.numero_documento or t.numero_documento_fiscal,
            # o que a pessoa precisa para achar o lançamento na Omie
            "codigo_omie": t.codigo_lancamento_omie,
        })

    for n in ctx.nfes:
        if n.cancelada or ctx.projeto_da_nfe(n) != SEM_PROJETO_NOME:
            continue
        valor = _f(n.v_nf)
        totais["nfe"] += valor
        itens.append({
            "origem": "nfe",
            "tipo": "nfe",
            "empresa": nomes_empresa.get(n.empresa_id, ""),
            "data": n.d_emi.isoformat() if n.d_emi else None,
            "valor": round(valor, 2),
            "categoria": "",
            "documento": f"NF {n.n_nf}",
            "codigo_omie": n.id_nf,
        })

    itens.sort(key=lambda i: i["valor"], reverse=True)
    return {
        "itens": itens[:200],
        "qtd": len(itens),
        "totais": {k: round(v, 2) for k, v in totais.items()},
    }


# ---------- Comissões sobre o recebido ----------

_STATUS_RECEBIDO = {"RECEBIDO", "LIQUIDADO"}


def comissoes(db: Session, empresa_ids: list[int], de: date | None, ate: date | None) -> dict:
    """Base de comissão por vendedor: títulos a receber QUITADOS (dinheiro que
    entrou), emitidos no período, de projetos de venda. O % vem do cadastro do
    vendedor e a comissão é % × recebido — a regra mais comum e auditável."""
    nomes = {
        (v.empresa_id, v.codigo_omie): v
        for v in db.scalars(select(models.Vendedor).where(models.Vendedor.empresa_id.in_(empresa_ids))).all()
    }
    ctx = _Contexto(db, empresa_ids, de, ate)
    por_vendedor: dict[str, dict] = {}
    sem_vendedor = 0.0

    for t in ctx.titulos:
        if t.tipo != "receber" or _cancelado(t.status_titulo) or ctx.ajustes.excluido("titulo", t.id):
            continue
        if (t.status_titulo or "").strip().upper() not in _STATUS_RECEBIDO:
            continue
        if not e_projeto_de_venda(ctx.projeto_do_titulo(t)):
            continue
        valor = _f(t.valor_documento)
        if not t.codigo_vendedor:
            sem_vendedor += valor
            continue
        vend = nomes.get((t.empresa_id, t.codigo_vendedor))
        nome = (vend.nome if vend else "") or f"Vendedor {t.codigo_vendedor}"
        pct = _f(vend.comissao_pct) if vend else 0.0
        v = por_vendedor.setdefault(nome, {"vendedor": nome, "recebido": 0.0, "pct": pct})
        v["recebido"] += valor
        v["pct"] = max(v["pct"], pct)  # mesmo nome em 2 empresas: vale o % cadastrado

    linhas = []
    for v in sorted(por_vendedor.values(), key=lambda x: x["recebido"], reverse=True):
        linhas.append({
            "vendedor": v["vendedor"],
            "recebido": round(v["recebido"], 2),
            "pct": round(v["pct"], 3),
            "comissao": round(v["recebido"] * v["pct"] / 100.0, 2),
        })
    return {
        "vendedores": linhas,
        "recebido_sem_vendedor": round(sem_vendedor, 2),
        "total_comissao": round(sum(l["comissao"] for l in linhas), 2),
    }


# ---------- Central de alertas ----------


def gerar_alertas(
    db: Session,
    empresa_ids: list[int],
    de: date | None,
    ate: date | None,
    margem_alvo: float,
    fechamento: dict | None = None,
    caixa: dict | None = None,
) -> list[dict]:
    """Lista priorizada do que precisa de atencao. margem_alvo em fracao (0.2 = 20%)."""
    alertas: list[dict] = []
    if fechamento is None:
        fechamento = fechar_projetos(db, empresa_ids, de, ate)
    projetos = fechamento["projetos"]

    prejuizo = [p for p in projetos if p["receita"] > 0 and p["resultado"] < 0]
    prejuizo.sort(key=lambda p: p["resultado"])
    for p in prejuizo[:5]:
        alertas.append(
            {
                "gravidade": "critica",
                "titulo": f"{p['projeto']} está no prejuízo",
                "detalhe": f"Resultado de {_brl(p['resultado'])} com receita de {_brl(p['receita'])}.",
                "projeto": p["projeto"],
            }
        )
    if len(prejuizo) > 5:
        alertas.append(
            {"gravidade": "critica", "titulo": f"+{len(prejuizo) - 5} outros projetos no prejuízo",
             "detalhe": "Ordene a lista de projetos por resultado para ver todos.", "projeto": None}
        )

    abaixo = [p for p in projetos if p["receita"] > 0 and 0 <= p["margem"] < margem_alvo]
    if abaixo:
        alertas.append(
            {
                "gravidade": "atencao",
                "titulo": f"{len(abaixo)} projetos abaixo da meta de {margem_alvo * 100:.0f}%",
                "detalhe": "Estão dando lucro, mas menos do que a meta definida.",
                "projeto": None,
            }
        )

    # projeto rendendo menos do que a proposta projetava
    orcamentos = {o.chave_projeto: o for o in db.scalars(select(models.Orcamento)).all()}
    for p in projetos:
        orc = orcamentos.get(chave_projeto(p["projeto"]))
        if not orc:
            continue
        if orc.resultado_previsto is not None and p["resultado"] < _f(orc.resultado_previsto):
            faltou = _f(orc.resultado_previsto) - p["resultado"]
            alertas.append(
                {
                    "gravidade": "atencao",
                    "titulo": f"{p['projeto']} rendeu menos do que o projetado",
                    "detalhe": (
                        f"Projetado {_brl(_f(orc.resultado_previsto))}, "
                        f"realizado {_brl(p['resultado'])} (−{_brl(faltou)})."
                    ),
                    "projeto": p["projeto"],
                }
            )
        elif orc.custo_previsto is not None and p["custo_total"] > _f(orc.custo_previsto) > 0:
            # orcamentos antigos (guardavam receita/custo previstos, nao o resultado)
            estouro = p["custo_total"] - _f(orc.custo_previsto)
            alertas.append(
                {
                    "gravidade": "atencao",
                    "titulo": f"{p['projeto']} estourou o orçamento de custo",
                    "detalhe": f"Previsto {_brl(_f(orc.custo_previsto))}, realizado {_brl(p['custo_total'])} (+{_brl(estouro)}).",
                    "projeto": p["projeto"],
                }
            )

    nao_classificado = fechamento["consolidado"].get("nao_classificado", 0)
    if nao_classificado > 0:
        alertas.append(
            {
                "gravidade": "atencao",
                "titulo": f"{_brl(nao_classificado)} em custos sem classificação",
                "detalhe": "Estão somados em 'Outros'. Classifique em Empresas → Classificar custos.",
                "projeto": None,
            }
        )

    if caixa is None:
        caixa = ciclo_de_caixa(db, empresa_ids, de, ate)
    if caixa["totais"]["receber_atrasado"] > 0:
        alertas.append(
            {
                "gravidade": "critica",
                "titulo": f"{_brl(caixa['totais']['receber_atrasado'])} a receber ATRASADOS",
                "detalhe": "Veja a aba Caixa em Análises para cobrar por projeto.",
                "projeto": None,
            }
        )

    ordem = {"critica": 0, "atencao": 1}
    alertas.sort(key=lambda a: ordem.get(a["gravidade"], 9))
    return alertas


# ---------- Simulador de preco / comparador de empresas ----------


def _nomes_dos_impostos(empresa: models.Empresa) -> str:
    itens = [i for i in (empresa.impostos or []) if isinstance(i, dict) and i.get("nome")]
    return ", ".join(str(i["nome"]) for i in itens)


def _aliquota_da_empresa(db: Session, empresa: models.Empresa) -> dict:
    """Fracao de imposto sobre a venda para simulacao, com a origem explicada."""
    cadastrada = aliquota_da_empresa(empresa)
    nomes = _nomes_dos_impostos(empresa)
    if empresa.regime == "simples":
        if cadastrada > 0:
            return {"aliquota": cadastrada, "origem": f"{cadastrada * 100:.2f}% do Simples configurado no cadastro"}
        return {"aliquota": 0.0, "origem": "Simples sem alíquota configurada — informe na tela Empresas"}
    if (empresa.fonte_imposto or "nfe") == "aliquota":
        # a empresa calcula tudo por aliquota (igual a planilha): a soma E o imposto
        detalhe = f" ({nomes})" if nomes else ""
        return {"aliquota": cadastrada, "origem": f"{cadastrada * 100:.2f}% cadastrados na empresa{detalhe}"}
    # Presumido/Real: taxa efetiva observada nos ultimos 12 meses de vendas BR
    hoje = date.today()
    fechamento = fechar_projetos(db, [empresa.id], hoje - timedelta(days=365), hoje)
    receita = fechamento["consolidado"]["receita"]
    imposto = fechamento["consolidado"]["imposto"]
    if receita > 0:
        return {
            "aliquota": imposto / receita,
            "origem": f"observado nos últimos 12 meses ({imposto / receita * 100:.1f}% da venda, já inclui os % cadastrados)",
        }
    return {"aliquota": cadastrada, "origem": "sem histórico — usando só os % cadastrados na empresa"}


def simular_preco(
    db: Session, custo: float, margem_alvo: float, preco: float | None = None, comissao: float = 0.0
) -> dict:
    """Para cada empresa ativa: preco minimo p/ atingir a margem, e comparacao.

    `comissao` e a fracao da VENDA paga ao vendedor (regra da cliente: comissao
    entra no custo do projeto) — reduz a margem como o imposto.
    """
    empresas = db.scalars(select(models.Empresa).where(models.Empresa.ativa)).all()
    cenarios = []
    for empresa in empresas:
        info = _aliquota_da_empresa(db, empresa)
        aliquota = min(info["aliquota"], 0.9)
        divisor = 1.0 - aliquota - comissao - margem_alvo
        preco_minimo = custo / divisor if divisor > 0 else None
        cenario = {
            "empresa_id": empresa.id,
            "empresa": empresa.nome,
            "regime": empresa.regime,
            "aliquota": round(aliquota, 6),
            "comissao": round(comissao, 6),
            "origem_aliquota": info["origem"],
            "preco_minimo": round(preco_minimo, 2) if preco_minimo else None,
        }
        if preco and preco > 0:
            imposto_estimado = preco * aliquota
            comissao_estimada = preco * comissao
            resultado = preco - custo - imposto_estimado - comissao_estimada
            cenario["com_preco_informado"] = {
                "imposto": round(imposto_estimado, 2),
                "comissao": round(comissao_estimada, 2),
                "resultado": round(resultado, 2),
                "margem": round(resultado / preco, 6),
            }
        cenarios.append(cenario)

    validos = [c for c in cenarios if c["preco_minimo"]]
    recomendada = min(validos, key=lambda c: c["preco_minimo"])["empresa"] if validos else None
    return {"custo": custo, "margem_alvo": margem_alvo, "cenarios": cenarios, "empresa_recomendada": recomendada}
