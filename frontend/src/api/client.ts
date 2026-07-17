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
  comissao: number
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
  comissao: number
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
  comissao: number
  origem_aliquota: string
  preco_minimo: number | null
  com_preco_informado?: { imposto: number; comissao: number; resultado: number; margem: number }
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

export interface UsuarioLogado {
  id: number
  nome: string
  email: string
  papel: 'admin' | 'financeiro' | 'leitura' | 'comercial'
  ativo: boolean
}

export function tokenAtual(): string {
  return localStorage.getItem('token') || ''
}

export function usuarioLogado(): UsuarioLogado | null {
  try {
    return JSON.parse(localStorage.getItem('usuario_logado') || 'null')
  } catch {
    return null
  }
}

export function guardarSessao(token: string, usuario: UsuarioLogado): void {
  localStorage.setItem('token', token)
  localStorage.setItem('usuario_logado', JSON.stringify(usuario))
}

export function limparSessao(): void {
  localStorage.removeItem('token')
  localStorage.removeItem('usuario_logado')
}

export function usuarioAtual(): string {
  return usuarioLogado()?.nome || ''
}

function cabecalhos(extra?: HeadersInit): HeadersInit {
  const token = tokenAtual()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, { ...init, headers: cabecalhos(init?.headers) })
  if (resp.status === 401 && !path.startsWith('/api/auth/')) {
    limparSessao()
    window.dispatchEvent(new Event('sessao-expirada'))
  }
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

// ===================== Precificação (orçamentos do comercial) =====================

export interface EmpresaFaturamento {
  id: number
  nome: string
  regime: 'nota' | 'simples'
}

export interface OpcoesPrecificacao {
  produtos: { id: number; nome: string; categoria: string; custo_base: number }[]
  acabamentos: string[]
  locais: { local: string; aliquota: number; regime: string | null }[]
  parametros: {
    margem_padrao: number
    comissao_padrao: number
    custo_fixo_padrao: number
    juros_mes: number
    prazo_padrao: number
  }
}

export interface EntradaCalculo {
  produto_id?: number | null
  quantidade: number
  acabamento: string
  empresa_faturamento_id: number
  local_faturamento?: string | null
  condicao_pagamento_dias: number
  margem?: number | null
  comissao?: number | null
  custo_fixo?: number | null
  porta_copo?: boolean
  extras?: { nome: string; valor: number }[]
}

export interface ResultadoCalculo {
  quantidade: number
  custo_unitario: number
  componentes: { nome: string; grupo: string; valor: number }[]
  fator_venda: number
  aliquota_imposto: number
  margem: number
  comissao: number
  custo_fixo: number
  preco_a_vista: number
  custo_financeiro_unitario: number
  preco_a_prazo: number
  imposto_unitario: number
  total_a_vista: number
  total_a_prazo: number
  total: number
  margem_valor_unitario: number
  aviso: string
  empresa: string
  regime: string
  local_faturamento: string
}

export interface Comparacao {
  cenarios: {
    empresa_id: number
    empresa: string
    regime: string
    aliquota_imposto: number
    preco_a_vista: number
    preco_a_prazo: number
    total: number
  }[]
  melhor_empresa_id: number | null
  economia: number
}

export interface OrcamentoVenda {
  id: number
  numero: string
  cliente: string
  empresa: string
  empresa_faturamento_id: number | null
  status: 'rascunho' | 'enviado' | 'aprovado'
  quantidade: number
  preco_unitario: number
  total: number
  condicao: string
  condicao_pagamento_dias: number
  criado_por: string
  criado_em: string | null
}

export interface OrcamentoVendaDetalhe extends OrcamentoVenda {
  snapshot: { itens: ResultadoCalculo[]; entradas: EntradaCalculo[]; total: number }
  itens: { descricao: string; quantidade: number; acabamento: string; preco_unitario: number; total: number }[]
}

export interface ResumoOrcamentos {
  orcamentos_mes: number
  total_mes: number
  ticket_medio: number
  margem_media: number
  por_status: Record<string, number>
  ranking_produtos: { produto: string; orcamentos: number; total: number }[]
}

export interface FaixaLabel {
  quantidade_min: number
  preco_unitario: number
}

