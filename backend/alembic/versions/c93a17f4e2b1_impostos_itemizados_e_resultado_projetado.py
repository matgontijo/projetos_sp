"""impostos itemizados por empresa e resultado projetado do projeto

Revision ID: c93a17f4e2b1
Revises: b7c41d09ea52
Create Date: 2026-07-31 09:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c93a17f4e2b1'
down_revision: Union[str, None] = 'b7c41d09ea52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# JSON portavel: JSONB no Postgres, JSON no SQLite
JSONVariant = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    # tabela de impostos da empresa: [{"nome": "CSLL", "aliquota": 1.2}, ...]
    op.add_column('empresa', sa.Column('impostos', JSONVariant, nullable=True))
    # 'nfe' = NF-e + as linhas acima | 'aliquota' = so as linhas (igual a planilha)
    op.add_column(
        'empresa',
        sa.Column('fonte_imposto', sa.String(length=10), nullable=False, server_default='nfe'),
    )
    # o lucro que a proposta projetava (substitui receita/custo previstos na tela)
    op.add_column('orcamento', sa.Column('resultado_previsto', sa.Numeric(precision=15, scale=2), nullable=True))
    # registros antigos: o projetado e o que a proposta prometia sobrar
    op.execute(
        "UPDATE orcamento SET resultado_previsto = receita_prevista - custo_previsto "
        "WHERE receita_prevista IS NOT NULL AND custo_previsto IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column('orcamento', 'resultado_previsto')
    op.drop_column('empresa', 'fonte_imposto')
    op.drop_column('empresa', 'impostos')
