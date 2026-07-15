from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

JSONVariant = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Empresa(Base):
    __tablename__ = "empresa"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    cnpj: Mapped[str] = mapped_column(String(20), default="")
    # Credenciais Omie criptografadas (Fernet) — nunca expostas pela API
    app_key_enc: Mapped[str] = mapped_column(Text)
    app_secret_enc: Mapped[str] = mapped_column(Text)
    # 'nota' (Presumido/Real: impostos lidos das NF-e) | 'simples' (aplica aliquota efetiva)
    regime: Mapped[str] = mapped_column(String(10), default="nota")
    simples_anexo: Mapped[str | None] = mapped_column(String(3), nullable=True)
    # % ADICIONAL sobre a receita para impostos que nao vem na NF-e
    # (ex.: IRPJ/CSLL do Lucro Presumido ~3,4%). Em pontos percentuais (3.4 = 3,4%).
    aliquota_extra: Mapped[float] = mapped_column(Numeric(6, 3), default=0)
    ativa: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    atualizado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    projetos: Mapped[list["Projeto"]] = relationship(cascade="all, delete-orphan", back_populates="empresa")
    titulos: Mapped[list["Titulo"]] = relationship(cascade="all, delete-orphan", back_populates="empresa")
    nfes: Mapped[list["NFe"]] = relationship(cascade="all, delete-orphan", back_populates="empresa")


