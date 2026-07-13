"""Aliquota efetiva do Simples Nacional (LC 123/2006, tabelas vigentes desde 2018).

aliquota_efetiva = (RBT12 x aliquota_nominal - parcela_a_deduzir) / RBT12

O RBT12 de cada competencia vem de simples_periodo (informado manualmente) ou e
derivado do cache de receitas dos 12 meses anteriores quando ha dados.
"""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models

# (teto_rbt12, aliquota_nominal, parcela_a_deduzir)
TABELAS = {
    "I": [  # Comercio
        (180_000, 0.040, 0),
        (360_000, 0.073, 5_940),
        (720_000, 0.095, 13_860),
        (1_800_000, 0.107, 22_500),
        (3_600_000, 0.143, 87_300),
        (4_800_000, 0.190, 378_000),
    ],
    "II": [  # Industria
        (180_000, 0.045, 0),
        (360_000, 0.078, 5_940),
        (720_000, 0.100, 13_860),
        (1_800_000, 0.112, 22_500),
        (3_600_000, 0.147, 85_500),
        (4_800_000, 0.300, 720_000),
    ],
    "III": [  # Servicos (fator R favoravel)
        (180_000, 0.060, 0),
        (360_000, 0.112, 9_360),
        (720_000, 0.135, 17_640),
        (1_800_000, 0.160, 35_640),
        (3_600_000, 0.210, 125_640),
        (4_800_000, 0.330, 648_000),
    ],
    "IV": [
        (180_000, 0.045, 0),
        (360_000, 0.090, 8_100),
        (720_000, 0.102, 12_420),
        (1_800_000, 0.140, 39_780),
        (3_600_000, 0.220, 183_780),
        (4_800_000, 0.330, 828_000),
    ],
    "V": [
        (180_000, 0.155, 0),
        (360_000, 0.180, 4_500),
        (720_000, 0.195, 9_900),
        (1_800_000, 0.205, 17_100),
        (3_600_000, 0.230, 62_100),
        (4_800_000, 0.305, 540_000),
    ],
}


def aliquota_efetiva(rbt12: float, anexo: str) -> float:
    tabela = TABELAS.get(anexo or "I", TABELAS["I"])
    if rbt12 <= 0:
        return tabela[0][1]  # primeira faixa: efetiva = nominal
    for teto, nominal, deducao in tabela:
        if rbt12 <= teto:
            return max((rbt12 * nominal - deducao) / rbt12, 0.0)
    teto, nominal, deducao = tabela[-1]
    return max((rbt12 * nominal - deducao) / rbt12, 0.0)


def _competencia_anterior(competencia: str, meses: int) -> str:
    ano, mes = int(competencia[:4]), int(competencia[5:7])
    total = ano * 12 + (mes - 1) - meses
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def rbt12_derivado(db: Session, empresa_id: int, competencia: str) -> float | None:
    """Soma as receitas (contas a receber) dos 12 meses anteriores a competencia."""
    inicio_comp = _competencia_anterior(competencia, 12)
    ano_i, mes_i = int(inicio_comp[:4]), int(inicio_comp[5:7])
    ano_f, mes_f = int(competencia[:4]), int(competencia[5:7])
    inicio = date(ano_i, mes_i, 1)
    fim = date(ano_f, mes_f, 1)  # exclusivo (nao inclui a propria competencia)
    total = db.scalar(
        select(func.sum(models.Titulo.valor_documento)).where(
            models.Titulo.empresa_id == empresa_id,
            models.Titulo.tipo == "receber",
            models.Titulo.data_emissao >= inicio,
            models.Titulo.data_emissao < fim,
            func.upper(models.Titulo.status_titulo) != "CANCELADO",
        )
    )
    return float(total) if total else None


def aliquota_da_competencia(db: Session, empresa: models.Empresa, competencia: str) -> float:
    """Aliquota efetiva do Simples para a competencia: RBT12 manual > derivado > 0."""
    manual = db.scalar(
        select(models.SimplesPeriodo.rbt12).where(
            models.SimplesPeriodo.empresa_id == empresa.id,
            models.SimplesPeriodo.competencia == competencia,
        )
    )
    rbt12 = float(manual) if manual else rbt12_derivado(db, empresa.id, competencia)
    if rbt12 is None:
        return 0.0
    return aliquota_efetiva(rbt12, empresa.simples_anexo or "I")
