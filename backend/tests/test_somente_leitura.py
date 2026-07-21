"""Garantia: a integracao com a Omie e 100% LEITURA.

O requisito do negocio e que o app nunca faca input na Omie — so busque dados.
Este teste inspeciona o modulo de wrappers e falha se qualquer chamada usar um
metodo fora da whitelist de consulta (Listar*/Consultar*/Pesquisar*).
"""

import re
from pathlib import Path

METODOS_PERMITIDOS = {
    "ListarProjetos",
    "ListarContasReceber",
    "ListarContasPagar",
    "ListarNF",
    "ListarClientesResumido",
    "ListarCategorias",
    "ListarVendedores",
    # Pedido de compra: a Omie nomeia a CONSULTA como "Pesquisar" (nao "Listar").
    # Continua sendo leitura pura — os metodos de escrita desse servico sao
    # Incluir/Alterar/Excluir/UpsertPedCompra, barrados pelo teste abaixo.
    "PesquisarPedCompra",
}

API_PY = Path(__file__).resolve().parent.parent / "app" / "omie" / "api.py"


def _metodos_usados() -> set[str]:
    codigo = API_PY.read_text(encoding="utf-8")
    # captura o 2o argumento string de client.call(...) e client.paginate(...)
    return set(re.findall(r"""client\.(?:call|paginate)\(\s*[^,]+,\s*["']([^"']+)["']""", codigo))


def test_toda_chamada_omie_e_de_consulta():
    usados = _metodos_usados()
    assert usados, "nenhuma chamada Omie encontrada — o padrao do teste quebrou?"
    proibidos = usados - METODOS_PERMITIDOS
    assert not proibidos, (
        f"Metodos fora da whitelist de LEITURA: {proibidos}. "
        "A integracao com a Omie deve apenas buscar dados (Listar*), nunca gravar."
    )


def test_nenhum_metodo_de_escrita_no_codigo():
    codigo = API_PY.read_text(encoding="utf-8")
    escrita = re.findall(r"""["']((?:Incluir|Alterar|Excluir|Upsert|Cancelar|Lancar|Baixar)\w*)["']""", codigo)
    assert not escrita, f"Metodos de escrita detectados no cliente Omie: {escrita}"
