"""dupla conferencia (dois ok por projeto)

Revision ID: b7c41d09ea52
Revises: af2e3dffe6ea
Create Date: 2026-07-30 21:40:00.000000

Acrescenta o 2o ok:
- `usuario.pode_aprovar` — quem, no cadastro, pode dar a aprovacao (2o ok).
- `fechamento_aprovado.nivel` — 1 conferencia | 2 aprovacao. As linhas que ja
  existiam viram nivel 1 (conferencia), que e o que elas sempre foram.
- `usuario_id` — assinatura por id, e o que garante "o 2o ok e de OUTRA pessoa".
- `revogado_em` / `revogado_por` — desfazer sem apagar o historico.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c41d09ea52'
down_revision: Union[str, None] = 'af2e3dffe6ea'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('usuario') as batch:
        batch.add_column(
            sa.Column('pode_aprovar', sa.Boolean(), nullable=False, server_default=sa.false())
        )

    with op.batch_alter_table('fechamento_aprovado') as batch:
        batch.add_column(sa.Column('nivel', sa.Integer(), nullable=False, server_default='1'))
        batch.add_column(sa.Column('usuario_id', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('revogado_em', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('revogado_por', sa.String(length=80), nullable=False, server_default=''))
        batch.create_foreign_key(
            'fk_fechamento_aprovado_usuario', 'usuario', ['usuario_id'], ['id'], ondelete='SET NULL'
        )

    # Sem nenhum aprovador o 2o ok seria impossivel e a conferencia travaria no
    # 1o passo — as administradoras ja existentes comecam podendo aprovar.
    usuario = sa.table('usuario', sa.column('pode_aprovar', sa.Boolean), sa.column('papel', sa.String))
    op.execute(usuario.update().where(usuario.c.papel == op.inline_literal('admin')).values(pode_aprovar=True))


def downgrade() -> None:
    with op.batch_alter_table('fechamento_aprovado') as batch:
        batch.drop_constraint('fk_fechamento_aprovado_usuario', type_='foreignkey')
        batch.drop_column('revogado_por')
        batch.drop_column('revogado_em')
        batch.drop_column('usuario_id')
        batch.drop_column('nivel')

    with op.batch_alter_table('usuario') as batch:
        batch.drop_column('pode_aprovar')
