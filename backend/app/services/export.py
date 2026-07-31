"""Exportacao do fechamento em CSV (pt-BR, ';'), Excel (openpyxl) e PDF (fpdf2)."""

import csv
import io
from datetime import datetime

from fpdf import FPDF
from openpyxl import Workbook
from openpyxl.styles import Font

COLUNAS = [
    ("empresas", "Empresas"),
    ("projeto", "Projeto"),
    ("cliente", "Cliente"),
    ("receita", "Receita (R$)"),
    ("producao", "Produção (R$)"),
    ("frete", "Frete (R$)"),
    ("comissao", "Comissão (R$)"),
    ("imposto", "Impostos (R$)"),
    ("outros", "Outros (R$)"),
    ("custo_total", "Custo total (R$)"),
    ("resultado", "Resultado (R$)"),
    ("margem", "Margem (%)"),
]

# Dupla conferencia — colunas de texto, sempre DEPOIS das numericas (o formato
# de moeda/percentual do Excel e aplicado por posicao nas 12 primeiras).
COLUNAS_CONFERENCIA = [
    "Conferência",
    "1º ok (conferiu)",
    "Conferido em",
    "2º ok (aprovou)",
    "Aprovado em",
    "Mudou após conferência",
]

_STATUS_LEGIVEL = {
    "pendente": "Pendente",
    "conferido": "Conferido (falta aprovar)",
    "aprovado": "Conferido e aprovado",
}


def _data_hora_pt(iso: str | None) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return str(iso)


def _valores_conferencia(linha: dict) -> list[str]:
    conf = linha.get("conferencia") or {}
    return [
        _STATUS_LEGIVEL.get(conf.get("status", ""), "Pendente"),
        conf.get("conferido_por") or "",
        _data_hora_pt(conf.get("conferido_em")),
        conf.get("aprovado_por") or "",
        _data_hora_pt(conf.get("aprovado_em")),
        "Sim" if conf.get("divergente") else "",
    ]


def _conf_curto(linha: dict) -> str:
    """Marca compacta do PDF: '-', '1/2', '2/2' — com '!' se mudou depois do ok.

    Sem travessao nem simbolo de alerta: o PDF usa fontes core (Latin-1) e eles
    virariam '?'.
    """
    conf = linha.get("conferencia") or {}
    oks = int(conf.get("oks") or 0)
    marca = f"{oks}/2" if oks else "-"
    return f"{marca} !" if conf.get("divergente") else marca


def _valor_pt_br(campo: str, valor) -> str:
    if campo == "margem":
        return f"{valor * 100:.2f}".replace(".", ",")
    if isinstance(valor, (int, float)) and campo not in ("empresa_id", "codigo_projeto"):
        return f"{valor:.2f}".replace(".", ",")
    return str(valor)


def fechamento_csv(projetos: list[dict], consolidado: dict) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow([titulo for _, titulo in COLUNAS] + COLUNAS_CONFERENCIA)
    for linha in projetos:
        writer.writerow(
            [_valor_pt_br(campo, linha.get(campo, "")) for campo, _ in COLUNAS] + _valores_conferencia(linha)
        )
    writer.writerow([])
    writer.writerow(
        ["TOTAL", "", ""]
        + [
            _valor_pt_br(campo, consolidado.get("margem_media" if campo == "margem" else campo, 0))
            for campo, _ in COLUNAS[3:]
        ]
        + [f"{consolidado.get('qtd_pendentes', 0)} pendente(s)"]
        + [""] * (len(COLUNAS_CONFERENCIA) - 1)
    )
    return buffer.getvalue()


def _pdf_txt(valor) -> str:
    """fpdf2 com fontes core usa Latin-1; substitui o que nao couber."""
    return str(valor).encode("latin-1", "replace").decode("latin-1")


def _moeda_pt(valor: float) -> str:
    inteiro, decimal = f"{abs(valor):,.2f}".split(".")
    inteiro = inteiro.replace(",", ".")
    sinal = "-" if valor < 0 else ""
    return f"{sinal}{inteiro},{decimal}"


