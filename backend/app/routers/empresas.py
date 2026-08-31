from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import cache, models, schemas
from ..auth import exigir_admin_ou_financeiro
from ..config import settings
from ..crypto import decrypt_str, encrypt_str
from ..db import get_db
from ..omie import api as omie_api
from ..omie.client import OmieClient, OmieError, OmieRateLimitError, OmieTransportError

router = APIRouter(prefix="/api/empresas", tags=["empresas"])

REGIMES = {"nota", "simples"}
ANEXOS = {None, "I", "II", "III", "IV", "V"}


def _linhas_de_imposto(itens: list[schemas.ImpostoItem] | None) -> list[dict] | None:
    """Normaliza a tabela de impostos da empresa (descarta linhas em branco)."""
    if itens is None:
        return None
    return [{"nome": i.nome.strip(), "aliquota": float(i.aliquota)} for i in itens if i.nome.strip()]


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
        impostos=_linhas_de_imposto(payload.impostos),
        fonte_imposto=payload.fonte_imposto if payload.fonte_imposto in schemas.FONTES_IMPOSTO else "nfe",
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
    # Vendedor e PedidoCompra tambem sao espelho da conta (parcelas caem via
    # ON DELETE CASCADE do pedido) — deixa-los criaria nomes e compromissos
    # da conta antiga colados na nova.
    for model in (
        models.Titulo,
        models.NFe,
        models.Projeto,
        models.Cliente,
        models.CategoriaGrupo,
        models.Vendedor,
        models.PedidoCompra,
    ):
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
    if payload.impostos is not None:
        empresa.impostos = _linhas_de_imposto(payload.impostos)
    if payload.fonte_imposto is not None:
        if payload.fonte_imposto not in schemas.FONTES_IMPOSTO:
            raise HTTPException(status_code=422, detail="Fonte do imposto deve ser 'nfe' ou 'aliquota'")
        empresa.fonte_imposto = payload.fonte_imposto
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


# ---------- perfis de tributação por operação ----------
# Os blocos da planilha: venda padrão SP paga a tabela cheia; fins de exportação
# (CFOP 5502) e exportação (7101) só CSLL/IRPJ. O projeto escolhe o perfil por nome.


class PerfilIn(BaseModel):
    nome: str = Field(min_length=1, max_length=60)
    impostos: list[schemas.ImpostoItem] = []


def _perfil_out(p: models.PerfilTributacao) -> dict:
    return {
        "nome": p.nome,
        "impostos": p.impostos or [],
        "atualizado_por": p.atualizado_por,
        "atualizado_em": p.atualizado_em.isoformat() if p.atualizado_em else None,
    }


@router.get("/{empresa_id}/perfis")
def listar_perfis(empresa_id: int, db: Session = Depends(get_db)):
    _get_empresa(db, empresa_id)
    rows = db.scalars(
        select(models.PerfilTributacao)
        .where(models.PerfilTributacao.empresa_id == empresa_id)
        .order_by(models.PerfilTributacao.nome)
    ).all()
    return [_perfil_out(p) for p in rows]


@router.put("/{empresa_id}/perfis")
def salvar_perfis(
    empresa_id: int,
    payload: list[PerfilIn],
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(exigir_admin_ou_financeiro),
):
    """Substitui a lista de perfis da empresa (a tela edita a lista inteira).

    Perfil removido daqui continua citado por projetos? Sem problema: o cálculo
    cai na tabela padrão da empresa quando o nome não existe mais.
    """
    _get_empresa(db, empresa_id)
    nomes = [p.nome.strip() for p in payload]
    if len(set(n.lower() for n in nomes)) != len(nomes):
        raise HTTPException(status_code=422, detail="Dois perfis com o mesmo nome")
    db.execute(delete(models.PerfilTributacao).where(models.PerfilTributacao.empresa_id == empresa_id))
    for p in payload:
        db.add(
            models.PerfilTributacao(
                empresa_id=empresa_id,
                nome=p.nome.strip(),
                impostos=_linhas_de_imposto(p.impostos) or [],
                atualizado_por=usuario.nome,
            )
        )
    db.commit()
    cache.invalidar()  # a aliquota dos projetos que usam esses perfis mudou
    return listar_perfis(empresa_id, db)


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
