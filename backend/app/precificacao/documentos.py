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

# paleta da proposta (impressao amigavel)
MARINHO = (18, 32, 58)  # banda de marca
AZUL = (43, 108, 238)  # acento / numeros-chave
AZUL_SUAVE = (235, 241, 253)  # cartao do investimento
AMBAR_FUNDO = (255, 246, 224)
AMBAR_TEXTO = (146, 94, 10)
CINZA = (108, 112, 122)
TINTA = (24, 26, 32)
ZEBRA = (246, 247, 250)


def _txt(valor) -> str:
    """Latin-1 nao tem travessao/bullet: troca por equivalentes antes de sanear."""
    texto = str(valor).replace("—", "-").replace("–", "-").replace("·", "-").replace("…", "...")
    return _pdf_txt(texto)


def _marca(empresa_nome: str) -> str:
    """Nome fantasia curto a partir da razao social (2 primeiras palavras)."""
    palavras = (empresa_nome or "").split()
    return " ".join(palavras[:2]).upper() or "PROPOSTA"


class _PropostaBase(FPDF):
    """Cabecalho de marca e rodape com paginacao em todas as paginas."""

    def __init__(self, empresa_nome: str, numero: str, data: str):
        super().__init__(orientation="P", format="A4")
        self.empresa_nome = empresa_nome
        self.numero = numero
        self.data = data
        self.alias_nb_pages()
        self.set_auto_page_break(auto=True, margin=22)

    def header(self):
        util = self.w - self.l_margin - self.r_margin
        self.set_fill_color(*MARINHO)
        self.rect(0, 0, self.w, 26, style="F")
        self.set_fill_color(*AZUL)
        self.rect(0, 26, self.w, 1.2, style="F")
        # duas linhas, MESMAS baselines dos dois lados (grid)
        self.set_xy(self.l_margin, 6.5)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(255, 255, 255)
        self.cell(util - 70, 8, _txt(_marca(self.empresa_nome)))
        self.set_font("Helvetica", "B", 14)
        self.cell(70, 8, _txt(f"Nº {self.numero}"), align="R")
        self.set_xy(self.l_margin, 16)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(168, 182, 210)
        self.cell(util - 70, 4, _txt(self.empresa_nome[:76]))
        self.cell(70, 4, _txt(f"Proposta comercial - {self.data}"), align="R")
        self.set_y(35)

    def footer(self):
        util = self.w - self.l_margin - self.r_margin
        self.set_y(-14)
        self.set_draw_color(222, 224, 230)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.set_y(-11)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(150, 154, 162)
        gerado = datetime.now().strftime("%d/%m/%Y %H:%M")
        self.cell(util - 40, 4, _txt(f"{_marca(self.empresa_nome)} - proposta gerada em {gerado}"))
        self.cell(40, 4, _txt(f"Página {self.page_no()}/{{nb}}"), align="R")


def _rotulo_secao(pdf: FPDF, texto: str) -> None:
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(*CINZA)
    pdf.cell(0, 5, _txt(texto.upper()), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)