class Projeto(Base):
    __tablename__ = "projeto"
    __table_args__ = (UniqueConstraint("empresa_id", "codigo_omie", name="uq_projeto_empresa_codigo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    codigo_omie: Mapped[int] = mapped_column(BigInteger)
    cod_int: Mapped[str] = mapped_column(String(40), default="")
    # Numero legivel do projeto (ex.: BR26_055) — campo `nome` do ListarProjetos
    nome: Mapped[str] = mapped_column(String(120), default="")
    inativo: Mapped[bool] = mapped_column(Boolean, default=False)

    empresa: Mapped[Empresa] = relationship(back_populates="projetos")


class Titulo(Base):
    """Cache dos titulos de Contas a Receber e Contas a Pagar."""

    __tablename__ = "titulo"
    __table_args__ = (
        UniqueConstraint("empresa_id", "tipo", "codigo_lancamento_omie", name="uq_titulo_empresa_tipo_cod"),
        Index("ix_titulo_empresa_projeto", "empresa_id", "codigo_projeto_omie"),
        Index("ix_titulo_empresa_emissao", "empresa_id", "data_emissao"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    tipo: Mapped[str] = mapped_column(String(8))  # 'receber' | 'pagar'
    codigo_lancamento_omie: Mapped[int] = mapped_column(BigInteger)
    codigo_projeto_omie: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    valor_documento: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    codigo_categoria: Mapped[str] = mapped_column(String(40), default="")
    categorias_rateio: Mapped[list | None] = mapped_column(JSONVariant, nullable=True)
    data_emissao: Mapped[date | None] = mapped_column(Date, nullable=True)
    data_vencimento: Mapped[date | None] = mapped_column(Date, nullable=True)
    status_titulo: Mapped[str] = mapped_column(String(30), default="")
    codigo_cliente_fornecedor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    codigo_vendedor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    numero_documento: Mapped[str] = mapped_column(String(60), default="")
    numero_documento_fiscal: Mapped[str] = mapped_column(String(60), default="")
    raw: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    empresa: Mapped[Empresa] = relationship(back_populates="titulos")


class NFe(Base):
    """Cache das NF-e de produto emitidas (impostos destacados por nota)."""

    __tablename__ = "nfe"
    __table_args__ = (
        UniqueConstraint("empresa_id", "id_nf", name="uq_nfe_empresa_idnf"),
        Index("ix_nfe_empresa_projeto", "empresa_id", "codigo_projeto_omie"),
        Index("ix_nfe_empresa_emissao", "empresa_id", "d_emi"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    id_nf: Mapped[int] = mapped_column(BigInteger)  # compl.nIdNF
    n_nf: Mapped[str] = mapped_column(String(15), default="")
    serie: Mapped[str] = mapped_column(String(5), default="")
    chave: Mapped[str] = mapped_column(String(50), default="")
    d_emi: Mapped[date | None] = mapped_column(Date, nullable=True)
    tp_nf: Mapped[str] = mapped_column(String(1), default="1")  # 1 = saida
    cancelada: Mapped[bool] = mapped_column(Boolean, default=False)
    id_pedido: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # Projeto efetivo: pedido.nIdProjeto, com fallback em titulos[].nCodProjeto
    codigo_projeto_omie: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    dest_nome: Mapped[str] = mapped_column(String(120), default="")
    dest_cnpj: Mapped[str] = mapped_column(String(20), default="")
    v_nf: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_prod: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_icms: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_st: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_fcp: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_fcpst: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_ipi: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_pis: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_cofins: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    # Reforma tributaria — somados quando a Omie passar a retornar
    v_ibs: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    v_cbs: Mapped[float] = mapped_column(Numeric(15, 2), default=0)
    titulos: Mapped[list | None] = mapped_column(JSONVariant, nullable=True)
    raw: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    empresa: Mapped[Empresa] = relationship(back_populates="nfes")


class Cliente(Base):
    __tablename__ = "cliente"
    __table_args__ = (UniqueConstraint("empresa_id", "codigo_cliente_omie", name="uq_cliente_empresa_codigo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    codigo_cliente_omie: Mapped[int] = mapped_column(BigInteger)
    razao_social: Mapped[str] = mapped_column(String(150), default="")
    nome_fantasia: Mapped[str] = mapped_column(String(150), default="")
    cnpj_cpf: Mapped[str] = mapped_column(String(20), default="")


class CategoriaGrupo(Base):
    """Mapeamento categoria Omie -> grupo de custo, configuravel por empresa.

    grupo: 'producao' | 'frete' | 'imposto' | 'outros' | 'ignorar' | None (nao classificada)
    """

    __tablename__ = "categoria_grupo"
    __table_args__ = (UniqueConstraint("empresa_id", "codigo_categoria", name="uq_catgrupo_empresa_cat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    codigo_categoria: Mapped[str] = mapped_column(String(40))
    descricao: Mapped[str] = mapped_column(String(150), default="")
    grupo: Mapped[str | None] = mapped_column(String(12), nullable=True)
    atualizado_por: Mapped[str] = mapped_column(String(80), default="")
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Ajuste(Base):
    """Ajuste manual auditavel, aplicado por cima do cache (o cache nunca e alterado)."""

    __tablename__ = "ajuste"

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    alvo_tipo: Mapped[str] = mapped_column(String(10))  # 'titulo' | 'nfe'
    alvo_id: Mapped[int] = mapped_column(BigInteger)  # id local do titulo/nfe
    # campo: titulo -> 'grupo' | 'codigo_projeto' | 'excluir'; nfe -> 'valor_imposto' | 'codigo_projeto' | 'excluir'
    campo: Mapped[str] = mapped_column(String(30))
    valor_anterior: Mapped[str] = mapped_column(Text, default="")
    valor_novo: Mapped[str] = mapped_column(Text, default="")
    motivo: Mapped[str] = mapped_column(Text, default="")
    usuario: Mapped[str] = mapped_column(String(80), default="")
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SimplesPeriodo(Base):
    """RBT12/aliquota efetiva do Simples por competencia (usado so se empresa.regime='simples')."""

    __tablename__ = "simples_periodo"
    __table_args__ = (UniqueConstraint("empresa_id", "competencia", name="uq_simples_empresa_comp"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    competencia: Mapped[str] = mapped_column(String(7))  # 'YYYY-MM'
    rbt12: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)


class Vendedor(Base):
    __tablename__ = "vendedor"
    __table_args__ = (UniqueConstraint("empresa_id", "codigo_omie", name="uq_vendedor_empresa_codigo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    codigo_omie: Mapped[int] = mapped_column(BigInteger)
    nome: Mapped[str] = mapped_column(String(120), default="")


class Configuracao(Base):
    """Preferencias do app (chave/valor): margem alvo, busca automatica etc."""

    __tablename__ = "configuracao"

    chave: Mapped[str] = mapped_column(String(40), primary_key=True)
    valor: Mapped[str] = mapped_column(Text, default="")


class Orcamento(Base):
    """Orcado x Realizado por projeto (chave = numero normalizado, cross-empresa)."""

    __tablename__ = "orcamento"

    chave_projeto: Mapped[str] = mapped_column(String(80), primary_key=True)
    nome_exibicao: Mapped[str] = mapped_column(String(120), default="")
    receita_prevista: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    custo_previsto: Mapped[float | None] = mapped_column(Numeric(15, 2), nullable=True)
    atualizado_por: Mapped[str] = mapped_column(String(80), default="")
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class FechamentoAprovado(Base):
    """Fotografia imutavel de um fechamento aprovado pela gestao."""

    __tablename__ = "fechamento_aprovado"

    id: Mapped[int] = mapped_column(primary_key=True)
    chave_projeto: Mapped[str] = mapped_column(String(80), index=True)
    nome: Mapped[str] = mapped_column(String(120))
    periodo_de: Mapped[date | None] = mapped_column(Date, nullable=True)
    periodo_ate: Mapped[date | None] = mapped_column(Date, nullable=True)
    dados: Mapped[dict] = mapped_column(JSONVariant)
    usuario: Mapped[str] = mapped_column(String(80), default="")
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Comentario(Base):
    __tablename__ = "comentario"

    id: Mapped[int] = mapped_column(primary_key=True)
    chave_projeto: Mapped[str] = mapped_column(String(80), index=True)
    texto: Mapped[str] = mapped_column(Text)
    usuario: Mapped[str] = mapped_column(String(80), default="")
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa_id: Mapped[int] = mapped_column(ForeignKey("empresa.id", ondelete="CASCADE"))
    recurso: Mapped[str] = mapped_column(String(30))
    periodo_de: Mapped[date | None] = mapped_column(Date, nullable=True)
    periodo_ate: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(15), default="executando")  # executando|concluido|erro
    mensagem: Mapped[str] = mapped_column(Text, default="")
    iniciado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    concluido_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    qtd_registros: Mapped[int] = mapped_column(default=0)
