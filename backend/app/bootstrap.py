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
_COLUNAS_ADITIVAS = [
    ("empresa", "aliquota_extra", "NUMERIC(6,3)", "0"),
    ("titulo", "codigo_vendedor", "BIGINT", None),
]


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
            conn.execute(text(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}"))
            if preencher is not None:
                conn.execute(text(f"UPDATE {tabela} SET {coluna} = {preencher} WHERE {coluna} IS NULL"))