/** Baixa um arquivo via fetch (aguenta cold start do servidor, ao contrário do download nativo). */
export async function baixarArquivo(url: string, nomeFallback: string): Promise<void> {
  const resp = await fetch(url, { headers: cabecalhos() })
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
  // Autenticação
  precisaSetup: () => request<{ precisa_setup: boolean }>('/api/auth/precisa-setup'),
  setup: (dados: { nome: string; email: string; senha: string }) =>
    request<{ token: string; usuario: UsuarioLogado }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(dados) }),
  login: (email: string, senha: string) =>
    request<{ token: string; usuario: UsuarioLogado }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  eu: () => request<UsuarioLogado>('/api/auth/eu'),
  listarUsuarios: () => request<UsuarioLogado[]>('/api/usuarios'),
  criarUsuario: (dados: { nome: string; email: string; senha: string; papel: string }) =>
    request<UsuarioLogado>('/api/usuarios', { method: 'POST', body: JSON.stringify(dados) }),
  atualizarUsuario: (id: number, dados: Partial<{ nome: string; papel: string; ativo: boolean; senha: string }>) =>
    request<UsuarioLogado>(`/api/usuarios/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),

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
  simular: (custo: number, margemAlvo: number, preco?: number, comissao?: number) =>
    request<Simulacao>(
      `/api/analises/simulador${qs({
        custo: String(custo),
        margem_alvo: String(margemAlvo),
        preco: preco ? String(preco) : undefined,
        comissao: comissao ? String(comissao) : undefined,
      })}`,
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

  // ===================== Precificação =====================
  precificacaoEmpresas: () => request<EmpresaFaturamento[]>('/api/precificacao/empresas'),
  precificacaoOpcoes: () => request<OpcoesPrecificacao>('/api/precificacao/opcoes'),
  precificacaoCalcular: (dados: EntradaCalculo) =>
    request<ResultadoCalculo>('/api/precificacao/calcular', { method: 'POST', body: JSON.stringify(dados) }),
  precificacaoComparar: (dados: EntradaCalculo) =>
    request<Comparacao>('/api/precificacao/comparar', { method: 'POST', body: JSON.stringify(dados) }),

  // Cadastros de precificação (admin/financeiro)
  criarProduto: (dados: { nome: string; categoria: string; custo_base: number; ativo: boolean }) =>
    request<{ id: number }>('/api/precificacao/produtos', { method: 'POST', body: JSON.stringify(dados) }),
  editarProduto: (id: number, dados: { nome: string; categoria: string; custo_base: number; ativo: boolean }) =>
    request<{ ok: boolean }>(`/api/precificacao/produtos/${id}`, { method: 'PUT', body: JSON.stringify(dados) }),
  excluirProduto: (id: number) => request<{ ok: boolean }>(`/api/precificacao/produtos/${id}`, { method: 'DELETE' }),
  listarTabelasLabel: () =>
    request<{ acabamento: string; faixas: FaixaLabel[] }[]>('/api/precificacao/tabelas-label'),
  salvarTabelaLabel: (acabamento: string, faixas: FaixaLabel[]) =>
    request<{ ok: boolean }>('/api/precificacao/tabelas-label', {
      method: 'PUT',
      body: JSON.stringify({ acabamento, faixas }),
    }),
  salvarAliquota: (local: string, aliquota: number) =>
    request<{ ok: boolean }>('/api/precificacao/tabelas-aliquota', {
      method: 'PUT',
      body: JSON.stringify({ local, aliquota }),
    }),
  salvarParametrosPrecificacao: (dados: {
    margem_padrao: number
    comissao_padrao: number
    custo_fixo_padrao: number
    juros_mes: number
    prazo_padrao: number
  }) => request<{ ok: boolean }>('/api/precificacao/parametros', { method: 'PUT', body: JSON.stringify(dados) }),

  // Orçamentos de venda
  criarOrcamentoVenda: (dados: { numero?: string; cliente: string; itens: (EntradaCalculo & { descricao?: string })[] }) =>
    request<{ id: number; numero: string; total: number; status: string }>('/api/orcamentos-venda', {
      method: 'POST',
      body: JSON.stringify(dados),
    }),
  listarOrcamentosVenda: (filtros: { cliente?: string; empresa_id?: string; status?: string; de?: string; ate?: string }) =>
    request<OrcamentoVenda[]>(`/api/orcamentos-venda${qs(filtros)}`),
  detalheOrcamentoVenda: (id: number) => request<OrcamentoVendaDetalhe>(`/api/orcamentos-venda/${id}`),
  mudarStatusOrcamento: (id: number, status: string) =>
    request<{ id: number; status: string }>(`/api/orcamentos-venda/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  excluirOrcamentoVenda: (id: number) => request<{ ok: boolean }>(`/api/orcamentos-venda/${id}`, { method: 'DELETE' }),
  resumoOrcamentos: () => request<ResumoOrcamentos>('/api/orcamentos-venda/resumo'),
  urlPdfOrcamento: (id: number) => `/api/orcamentos-venda/${id}/pdf`,
  urlExportOrcamentos: (formato: 'csv' | 'xlsx') => `/api/orcamentos-venda/export?formato=${formato}`,
}
