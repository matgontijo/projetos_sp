// Cliente tipado do backend. O frontend NUNCA fala com a Omie diretamente.

export interface Empresa {
  id: number
  nome: string
  cnpj: string
  regime: 'nota' | 'simples'
  simples_anexo: string | null
  ativa: boolean
  criado_em: string
}

export interface TesteConexao {
  ok: boolean
  total_projetos: number | null
  erro: string | null
}

export interface SyncLog {
  id: number
  empresa_id: number
  recurso: string
  periodo_de: string | null
  periodo_ate: string | null
  status: 'executando' | 'concluido' | 'erro'
  mensagem: string
  iniciado_em: string
  concluido_em: string | null
  qtd_registros: number
}

export interface LinhaFechamento {
  projeto: string
  empresas: string // nomes das empresas que faturaram o projeto, separados por vírgula
  cliente: string
  receita: number
  producao: number
  frete: number
  outros: number
  imposto: number
  imposto_nfe: number
  imposto_simples: number
  cp_impostos: number
  nao_classificado: number
  custo_total: number
  resultado: number
  margem: number
  qtd_receber: number
  qtd_pagar: number
  qtd_nfe: number
}

export interface Consolidado {
  receita: number
  producao: number
  frete: number
  outros: number
  imposto: number
  cp_impostos: number
  nao_classificado: number
  custo_total: number
  resultado: number
  margem_media: number
  qtd_projetos: number
}

export interface Fechamento {
  projetos: LinhaFechamento[]
  consolidado: Consolidado
}

export interface TituloDetalhe {
  id: number
  empresa_id: number
  empresa_nome: string
  tipo: 'receber' | 'pagar'
  codigo_lancamento_omie: number
  data_emissao: string | null
  data_vencimento: string | null
  valor_documento: number
  codigo_categoria: string
  grupo: string | null
  grupo_ajustado: boolean
  status_titulo: string
  numero_documento: string
  numero_documento_fiscal: string
  cancelado: boolean
  excluido: boolean
  projeto_ajustado: boolean
}

export interface NFeDetalhe {
  id: number
  empresa_id: number
  empresa_nome: string
  n_nf: string
  serie: string
  d_emi: string | null
  dest_nome: string
  v_nf: number
  v_prod: number
  v_icms: number
  v_st: number
  v_fcp: number
  v_ipi: number
  v_pis: number
  v_cofins: number
  v_ibs_cbs: number
  imposto_total: number
  imposto_ajustado: boolean
  cancelada: boolean
  excluida: boolean
  projeto_ajustado: boolean
}

export interface Ajuste {
  id: number
  alvo_tipo: 'titulo' | 'nfe'
  alvo_id: number
  campo: string
  valor_anterior: string
  valor_novo: string
  motivo: string
  usuario: string
  criado_em: string
}

export interface DetalheProjeto {
  fechamento: LinhaFechamento | null
  titulos: TituloDetalhe[]
  nfes: NFeDetalhe[]
  ajustes: Ajuste[]
}

export interface CategoriaGrupo {
  id: number
  empresa_id: number
  codigo_categoria: string
  descricao: string
  grupo: string | null
}

export function usuarioAtual(): string {
  return localStorage.getItem('usuario') || ''
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Usuario': usuarioAtual(),
      ...init?.headers,
    },
  })
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`
    try {
      const body = await resp.json()
      if (body.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* corpo nao-JSON */
    }
    throw new Error(detail)
  }
  if (resp.status === 204) return undefined as T
  return resp.json()
}

function qs(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v)
  if (!pairs.length) return ''
  return '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
}

export const api = {
  // Empresas
  listarEmpresas: () => request<Empresa[]>('/api/empresas'),
  criarEmpresa: (dados: object) => request<Empresa>('/api/empresas', { method: 'POST', body: JSON.stringify(dados) }),
  atualizarEmpresa: (id: number, dados: object) =>
    request<Empresa>(`/api/empresas/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  excluirEmpresa: (id: number) => request<void>(`/api/empresas/${id}`, { method: 'DELETE' }),
  testarConexao: (id: number) => request<TesteConexao>(`/api/empresas/${id}/testar-conexao`, { method: 'POST' }),

  // Simples
  listarSimples: (empresaId: number) =>
    request<{ competencia: string; rbt12: number | null }[]>(`/api/empresas/${empresaId}/simples`),
  salvarSimples: (empresaId: number, periodos: { competencia: string; rbt12: number | null }[]) =>
    request(`/api/empresas/${empresaId}/simples`, { method: 'PUT', body: JSON.stringify(periodos) }),

  // Sync
  iniciarSync: (empresaIds: number[], de: string, ate: string) =>
    request('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ empresa_ids: empresaIds, data_de: de, data_ate: ate }),
    }),
  listarLogs: (empresaId?: number) => request<SyncLog[]>(`/api/sync/logs${qs({ empresa_id: empresaId?.toString() })}`),

  // Fechamento
  fechamento: (empresaIds?: string, de?: string, ate?: string) =>
    request<Fechamento>(`/api/fechamento${qs({ empresa_ids: empresaIds, de, ate })}`),
  detalheProjeto: (nome: string, empresaIds?: string, de?: string, ate?: string) =>
    request<DetalheProjeto>(`/api/projetos/detalhe${qs({ nome, empresa_ids: empresaIds, de, ate })}`),

  // Categorias
  listarCategorias: (empresaId: number) =>
    request<CategoriaGrupo[]>(`/api/categorias?empresa_id=${empresaId}`),
  salvarCategorias: (empresaId: number, itens: { codigo_categoria: string; grupo: string | null }[]) =>
    request<CategoriaGrupo[]>(`/api/categorias/${empresaId}`, { method: 'PUT', body: JSON.stringify(itens) }),

  // Ajustes
  criarAjuste: (dados: {
    empresa_id: number
    alvo_tipo: 'titulo' | 'nfe'
    alvo_id: number
    campo: string
    valor_novo: string
    motivo: string
  }) => request<Ajuste>('/api/ajustes', { method: 'POST', body: JSON.stringify(dados) }),

  // Export (URLs para <a download>)
  urlExportCsv: (empresaIds?: string, de?: string, ate?: string) =>
    `/api/export/fechamento.csv${qs({ empresa_ids: empresaIds, de, ate })}`,
  urlExportXlsx: (empresaIds?: string, de?: string, ate?: string) =>
    `/api/export/fechamento.xlsx${qs({ empresa_ids: empresaIds, de, ate })}`,
}
