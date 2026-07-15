// Cliente tipado do backend. O frontend NUNCA fala com a Omie diretamente.

export interface Empresa {
  id: number
  nome: string
  cnpj: string
  regime: 'nota' | 'simples'
  simples_anexo: string | null
  aliquota_extra: number
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
  imposto_extra: number
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

export interface MesFechamento {
  mes: string // 'YYYY-MM'
  receita: number
  custos: number
  imposto: number
  resultado: number
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
  parcelas: { grupo: string | null; valor: number }[]
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

export interface Config {
  margem_alvo: number
  sync_auto: boolean
  sync_hora: number
}

export interface Alerta {
  gravidade: 'critica' | 'atencao'
  titulo: string
  detalhe: string
  projeto: string | null
}

export interface ClienteRanking {
  cliente: string
  receita: number
  resultado: number
  margem: number
  qtd_projetos: number
  projetos_prejuizo: number
  classe: 'A' | 'B' | 'C'
}

export interface VendedorRanking {
  vendedor: string
  receita: number
  resultado_atribuido: number
  margem_media: number
  qtd_projetos: number
}

export interface CaixaProjeto {
  projeto: string
  receber_aberto: number
  receber_atrasado: number
  pagar_aberto: number
  pagar_atrasado: number
  maior_atraso_dias: number
}

export interface Caixa {
  projetos: CaixaProjeto[]
  totais: { receber_aberto: number; receber_atrasado: number; pagar_aberto: number; pagar_atrasado: number }
}

export interface CenarioSimulacao {
  empresa_id: number
  empresa: string
  regime: string
  aliquota: number
  origem_aliquota: string
  preco_minimo: number | null
  com_preco_informado?: { imposto: number; resultado: number; margem: number }
}

export interface Simulacao {
  custo: number
  margem_alvo: number
  cenarios: CenarioSimulacao[]
  empresa_recomendada: string | null
}

export interface Orcamento {
  nome: string
  receita_prevista: number | null
  custo_previsto: number | null
  atualizado_por: string
  atualizado_em: string | null
}

export interface Aprovacao {
  id: number
  nome: string
  periodo_de: string | null
  periodo_ate: string | null
  dados: LinhaFechamento
  usuario: string
  criado_em: string
}

export interface Comentario {
  id: number
  texto: string
  usuario: string
  criado_em: string
}

export function usuarioAtual(): string {
  return localStorage.getItem('usuario') || ''
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // percent-encoding: headers so aceitam Latin-1; o backend decodifica (unquote)
      'X-Usuario': encodeURIComponent(usuarioAtual()),
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

/** Baixa um arquivo via fetch (aguenta cold start do servidor, ao contrário do download nativo). */
export async function baixarArquivo(url: string, nomeFallback: string): Promise<void> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const disposition = resp.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const nome = match ? match[1] : nomeFallback
  const blob = await resp.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
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
  fechamentoMensal: (empresaIds?: string, de?: string, ate?: string) =>
    request<MesFechamento[]>(`/api/fechamento/mensal${qs({ empresa_ids: empresaIds, de, ate })}`),
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

  // Configurações
  lerConfig: () => request<Config>('/api/config'),
  salvarConfig: (dados: Partial<Config>) => request<Config>('/api/config', { method: 'PUT', body: JSON.stringify(dados) }),

  // Análises
  alertas: (empresaIds?: string, de?: string, ate?: string) =>
    request<Alerta[]>(`/api/analises/alertas${qs({ empresa_ids: empresaIds, de, ate })}`),
  rankingClientes: (empresaIds?: string, de?: string, ate?: string) =>
    request<ClienteRanking[]>(`/api/analises/clientes${qs({ empresa_ids: empresaIds, de, ate })}`),
  rankingVendedores: (empresaIds?: string, de?: string, ate?: string) =>
    request<{ vendedores: VendedorRanking[]; receita_sem_vendedor: number }>(
      `/api/analises/vendedores${qs({ empresa_ids: empresaIds, de, ate })}`,
    ),
  caixa: (empresaIds?: string, de?: string, ate?: string) =>
    request<Caixa>(`/api/analises/caixa${qs({ empresa_ids: empresaIds, de, ate })}`),
  simular: (custo: number, margemAlvo: number, preco?: number) =>
    request<Simulacao>(
      `/api/analises/simulador${qs({ custo: String(custo), margem_alvo: String(margemAlvo), preco: preco ? String(preco) : undefined })}`,
    ),

  // Orçado × Realizado, aprovações e comentários
  obterOrcamento: (nome: string) => request<Orcamento>(`/api/orcamentos${qs({ nome })}`),
  salvarOrcamento: (dados: { nome: string; receita_prevista: number | null; custo_previsto: number | null }) =>
    request<Orcamento>('/api/orcamentos', { method: 'PUT', body: JSON.stringify(dados) }),
  aprovar: (dados: { nome: string; empresa_ids?: string; de?: string; ate?: string }) =>
    request<Aprovacao>('/api/aprovacoes', { method: 'POST', body: JSON.stringify(dados) }),
  listarAprovacoes: (nome: string) => request<Aprovacao[]>(`/api/aprovacoes${qs({ nome })}`),
  listarComentarios: (nome: string) => request<Comentario[]>(`/api/comentarios${qs({ nome })}`),
  comentar: (nome: string, texto: string) =>
    request<Comentario[]>('/api/comentarios', { method: 'POST', body: JSON.stringify({ nome, texto }) }),

  // Export (URLs para <a download>)
  urlExportCsv: (empresaIds?: string, de?: string, ate?: string) =>
    `/api/export/fechamento.csv${qs({ empresa_ids: empresaIds, de, ate })}`,
  urlExportXlsx: (empresaIds?: string, de?: string, ate?: string) =>
    `/api/export/fechamento.xlsx${qs({ empresa_ids: empresaIds, de, ate })}`,
  urlExportPdf: (empresaIds?: string, de?: string, ate?: string) =>
    `/api/export/fechamento.pdf${qs({ empresa_ids: empresaIds, de, ate })}`,
}
