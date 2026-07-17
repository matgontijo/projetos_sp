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

AZUL = (43, 108, 238)
CINZA = (100, 100, 100)
TINTA = (25, 25, 28)


def _txt(valor) -> str:
    """Latin-1 nao tem travessao/bullet: troca por equivalentes antes de sanear."""
    texto = str(valor).replace("—", "-").replace("–", "-").replace("·", "-").replace("…", "...")
    return _pdf_txt(texto)


def proposta_pdf(orc, itens: list, empresa_nome: str) -> bytes:
    """Proposta de fornecimento (A4 retrato): cliente, itens, condicoes, validade."""
    pdf = FPDF(orientation="P", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    largura_util = pdf.w - pdf.l_margin - pdf.r_margin

    # faixa de acento no topo
    pdf.set_fill_color(*AZUL)
    pdf.rect(0, 0, pdf.w, 3.2, style="F")
    pdf.ln(2)

    # cabecalho: titulo a esquerda, numero em destaque a direita
    pdf.set_font("Helvetica", "B", 17)
    pdf.set_text_color(*TINTA)
    pdf.cell(largura_util - 52, 10, _txt("PROPOSTA DE FORNECIMENTO"))
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*AZUL)
    pdf.cell(52, 10, _txt(f"Nº {orc.numero}"), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*CINZA)
    pdf.multi_cell(largura_util, 4.6, _txt(empresa_nome), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.set_draw_color(210, 210, 210)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(4)

    # dados do cliente
    criado = orc.criado_em.strftime("%d/%m/%Y") if orc.criado_em else datetime.now().strftime("%d/%m/%Y")
    validade = (orc.criado_em or datetime.now()) + timedelta(days=15)
    pdf.set_text_color(*TINTA)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(28, 7, "CLIENTE:")
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(largura_util - 28, 7, _txt(orc.cliente or "-"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(28, 7, "DATA:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(60, 7, criado)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(34, 7, "VALIDADE:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, _txt(validade.strftime("%d/%m/%Y")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # tabela de itens (zebra + cabecalho azul)
    colunas = [("item", "ITEM", 14, "C"), ("descricao", "DESCRIÇÃO", 86, "L"),
               ("quantidade", "QTDE", 22, "R"), ("preco", "PREÇO UNIT.", 32, "R"), ("total", "TOTAL", 34, "R")]
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(*AZUL)
    pdf.set_text_color(255, 255, 255)
    for _, titulo, largura, alinh in colunas:
        pdf.cell(largura, 7.5, _txt(titulo), align=alinh, fill=True)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*TINTA)
    pdf.set_fill_color(245, 246, 250)
    for i, item in enumerate(itens, start=1):
        valores = {
            "item": str(i),
            "descricao": item["descricao"][:52],
            "quantidade": f"{item['quantidade']:,}".replace(",", "."),
            "preco": f"R$ {_moeda_pt(item['preco_unitario'])}",
            "total": f"R$ {_moeda_pt(item['total'])}",
        }
        for campo, _, largura, alinh in colunas:
            pdf.cell(largura, 7, _txt(valores[campo]), border="B", align=alinh, fill=i % 2 == 0)
        pdf.ln()
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(122, 9, "")
    pdf.cell(32, 9, "TOTAL GERAL", align="R")
    pdf.set_text_color(*AZUL)
    pdf.cell(34, 9, _txt(f"R$ {_moeda_pt(float(orc.total))}"), align="R", border="T")
    pdf.set_text_color(*TINTA)
    pdf.ln(14)

    # condicoes
    condicao = "À vista" if orc.condicao_pagamento_dias == 0 else f"{orc.condicao_pagamento_dias} dias"
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, _txt("CONSIDERAÇÕES DO PEDIDO"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    for rotulo, valor in [
        ("Condições de pagamento", condicao),
        ("Empresa de faturamento", empresa_nome),
        ("Frete", "A combinar"),
        ("Responsável comercial", orc.criado_por or "-"),
    ]:
        pdf.set_text_color(*CINZA)
        pdf.cell(52, 6, _txt(f"{rotulo}:"))
        pdf.set_text_color(*TINTA)
        pdf.multi_cell(largura_util - 52, 6, _txt(valor), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)
    pdf.set_font("Helvetica", "", 7.5)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 5, _txt(f"Proposta gerada em {datetime.now().strftime('%d/%m/%Y %H:%M')} - validade de 15 dias a partir da emissão."))
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
