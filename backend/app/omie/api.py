"""Wrappers tipados dos metodos da Omie usados pelo app.

Nomes de campos/parametros confirmados na documentacao oficial de cada servico.
"""

from datetime import date

from .client import OmieClient, OmieNoRecordsError


def _fmt(d: date | None) -> str | None:
    return d.strftime("%d/%m/%Y") if d else None


def _periodo_emissao(param: dict, de: date | None, ate: date | None, campo_de: str, campo_ate: str) -> dict:
    if de:
        param[campo_de] = _fmt(de)
    if ate:
        param[campo_ate] = _fmt(ate)
    return param


def listar_projetos(client: OmieClient) -> list[dict]:
    return list(client.paginate("geral/projetos", "ListarProjetos", {}, list_keys=("cadastro",)))


def listar_contas_receber(client: OmieClient, emissao_de: date | None = None, emissao_ate: date | None = None) -> list[dict]:
    param = _periodo_emissao({}, emissao_de, emissao_ate, "filtrar_por_emissao_de", "filtrar_por_emissao_ate")
    return list(
        client.paginate("financas/contareceber", "ListarContasReceber", param, list_keys=("conta_receber_cadastro",))
    )


def listar_contas_pagar(client: OmieClient, emissao_de: date | None = None, emissao_ate: date | None = None) -> list[dict]:
    param = _periodo_emissao({}, emissao_de, emissao_ate, "filtrar_por_emissao_de", "filtrar_por_emissao_ate")
    return list(
        client.paginate("financas/contapagar", "ListarContasPagar", param, list_keys=("conta_pagar_cadastro",))
    )


def listar_nfs(client: OmieClient, emissao_de: date | None = None, emissao_ate: date | None = None) -> list[dict]:
    """NF-e de produto EMITIDAS (tpNF=1), com detalhes do pedido (traz nIdProjeto e titulos)."""
    param: dict = {"tpNF": 1, "cDetalhesPedido": "S", "cApenasResumo": "N"}
    param = _periodo_emissao(param, emissao_de, emissao_ate, "dEmiInicial", "dEmiFinal")
    return list(client.paginate("produtos/nfconsultar", "ListarNF", param, list_keys=("nfCadastro",)))


def listar_clientes_resumido(client: OmieClient) -> list[dict]:
    return list(
        client.paginate("geral/clientes", "ListarClientesResumido", {}, list_keys=("clientes_cadastro_resumido",))
    )


def listar_categorias(client: OmieClient) -> list[dict]:
    return list(client.paginate("geral/categorias", "ListarCategorias", {}, list_keys=("categoria_cadastro",)))


def testar_conexao(client: OmieClient) -> dict:
    """Chamada minima para validar credenciais; retorna contagem de projetos."""
    try:
        data = client.call("geral/projetos", "ListarProjetos", {"pagina": 1, "registros_por_pagina": 1})
    except OmieNoRecordsError:
        return {"ok": True, "total_projetos": 0}
    return {"ok": True, "total_projetos": int(data.get("total_de_registros") or 0)}
