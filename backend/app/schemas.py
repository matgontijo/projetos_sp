from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

GRUPOS_VALIDOS = {"producao", "frete", "imposto", "outros", "ignorar"}


# --- Empresas ---
class EmpresaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    cnpj: str = ""
    app_key: str = Field(min_length=1)
    app_secret: str = Field(min_length=1)
    regime: str = "nota"  # 'nota' | 'simples'
    simples_anexo: str | None = None  # 'I'..'V'


class EmpresaUpdate(BaseModel):
    nome: str | None = None
    cnpj: str | None = None
    app_key: str | None = None  # so substitui se enviado nao-vazio
    app_secret: str | None = None
    regime: str | None = None
    simples_anexo: str | None = None
    ativa: bool | None = None


class EmpresaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    cnpj: str
    regime: str
    simples_anexo: str | None
    ativa: bool
    criado_em: datetime


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


# --- Simples ---
class SimplesPeriodoIn(BaseModel):
    competencia: str  # 'YYYY-MM'
    rbt12: float | None


class SimplesPeriodoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    competencia: str
    rbt12: float | None
