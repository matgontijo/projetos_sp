"""Identidade do Grupo JPDV nos documentos gerados (PDF e planilha).

O logotipo e DESENHADO COM TEXTO, na fonte pesada que os PDFs ja embutem: sai
nitido em qualquer impressora, nao depende de arquivo de imagem no servidor e
acompanha o tamanho pedido. A paleta e a mesma do app — preto e branco, com
verde/vermelho reservados para lucro e prejuizo (ali a cor e informacao).
"""

# --- paleta dos PDFs (RGB) ---
PRETO = (10, 10, 10)  # o preto do logotipo
TINTA = (18, 18, 18)  # texto corrido
CINZA = (110, 110, 105)  # rotulos e apoio
CLARO = (170, 170, 164)  # texto secundario SOBRE o preto
FIO = (228, 228, 224)  # linhas finas
ZEBRA = (248, 248, 246)  # linha alternada das tabelas
BRANCO = (255, 255, 255)
VERDE = (14, 122, 62)  # lucro
VERMELHO = (183, 42, 42)  # prejuizo

# --- os mesmos tons para a planilha (openpyxl usa hex sem '#') ---
PRETO_XL = "0A0A0A"
CINZA_XL = "6E6E69"
FIO_XL = "E4E4E0"
ZEBRA_XL = "F8F8F6"

from .config import settings

# A marca vem do ambiente (MARCA_LINHA1/MARCA_LINHA2) para o mesmo codigo servir
# a outros clientes; sem configurar nada, continua Grupo JPDV.
LINHA1 = settings.marca_linha1.strip() or "GRUPO"
LINHA2 = settings.marca_linha2.strip() or "JPDV"
NOME = f"{LINHA1.capitalize()} {LINHA2}"


def desenhar_logotipo(pdf, x: float, y: float, tamanho: float = 16, cor=BRANCO) -> float:
    """Escreve o logotipo (linha 1 / linha 2) a partir do canto (x, y) em mm.

    `tamanho` e o corpo da linha de baixo em pontos; a de cima acompanha em escala.
    Devolve a largura ocupada, para quem precisa posicionar algo ao lado.
    """
    pdf.set_text_color(*cor)

    # linha de cima: pequena e espacada
    corpo_grupo = tamanho * 0.34
    pdf.set_font("ManropeX", "", corpo_grupo)
    pdf.set_char_spacing(tamanho * 0.055)
    pdf.set_xy(x, y)
    pdf.cell(0, corpo_grupo * 0.42, LINHA1.upper())
    pdf.set_char_spacing(0)

    # linha de baixo: pesada e grande
    pdf.set_font("ManropeX", "", tamanho)
    pdf.set_xy(x, y + corpo_grupo * 0.46)
    largura = pdf.get_string_width(LINHA2.upper())
    pdf.cell(largura, tamanho * 0.42, LINHA2.upper())
    return largura
