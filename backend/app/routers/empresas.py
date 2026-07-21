from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import cache, models, schemas
from ..config import settings
from ..crypto import decrypt_str, encrypt_str
from ..db import get_db
from ..omie import api as omie_api
from ..omie.client import OmieClient, OmieError, OmieRateLimitError, OmieTransportError

router = APIRouter(prefix="/api/empresas", tags=["empresas"])

REGIMES = {"nota", "simples"}
ANEXOS = {None, "I", "II", "III", "IV", "V"}


def _get_empresa(db: Session, empresa_id: int) -> models.Empresa:
    empresa = db.get(models.Empresa, empresa_id)
    if not empresa:
        raise HTTPException(status_code=404, detail="Empresa não encontrada")
    return empresa


def build_omie_client(empresa: models.Empresa) -> OmieClient:
    return OmieClient(
        app_key=decrypt_str(empresa.app_key_enc),
        app_secret=decrypt_str(empresa.app_secret_enc),
        base_url=settings.omie_base_url,
        min_interval=settings.omie_min_interval,
    )


@router.get("", response_model=list[schemas.EmpresaOut])
def listar(db: Session = Depends(get_db)):
    return db.scalars(select(models.Empresa).order_by(models.Empresa.nome)).all()


def _impedir_credencial_duplicada(db: Session, app_key: str, ignorar_id: int | None = None) -> None:
    """Duas empresas com a MESMA chave leem a MESMA conta Omie — e o app soma as
    duas, dobrando todos os valores. Erro silencioso e caro: barrado aqui."""
    if not app_key:
        return
    chave = app_key.strip()
    for outra in db.scalars(select(models.Empresa)).all():
        if ignorar_id is not None and outra.id == ignorar_id:
            continue
        try:
            if decrypt_str(outra.app_key_enc) == chave:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Esta App Key já está em uso pela empresa '{outra.nome}'. "
                        "Cada CNPJ tem a sua própria chave no Omie — usar a mesma faz o app "
                        "ler a mesma conta duas vezes e dobrar todos os valores."
                    ),
                )
        except HTTPException:
            raise
        except Exception:  # credencial antiga ilegivel: nao bloqueia o cadastro
            continue


@router.post("", response_model=schemas.EmpresaOut, status_code=201)
def criar(payload: schemas.EmpresaCreate, db: Session = Depends(get_db)):
    if payload.regime not in REGIMES:
        raise HTTPException(status_code=422, detail="Regime deve ser 'nota' ou 'simples'")
    if payload.simples_anexo not in ANEXOS:
        raise HTTPException(status_code=422, detail="Anexo do Simples deve ser I a V")
    _impedir_credencial_duplicada(db, payload.app_key)
    empresa = models.Empresa(
        nome=payload.nome.strip(),
        cnpj=payload.cnpj.strip(),
        app_key_enc=encrypt_str(payload.app_key.strip()),
        app_secret_enc=encrypt_str(payload.app_secret.strip()),
        regime=payload.regime,
        simples_anexo=payload.simples_anexo,
        aliquota_extra=payload.aliquota_extra,
    )
    db.add(empresa)
    db.commit()
    db.refresh(empresa)
    return empresa


def limpar_cache_empresa(db: Session, empresa_id: int) -> None:
    """Remove dados sincronizados da empresa (o cache pertence a UMA conta Omie).

    Chamado quando as credenciais mudam: os dados da conta antiga nao podem
    conviver com os da nova — o upsert nunca apaga, so acrescenta/atualiza.
    """
    for model in (models.Titulo, models.NFe, models.Projeto, models.Cliente, models.CategoriaGrupo):
        db.execute(delete(model).where(model.empresa_id == empresa_id))


@router.put("/{empresa_id}", response_model=schemas.EmpresaOut)
def atualizar(empresa_id: int, payload: schemas.EmpresaUpdate, db: Session = Depends(get_db)):
    empresa = _get_empresa(db, empresa_id)
    if payload.app_key:
        _impedir_credencial_duplicada(db, payload.app_key, ignorar_id=empresa_id)
    if payload.app_key or payload.app_secret:
        limpar_cache_empresa(db, empresa_id)
    if payload.regime is not None:
        if payload.regime not in REGIMES:
            raise HTTPException(status_code=422, detail="Regime deve ser 'nota' ou 'simples'")
        empresa.regime = payload.regime
    if payload.nome is not None:
        empresa.nome = payload.nome.strip()
    if payload.cnpj is not None:
        empresa.cnpj = payload.cnpj.strip()
    if payload.app_key:
        empresa.app_key_enc = encrypt_str(payload.app_key.strip())
    if payload.app_secret:
        empresa.app_secret_enc = encrypt_str(payload.app_secret.strip())
    if payload.simples_anexo is not None:
        anexo = payload.simples_anexo or None
        if anexo not in ANEXOS:
            raise HTTPException(status_code=422, detail="Anexo do Simples deve ser I a V")
        empresa.simples_anexo = anexo
    if payload.aliquota_extra is not None:
        empresa.aliquota_extra = payload.aliquota_extra
    if payload.ativa is not None:
        empresa.ativa = payload.ativa
    db.commit()
    db.refresh(empresa)
    cache.invalidar()
    return empresa


@router.delete("/{empresa_id}", status_code=204)
def excluir(empresa_id: int, db: Session = Depends(get_db)):
    empresa = _get_empresa(db, empresa_id)
    db.delete(empresa)
    db.commit()
    cache.invalidar()


@router.post("/{empresa_id}/testar-conexao", response_model=schemas.TesteConexaoOut)
def testar_conexao(empresa_id: int, db: Session = Depends(get_db)):
    empresa = _get_empresa(db, empresa_id)
    try:
        with build_omie_client(empresa) as client:
            resultado = omie_api.testar_conexao(client)
        return schemas.TesteConexaoOut(**resultado)
    except OmieRateLimitError as exc:
        return schemas.TesteConexaoOut(ok=False, erro=str(exc))
    except OmieError as exc:
        return schemas.TesteConexaoOut(ok=False, erro=f"Omie recusou a chamada: {exc.faultstring}")
    except OmieTransportError as exc:
        return schemas.TesteConexaoOut(ok=False, erro=str(exc))


@router.get("/{empresa_id}/simples", response_model=list[schemas.SimplesPeriodoOut])
def listar_simples(empresa_id: int, db: Session = Depends(get_db)):
    _get_empresa(db, empresa_id)
    rows = db.scalars(
        select(models.SimplesPeriodo)
        .where(models.SimplesPeriodo.empresa_id == empresa_id)
        .order_by(models.SimplesPeriodo.competencia)
    ).all()
    return rows


@router.put("/{empresa_id}/simples", response_model=list[schemas.SimplesPeriodoOut])
def salvar_simples(empresa_id: int, payload: list[schemas.SimplesPeriodoIn], db: Session = Depends(get_db)):
    _get_empresa(db, empresa_id)
    for item in payload:
        row = db.scalar(
            select(models.SimplesPeriodo).where(
                models.SimplesPeriodo.empresa_id == empresa_id,
                models.SimplesPeriodo.competencia == item.competencia,
            )
        )
        if row is None:
            row = models.SimplesPeriodo(empresa_id=empresa_id, competencia=item.competencia)
            db.add(row)
        row.rbt12 = item.rbt12
    db.commit()
    cache.invalidar()  # aliquota do Simples muda o imposto calculado
    return listar_simples(empresa_id, db)