def fechamento_pdf(projetos: list[dict], consolidado: dict, subtitulo: str = "") -> bytes:
    """Relatorio de fechamento em PDF (A4 paisagem, uma linha por projeto)."""
    pdf = FPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, _pdf_txt("Fechamento de Projetos"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(90, 90, 90)
    gerado = datetime.now().strftime("%d/%m/%Y %H:%M")
    linha_sub = f"{subtitulo} - gerado em {gerado}" if subtitulo else f"Gerado em {gerado}"
    pdf.cell(0, 5, _pdf_txt(linha_sub), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    colunas = [
        ("projeto", "Projeto", 38, "L"),
        ("empresas", "Empresas", 26, "L"),
        ("cliente", "Cliente", 34, "L"),
        ("receita", "Receita", 25, "R"),
        ("producao", "Produção", 23, "R"),
        ("frete", "Frete", 17, "R"),
        ("comissao", "Comissão", 20, "R"),
        ("imposto", "Impostos", 23, "R"),
        ("outros", "Outros", 17, "R"),
        ("resultado", "Resultado", 25, "R"),
        ("margem", "Margem", 14, "R"),
        ("_conf", "Conf.", 13, "C"),  # dupla conferencia: -, 1/2, 2/2 (! = mudou depois)
    ]

    def cabecalho():
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(235, 235, 232)
        pdf.set_text_color(30, 30, 30)
        for _, titulo, largura, alinh in colunas:
            pdf.cell(largura, 6.5, _pdf_txt(titulo), border="B", align=alinh, fill=True)
        pdf.ln()

    cabecalho()
    pdf.set_font("Helvetica", "", 8)
    for i, linha in enumerate(projetos):
        if pdf.get_y() > 185:  # nova pagina com cabecalho
            pdf.add_page()
            cabecalho()
            pdf.set_font("Helvetica", "", 8)
        if i % 2 == 1:
            pdf.set_fill_color(248, 248, 246)
        preenche = i % 2 == 1
        negativo = linha.get("resultado", 0) < 0
        for campo, _, largura, alinh in colunas:
            valor = linha.get(campo, "")
            if campo == "_conf":
                pdf.set_text_color(30, 30, 30)
                pdf.cell(largura, 6, _pdf_txt(_conf_curto(linha)), border="B", align=alinh, fill=preenche)
                continue
            if campo == "margem":
                texto = f"{valor * 100:.1f}%".replace(".", ",")
            elif isinstance(valor, (int, float)):
                texto = _moeda_pt(float(valor))
            else:
                texto = str(valor)
                max_chars = int(largura / 1.6)
                if len(texto) > max_chars:
                    texto = texto[: max_chars - 1] + "…"
            if campo in ("resultado", "margem") and negativo:
                pdf.set_text_color(180, 40, 40)
            else:
                pdf.set_text_color(30, 30, 30)
            pdf.cell(largura, 6, _pdf_txt(texto), border="B", align=alinh, fill=preenche)
        pdf.ln()

    # total
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_text_color(30, 30, 30)
    totais = {
        "projeto": "TOTAL (projetos)",
        "empresas": "",
        "cliente": "",
        "receita": consolidado.get("receita", 0),
        "producao": consolidado.get("producao", 0),
        "frete": consolidado.get("frete", 0),
        "comissao": consolidado.get("comissao", 0),
        "imposto": consolidado.get("imposto", 0),
        "outros": consolidado.get("outros", 0),
        "resultado": consolidado.get("resultado", 0),
        "margem": consolidado.get("margem_media", 0),
        "_conf": f"{consolidado.get('qtd_aprovados', 0)}/{len(projetos)}",
    }
    for campo, _, largura, alinh in colunas:
        valor = totais.get(campo, "")
        if campo == "margem":
            texto = f"{valor * 100:.1f}%".replace(".", ",")
        elif isinstance(valor, (int, float)):
            texto = _moeda_pt(float(valor))
        else:
            texto = str(valor)
        pdf.cell(largura, 7, _pdf_txt(texto), border="T", align=alinh)
    pdf.ln()
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(
        0,
        5,
        _pdf_txt(
            "Valores em R$. Margem = resultado / receita. Somente projetos de venda (numeração BR). "
            "Conf. = dupla conferência (1/2 conferido, 2/2 aprovado; ! = números mudaram depois do ok)."
        ),
    )

    return bytes(pdf.output())


def fechamento_xlsx(projetos: list[dict], consolidado: dict) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Fechamento"
    ws.append([titulo for _, titulo in COLUNAS] + COLUNAS_CONFERENCIA)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    formato_moeda = 'R$ #,##0.00'
    for linha in projetos:
        ws.append(
            [
                linha.get(campo, "") if campo in ("empresas", "projeto", "cliente") else float(linha.get(campo, 0))
                for campo, _ in COLUNAS
            ]
            + _valores_conferencia(linha)
        )
    total_row = (
        ["TOTAL", "", ""]
        + [float(consolidado.get("margem_media" if campo == "margem" else campo, 0)) for campo, _ in COLUNAS[3:]]
        + [f"{consolidado.get('qtd_pendentes', 0)} pendente(s)"]
        + [""] * (len(COLUNAS_CONFERENCIA) - 1)
    )
    ws.append(total_row)
    for cell in ws[ws.max_row]:
        cell.font = Font(bold=True)

    for row in ws.iter_rows(min_row=2):
        for cell in row[3:11]:
            cell.number_format = formato_moeda
        row[11].number_format = "0.00%"

    larguras = [24, 18, 28, 16, 16, 14, 15, 16, 14, 16, 16, 12, 24, 20, 18, 20, 18, 22]
    for idx, largura in enumerate(larguras, start=1):
        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = largura

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
