from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

GRUPOS_VALIDOS = {"producao", "frete", "comissao", "imposto", "outros", "ignorar"}


# --- Empresas ---
FONTES_IMPOSTO = {"nfe", "aliquota"}


class ImpostoItem(BaseModel):
    """Uma linha da tabela de impostos da empresa (PIS 0,65%, CSLL 1,20%...)."""

    nome: str = Field(min_length=1, max_length=40)
    aliquota: float = Field(ge=0, le=100)  # pontos percentuais s/ a receita


class EmpresaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    cnpj: str = ""
    app_key: str = Field(min_length=1)
    app_secret: str = Field(min_length=1)
    regime: str = "nota"  # 'nota' | 'simples'
    simples_anexo: str | None = None  # 'I'..'V'
    aliquota_extra: float = Field(default=0, ge=0, le=100)  # % s/ receita (legado)
    impostos: list[ImpostoItem] | None = None
    fonte_imposto: str = "nfe"  # 'nfe' (NF-e + linhas) | 'aliquota' (so as linhas)


class EmpresaUpdate(BaseModel):
    nome: str | None = None
    cnpj: str | None = None
    app_key: str | None = None  # so substitui se enviado nao-vazio
    app_secret: str | None = None
    regime: str | None = None
    simples_anexo: str | None = None
    aliquota_extra: float | None = Field(default=None, ge=0, le=100)
    impostos: list[ImpostoItem] | None = None
    fonte_imposto: str | None = None
    ativa: bool | None = None


class EmpresaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    cnpj: str
    regime: str
    simples_anexo: str | None
    aliquota_extra: float
    impostos: list[ImpostoItem] = Field(default_factory=list)
    fonte_imposto: str = "nfe"
    ativa: bool
    criado_em: datetime

    @field_validator("impostos", mode="before")
    @classmethod
    def _lista_vazia(cls, valor):  # coluna nova: linhas antigas vem NULL
        return valor or []

    @field_validator("fonte_imposto", mode="before")
    @classmethod
    def _fonte_padrao(cls, valor):
        return valor or "nfe"


class TesteConexaoOut(BaseModel):
    ok: bool
    total_projetos: int | None = None
    erro: str | None = None


# --- Sincronizacao ---
class SyncRequest(BaseModel):
    empresa_ids: list[int]
    data_de: date
    data_ate: date


class SyncLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    empresa_id: int
    recurso: str
    periodo_de: date | None
    periodo_ate: date | None
    status: str
    mensagem: str
    iniciado_em: datetime
    concluido_em: datetime | None
    qtd_registros: int


# --- Categorias ---
class CategoriaGrupoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    empresa_id: int
    codigo_categoria: str
    descricao: str
    grupo: str | None


class CategoriaGrupoUpdate(BaseModel):
    codigo_categoria: str
    grupo: str | None  # None = nao classificada


# --- Ajustes ---
class AjusteCreate(BaseModel):
    empresa_id: int
    alvo_tipo: str  # 'titulo' | 'nfe'
    alvo_id: int
    campo: str
    valor_novo: str
    motivo: str = ""


class AjusteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    empresa_id: int
    alvo_tipo: str
    alvo_id: int
    campo: str
    valor_anterior: str
    valor_novo: str
    motivo: str
    usuario: str
    criado_em: datetime