def proposta_pdf(orc, itens: list, empresa_nome: str) -> bytes:
    """Proposta comercial (A4): o total e o heroi, validade cria urgencia,
    proximo passo diz ao cliente exatamente como aprovar."""
    criado_dt = orc.criado_em or datetime.now()
    validade = criado_dt + timedelta(days=15)
    condicao = "À vista" if orc.condicao_pagamento_dias == 0 else f"{orc.condicao_pagamento_dias} dias"
    qtd_total = sum(i["quantidade"] for i in itens) or 1

    pdf = _PropostaBase(empresa_nome, orc.numero, criado_dt.strftime("%d/%m/%Y"))
    pdf.add_page()
    largura_util = pdf.w - pdf.l_margin - pdf.r_margin

    # ---- preparado para ----
    _rotulo_secao(pdf, "Preparado para")
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(*TINTA)
    pdf.multi_cell(largura_util, 8, _txt(orc.cliente or "Cliente"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # ---- cartao-heroi: o investimento (grid: rotulos numa linha, valores noutra) ----
    y0 = pdf.get_y()
    ALTURA_CARTAO = 26
    PAD = 6
    pdf.set_fill_color(*AZUL_SUAVE)
    pdf.rect(pdf.l_margin, y0, largura_util, ALTURA_CARTAO, style="F")
    pdf.set_fill_color(*AZUL)
    pdf.rect(pdf.l_margin, y0, 1.8, ALTURA_CARTAO, style="F")

    fatos = [
        ("QUANTIDADE", f"{qtd_total:,}".replace(",", ".") + " un"),
        ("PREÇO UNITÁRIO", f"R$ {_moeda_pt(float(orc.total) / qtd_total)}"),
        ("PAGAMENTO", condicao),
    ]
    x_esq = pdf.l_margin + PAD  # bloco do total
    x_fatos = pdf.l_margin + 104  # 3 colunas de 28mm terminam rentes ao padding direito
    LARG_FATO = 28

    # linha 1: TODOS os rotulos na mesma baseline
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_text_color(*CINZA)
    pdf.set_xy(x_esq, y0 + 5)
    pdf.cell(80, 4, _txt("INVESTIMENTO TOTAL"))
    for i, (rotulo, _) in enumerate(fatos):
        pdf.set_xy(x_fatos + i * LARG_FATO, y0 + 5)
        pdf.cell(LARG_FATO - 2, 4, _txt(rotulo))
    # linha 2: TODOS os valores na mesma baseline
    pdf.set_xy(x_esq, y0 + 10.5)
    pdf.set_font("Helvetica", "B", 21)
    pdf.set_text_color(*AZUL)
    pdf.cell(86, 11, _txt(f"R$ {_moeda_pt(float(orc.total))}"))
    pdf.set_font("Helvetica", "B", 10.5)
    pdf.set_text_color(*TINTA)
    for i, (_, valor) in enumerate(fatos):
        pdf.set_xy(x_fatos + i * LARG_FATO, y0 + 13)
        pdf.cell(LARG_FATO - 2, 6, _txt(valor))
    pdf.set_y(y0 + ALTURA_CARTAO + 4)

    # ---- urgencia: validade (texto centralizado na faixa) ----
    y0 = pdf.get_y()
    pdf.set_fill_color(*AMBAR_FUNDO)
    pdf.rect(pdf.l_margin, y0, largura_util, 9, style="F")
    pdf.set_xy(pdf.l_margin + PAD, y0)
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.set_text_color(*AMBAR_TEXTO)
    pdf.cell(largura_util - 2 * PAD, 9, _txt(f"Proposta válida até {validade.strftime('%d/%m/%Y')} - garanta estas condições confirmando dentro do prazo."))
    pdf.set_y(y0 + 9 + 7)

    # ---- itens (colunas somam EXATAMENTE a largura util: bordas rentes ao grid) ----
    _rotulo_secao(pdf, "Itens da proposta")
    colunas = [("item", "#", 10, "C"), ("descricao", "DESCRIÇÃO", 92, "L"),
               ("quantidade", "QTDE", 22, "R"), ("preco", "PREÇO UNIT.", 32, "R"), ("total", "TOTAL", 34, "R")]
    pdf.set_font("Helvetica", "B", 8.5)
    pdf.set_fill_color(*MARINHO)
    pdf.set_text_color(255, 255, 255)
    for _, titulo, largura, alinh in colunas:
        pdf.cell(largura, 7, _txt(titulo), align=alinh, fill=True)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    pdf.set_fill_color(*ZEBRA)
    for i, item in enumerate(itens, start=1):
        pdf.set_text_color(*TINTA)
        valores = {
            "item": str(i),
            "descricao": item["descricao"][:54],
            "quantidade": f"{item['quantidade']:,}".replace(",", "."),
            "preco": f"R$ {_moeda_pt(item['preco_unitario'])}",
            "total": f"R$ {_moeda_pt(item['total'])}",
        }
        for campo, _, largura, alinh in colunas:
            pdf.cell(largura, 7, _txt(valores[campo]), border="B", align=alinh, fill=i % 2 == 0)
        pdf.ln()
    pdf.set_font("Helvetica", "B", 10.5)
    pdf.set_text_color(*TINTA)
    pdf.cell(124, 9, "")
    pdf.cell(32, 9, "TOTAL", align="R")
    pdf.set_text_color(*AZUL)
    pdf.cell(34, 9, _txt(f"R$ {_moeda_pt(float(orc.total))}"), align="R", border="T")
    pdf.ln(16)

    # ---- condicoes em grade 2x2 (mesma largura de rotulo nas duas colunas) ----
    _rotulo_secao(pdf, "Condições de fornecimento")
    # razao social completa ja esta no cabecalho; aqui o nome curto evita colisao de colunas
    pares = [
        ("Pagamento", condicao),
        ("Frete", "A combinar"),
        ("Faturamento por", _marca(empresa_nome)),
        ("Validade da proposta", validade.strftime("%d/%m/%Y")),
    ]
    meia = largura_util / 2
    ROTULO_LARG = 36
    for linha in range(0, len(pares), 2):
        y_linha = pdf.get_y()
        for coluna, (rotulo, valor) in enumerate(pares[linha:linha + 2]):
            pdf.set_xy(pdf.l_margin + coluna * meia, y_linha)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*CINZA)
            pdf.cell(ROTULO_LARG, 6.5, _txt(f"{rotulo}:"))
            pdf.set_font("Helvetica", "B", 8.5)
            pdf.set_text_color(*TINTA)
            pdf.cell(meia - ROTULO_LARG, 6.5, _txt(valor))
        pdf.set_y(y_linha + 6.5)

    # ---- proximo passo (CTA) ancorado no pe da pagina: composicao fecha ----
    ALTURA_CTA = 18
    y_cta = pdf.h - 14 - 8 - ALTURA_CTA  # rodape (14) + respiro (8)
    if pdf.get_y() + 8 < y_cta:
        pdf.set_y(y_cta)
    else:
        pdf.ln(6)
    y0 = pdf.get_y()
    pdf.set_fill_color(*MARINHO)
    pdf.rect(pdf.l_margin, y0, largura_util, ALTURA_CTA, style="F")
    pdf.set_xy(pdf.l_margin + PAD, y0 + 3.5)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(largura_util - 2 * PAD, 5, _txt("PRÓXIMO PASSO"))
    pdf.set_xy(pdf.l_margin + PAD, y0 + 9.5)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(200, 212, 235)
    responsavel = orc.criado_por or "nosso time comercial"
    pdf.cell(largura_util - 2 * PAD, 5, _txt(f"Para aprovar, basta responder esta proposta ou falar com {responsavel}. Produção inicia após a confirmação."))

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
