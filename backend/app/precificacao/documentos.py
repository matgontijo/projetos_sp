"""PDF da proposta de fornecimento + export do historico de orcamentos.

Segue o layout da aba "PROPOSTA DE FORNECIMENTO" da planilha e o mesmo
padrao visual/fpdf2 do relatorio de fechamento (services/export.py).
"""

import csv
import io
from datetime import datetime, timedelta

from fpdf import FPDF
from openpyxl import Workbook
from openpyxl.styles import Font

from ..services.export import _moeda_pt, _pdf_txt


def proposta_pdf(orc, itens: list, empresa_nome: str) -> bytes:
    """Proposta de fornecimento (A4 retrato): cliente, itens, condicoes, validade."""
    pdf = FPDF(orientation="P", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    # cabecalho
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, _pdf_txt("PROPOSTA DE FORNECIMENTO"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(90, 90, 90)
    pdf.cell(0, 6, _pdf_txt(f"Orçamento {orc.numero} — {empresa_nome}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(30, 30, 30)
    pdf.ln(4)

    # dados do cliente
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(28, 7, "CLIENTE:", border=0)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, _pdf_txt(orc.cliente or "-"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(28, 7, "DATA:", border=0)
    pdf.set_font("Helvetica", "", 10)
    criado = orc.criado_em.strftime("%d/%m/%Y") if orc.criado_em else datetime.now().strftime("%d/%m/%Y")
    validade = (orc.criado_em or datetime.now()) + timedelta(days=15)
    pdf.cell(60, 7, criado)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(34, 7, "VALIDADE:", border=0)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, _pdf_txt(validade.strftime("%d/%m/%Y")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # tabela de itens
    colunas = [("item", "ITEM", 14, "C"), ("descricao", "DESCRIÇÃO", 86, "L"),
               ("quantidade", "QTDE", 22, "R"), ("preco", "PREÇO UNIT.", 32, "R"), ("total", "TOTAL", 34, "R")]
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(235, 235, 232)
    for _, titulo, largura, alinh in colunas:
        pdf.cell(largura, 7, _pdf_txt(titulo), border="B", align=alinh, fill=True)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    for i, item in enumerate(itens, start=1):
        valores = {
            "item": str(i),
            "descricao": item["descricao"][:52],
            "quantidade": f"{item['quantidade']:,}".replace(",", "."),
            "preco": f"R$ {_moeda_pt(item['preco_unitario'])}",
            "total": f"R$ {_moeda_pt(item['total'])}",
        }
        for campo, _, largura, alinh in colunas:
            pdf.cell(largura, 6.5, _pdf_txt(valores[campo]), border="B", align=alinh)
        pdf.ln()
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(122, 8, "")
    pdf.cell(32, 8, "TOTAL GERAL", align="R")
    pdf.cell(34, 8, _pdf_txt(f"R$ {_moeda_pt(float(orc.total))}"), align="R", border="T")
    pdf.ln(12)

    # condicoes
    condicao = "À vista" if orc.condicao_pagamento_dias == 0 else f"{orc.condicao_pagamento_dias} dias"
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, _pdf_txt("CONSIDERAÇÕES DO PEDIDO"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    for rotulo, valor in [
        ("Condições de pagamento", condicao),
        ("Empresa de faturamento", empresa_nome),
        ("Frete", "A combinar"),
        ("Responsável comercial", orc.criado_por or "-"),
    ]:
        pdf.set_text_color(90, 90, 90)
        pdf.cell(52, 6, _pdf_txt(f"{rotulo}:"))
        pdf.set_text_color(30, 30, 30)
        pdf.cell(0, 6, _pdf_txt(valor), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, _pdf_txt(f"Proposta gerada em {datetime.now().strftime('%d/%m/%Y %H:%M')} — validade de 15 dias."))
    return bytes(pdf.output())


_COLS = [("numero", "Número"), ("cliente", "Cliente"), ("empresa", "Empresa"), ("status", "Status"),
         ("quantidade", "Qtde"), ("preco_unitario", "Preço unit. (R$)"), ("total", "Total (R$)"),
         ("condicao", "Condição"), ("criado_por", "Criado por"), ("criado_em", "Criado em")]


def _linhas_export(orcamentos: list[dict]) -> list[list]:
    return [[o.get(campo, "") for campo, _ in _COLS] for o in orcamentos]


def orcamentos_csv(orcamentos: list[dict]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow([t for _, t in _COLS])
    for linha in _linhas_export(orcamentos):
        writer.writerow([str(v).replace(".", ",") if isinstance(v, float) else v for v in linha])
    return buffer.getvalue()


def orcamentos_xlsx(orcamentos: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Orçamentos"
    ws.append([t for _, t in _COLS])
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for linha in _linhas_export(orcamentos):
        ws.append(linha)
    for row in ws.iter_rows(min_row=2):
        row[5].number_format = 'R$ #,##0.0000'
        row[6].number_format = 'R$ #,##0.00'
    for idx, largura in enumerate([14, 30, 26, 12, 10, 16, 16, 12, 20, 18], start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = largura
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
