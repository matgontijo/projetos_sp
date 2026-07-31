"""Auto-reparo aditivo do banco no startup.

`create_all` cria tabelas que faltam, mas NUNCA adiciona colunas novas a tabelas
existentes — em producao (Render) nao rodamos Alembic, entao colunas adicionadas
ao modelo quebrariam todas as consultas. Este modulo garante as colunas
aditivas conhecidas com ALTER TABLE idempotente (SQLite e PostgreSQL).
"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# (tabela, coluna, DDL do tipo, valor para preencher linhas antigas ou None)
# O tipo pode ser um dict por dialeto quando o DDL nao e portavel (ex.: data com
# fuso: TIMESTAMPTZ no Postgres, DATETIME no SQLite).
_COLUNAS_ADITIVAS = [
    ("empresa", "aliquota_extra", "NUMERIC(6,3)", "0"),
    # Impostos itemizados por empresa (PIS, COFINS, ICMS, CSLL, IRPJ...)
    ("empresa", "impostos", {"postgresql": "JSONB", "sqlite": "JSON"}, None),
    ("empresa", "fonte_imposto", "VARCHAR(10)", "'nfe'"),
    ("orcamento", "resultado_previsto", "NUMERIC(15,2)", None),
    ("titulo", "codigo_vendedor", "BIGINT", None),
    ("orcamento_venda", "cliente_cnpj", "VARCHAR(20)", "''"),
    # Dupla conferencia (dois ok por projeto). As administradoras ja existentes
    # comecam podendo aprovar — sem nenhum aprovador, o 2o ok ficaria impossivel.
    ("usuario", "pode_aprovar", "BOOLEAN", "(papel = 'admin')"),
    ("fechamento_aprovado", "nivel", "INTEGER", "1"),  # linhas antigas = 1o ok
    ("fechamento_aprovado", "usuario_id", "BIGINT", None),
    ("fechamento_aprovado", "revogado_em", {"postgresql": "TIMESTAMPTZ", "sqlite": "DATETIME"}, None),
    ("fechamento_aprovado", "revogado_por", "VARCHAR(80)", "''"),
]


def _ddl_do_tipo(tipo, dialeto: str) -> str:
    if isinstance(tipo, dict):
        return tipo.get(dialeto) or tipo["sqlite"]
    return tipo


def garantir_colunas(engine: Engine) -> None:
    inspector = inspect(engine)
    tabelas = set(inspector.get_table_names())
    for tabela, coluna, tipo, preencher in _COLUNAS_ADITIVAS:
        if tabela not in tabelas:
            continue  # create_all cuida de tabelas novas
        colunas = {c["name"] for c in inspector.get_columns(tabela)}
        if coluna in colunas:
            continue
        logger.warning("Auto-reparo: adicionando coluna %s.%s", tabela, coluna)
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {_ddl_do_tipo(tipo, engine.dialect.name)}"))
            if preencher is not None:
                conn.execute(text(f"UPDATE {tabela} SET {coluna} = {preencher} WHERE {coluna} IS NULL"))
