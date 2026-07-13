from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app import models
from app.db import Base


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite://")  # em memoria
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, expire_on_commit=False)
    session = TestSession()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture()
def empresa(db: Session) -> models.Empresa:
    row = models.Empresa(nome="Empresa Teste", cnpj="00.000.000/0001-00", app_key_enc="x", app_secret_enc="y")
    db.add(row)
    db.commit()
    return row


def criar_projeto(db: Session, empresa: models.Empresa, codigo: int, nome: str) -> models.Projeto:
    row = models.Projeto(empresa_id=empresa.id, codigo_omie=codigo, nome=nome)
    db.add(row)
    db.commit()
    return row


def criar_titulo(
    db: Session,
    empresa: models.Empresa,
    tipo: str,
    codigo: int,
    valor: float,
    projeto: int | None = None,
    categoria: str = "",
    status: str = "EMABERTO",
    emissao: date = date(2026, 5, 10),
    rateio: list | None = None,
    cliente: int | None = None,
) -> models.Titulo:
    row = models.Titulo(
        empresa_id=empresa.id,
        tipo=tipo,
        codigo_lancamento_omie=codigo,
        valor_documento=valor,
        codigo_projeto_omie=projeto,
        codigo_categoria=categoria,
        status_titulo=status,
        data_emissao=emissao,
        categorias_rateio=rateio,
        codigo_cliente_fornecedor=cliente,
    )
    db.add(row)
    db.commit()
    return row


def criar_nfe(
    db: Session,
    empresa: models.Empresa,
    id_nf: int,
    projeto: int | None = None,
    emissao: date = date(2026, 5, 12),
    cancelada: bool = False,
    **valores,
) -> models.NFe:
    row = models.NFe(
        empresa_id=empresa.id,
        id_nf=id_nf,
        n_nf=str(id_nf),
        d_emi=emissao,
        tp_nf="1",
        cancelada=cancelada,
        codigo_projeto_omie=projeto,
        **valores,
    )
    db.add(row)
    db.commit()
    return row


def mapear_categoria(db: Session, empresa: models.Empresa, codigo: str, grupo: str | None) -> None:
    db.add(models.CategoriaGrupo(empresa_id=empresa.id, codigo_categoria=codigo, grupo=grupo))
    db.commit()
