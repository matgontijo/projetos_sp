from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..services import calculo
from ..services import export as export_svc
from .projetos import _empresa_ids

router = APIRouter(prefix="/api/export", tags=["export"])


def _dados(db: Session, empresa_ids: str | None, de: date | None, ate: date | None) -> dict:
    ids = _empresa_ids(db, empresa_ids)
    if not ids:
        return {"projetos": [], "consolidado": {}}
    return calculo.fechar_projetos(db, ids, de, ate)


@router.get("/fechamento.csv")
def exportar_csv(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    dados = _dados(db, empresa_ids, de, ate)
    conteudo = export_svc.fechamento_csv(dados["projetos"], dados["consolidado"])
    return Response(
        content=conteudo.encode("utf-8-sig"),  # BOM p/ Excel abrir acentos corretamente
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="fechamento.csv"'},
    )


@router.get("/fechamento.pdf")
def exportar_pdf(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    dados = _dados(db, empresa_ids, de, ate)
    periodo = ""
    if de or ate:
        fmt = lambda d: d.strftime("%d/%m/%Y") if d else "…"  # noqa: E731
        periodo = f"Período: {fmt(de)} a {fmt(ate)}"
    conteudo = export_svc.fechamento_pdf(dados["projetos"], dados.get("consolidado", {}), periodo)
    return Response(
        content=conteudo,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="fechamento.pdf"'},
    )


@router.get("/fechamento.xlsx")
def exportar_xlsx(
    empresa_ids: str | None = Query(default=None),
    de: date | None = None,
    ate: date | None = None,
    db: Session = Depends(get_db),
):
    dados = _dados(db, empresa_ids, de, ate)
    conteudo = export_svc.fechamento_xlsx(dados["projetos"], dados["consolidado"])
    return Response(
        content=conteudo,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="fechamento.xlsx"'},
    )
