"""Dados iniciais do modulo de precificacao (extraidos da planilha BR26_266).

Idempotente: so insere se a tabela estiver vazia. Roda no startup (como o
bootstrap de colunas), entao em producao os cadastros ja nascem prontos e
editaveis pela tela.
"""

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from .. import models

# aba TABELAS da planilha: local de faturamento -> aliquota
_ALIQUOTAS = [
    ("Simples Nacional (todos estados)", 0.105, "simples", 1),
    ("São Paulo (revenda)", 0.07, "nota", 2),
    ("São Paulo (venda com ICMS)", 0.25, "nota", 3),
    ("Minas Gerais", 0.185, "nota", 10),
    ("Paraná", 0.185, "nota", 11),
    ("Rio de Janeiro", 0.185, "nota", 12),
    ("Rio Grande do Sul", 0.185, "nota", 13),
    ("Santa Catarina", 0.1905, "nota", 14),
    ("Demais estados", 0.135, "nota", 20),
    ("Exportação", 0.035, None, 30),
]

# aba CALCULADORA LABEL: faixa de qtd -> preco unitario (acabamento "liso" base).
# Metalizado/transparente entram como fator sobre o liso via _FATOR_ACABAMENTO.
_LABEL_LISO = [
    (100, 3.00), (200, 2.50), (300, 2.45), (400, 2.40), (500, 2.35), (600, 2.30),
    (700, 2.25), (800, 2.20), (900, 2.15), (1000, 2.00), (1200, 1.80), (1500, 1.70),
    (1800, 1.50), (2000, 1.40), (2500, 1.16), (3000, 1.00), (3500, 0.90), (4000, 0.85),
    (4500, 0.80), (5000, 0.75), (6000, 0.72), (7000, 0.70), (8000, 0.68), (9000, 0.65),
    (10000, 0.62), (11000, 0.61), (12000, 0.60), (13000, 0.59), (14000, 0.58), (15000, 0.57),
    (18000, 0.56), (20000, 0.55), (25000, 0.53), (30000, 0.52), (35000, 0.51), (40000, 0.50),
    (45000, 0.46), (50000, 0.45), (60000, 0.40), (70000, 0.39), (80000, 0.38), (90000, 0.37),
    (100000, 0.36), (150000, 0.35), (200000, 0.34),
]
_FATOR_ACABAMENTO = {"liso": 1.0, "casca": 1.0, "transparente": 1.15, "metalizado": 1.35}

# aba TABELAS: montagem por chapa (rende N labels por chapa) por produto
_PRODUTOS = [
    ("Copo 250ml", "copo", 4, 0.0),
    ("Copo 400ml", "copo", 3, 0.0),
    ("Copo 550ml", "copo", 3, 0.0),
    ("Copo 700ml", "copo", 3, 0.0),
    ("Balde 2,3L", "balde", 2, 0.0),
    ("Balde 3,2L", "balde", 2, 0.0),
    ("Balde 4L", "balde", 2, 0.0),
    ("Tirante 120x20mm", "tirante", 1, 2.266666666666667),
]

_PARAMETROS = dict(
    margem_padrao=0.15, comissao_padrao=0.025, custo_fixo_padrao=0.0,
    juros_mes=0.025, prazo_padrao=30, perda_label=0.05,
)


def semear(db: Session) -> None:
    """Insere os dados iniciais numa sessao existente (idempotente por tabela)."""
    if not db.scalar(select(models.TabelaAliquota.id)):
        for local, aliq, regime, ordem in _ALIQUOTAS:
            db.add(models.TabelaAliquota(local=local, aliquota=aliq, regime=regime, ordem=ordem))
    if not db.scalar(select(models.TabelaLabel.id)):
        for acab, fator in _FATOR_ACABAMENTO.items():
            for qmin, preco in _LABEL_LISO:
                db.add(models.TabelaLabel(acabamento=acab, quantidade_min=qmin, preco_unitario=round(preco * fator, 4)))
    if not db.scalar(select(models.Produto.id)):
        for nome, cat, chapa, custo in _PRODUTOS:
            db.add(models.Produto(nome=nome, categoria=cat, montagem_por_chapa=chapa, custo_base=custo))
    if not db.scalar(select(models.ParametroPrecificacao.id)):
        db.add(models.ParametroPrecificacao(empresa_id=None, **_PARAMETROS))
    db.commit()


def garantir_seeds(engine) -> None:
    if "tabela_aliquota" not in set(inspect(engine).get_table_names()):
        return  # create_all ainda nao rodou (nunca acontece: chamado depois dele)
    with Session(engine) as db:
        semear(db)
