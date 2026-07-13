"""Exportacao do fechamento em CSV (pt-BR, separador ';') e Excel (openpyxl)."""

import csv
import io

from openpyxl import Workbook
from openpyxl.styles import Font

COLUNAS = [
    ("empresas", "Empresas"),
    ("projeto", "Projeto"),
    ("cliente", "Cliente"),
    ("receita", "Receita (R$)"),
    ("producao", "Produção (R$)"),
    ("frete", "Frete (R$)"),
    ("imposto", "Impostos (R$)"),
    ("outros", "Outros (R$)"),
    ("custo_total", "Custo total (R$)"),
    ("resultado", "Resultado (R$)"),
    ("margem", "Margem (%)"),
]


def _valor_pt_br(campo: str, valor) -> str:
    if campo == "margem":
        return f"{valor * 100:.2f}".replace(".", ",")
    if isinstance(valor, (int, float)) and campo not in ("empresa_id", "codigo_projeto"):
        return f"{valor:.2f}".replace(".", ",")
    return str(valor)


def fechamento_csv(projetos: list[dict], consolidado: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow([titulo for _, titulo in COLUNAS])
    for linha in projetos:
        writer.writerow([_valor_pt_br(campo, linha.get(campo, "")) for campo, _ in COLUNAS])
    writer.writerow([])
    writer.writerow(
        ["TOTAL", "", ""]
        + [
            _valor_pt_br(campo, consolidado.get("margem_media" if campo == "margem" else campo, 0))
            for campo, _ in COLUNAS[3:]
        ]
    )
    return buffer.getvalue()


def fechamento_xlsx(projetos: list[dict], consolidado: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Fechamento"
    ws.append([titulo for _, titulo in COLUNAS])
    for cell in ws[1]:
        cell.font = Font(bold=True)

    formato_moeda = 'R$ #,##0.00'
    for linha in projetos:
        ws.append(
            [
                linha.get(campo, "") if campo in ("empresas", "projeto", "cliente") else float(linha.get(campo, 0))
                for campo, _ in COLUNAS
            ]
        )
    total_row = ["TOTAL", "", ""] + [
        float(consolidado.get("margem_media" if campo == "margem" else campo, 0)) for campo, _ in COLUNAS[3:]
    ]
    ws.append(total_row)
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)

    for row in ws.iter_rows(min_row=2):
        for cell in row[3:10]:
            cell.number_format = formato_moeda
        row[10].number_format = "0.00%"

    for idx, largura in enumerate([24, 18, 28, 16, 16, 14, 16, 14, 16, 16, 12], start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = largura

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
