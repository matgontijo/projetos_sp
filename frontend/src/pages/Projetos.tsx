import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, baixarArquivo, type LinhaFechamento } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { BadgeMeta, BarraComposicao, ChipsEmpresas, LegendaSeries, Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

type CampoOrdenavel = 'projeto' | 'receita' | 'producao' | 'frete' | 'comissao' | 'imposto' | 'outros' | 'resultado' | 'margem'

/** Filtros da dupla conferência — é por aqui que elas tocam a rotina de conferir. */
const FILTROS_CONFERENCIA = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'conferido', rotulo: 'Falta o 2º ok' },
  { id: 'aprovado', rotulo: 'Conferidos' },
  { id: 'divergente', rotulo: 'Mudou depois do ok' },
] as const
type FiltroConferencia = (typeof FILTROS_CONFERENCIA)[number]['id']

/** Selo compacto do status de conferência na lista. */
function SeloConferencia({ p }: { p: LinhaFechamento }) {
  const conf = p.conferencia
  if (!conf) return null
  const base = 'rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap'
  if (conf.status === 'pendente') {
    return (
      <span className={base} style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title="Ninguém conferiu ainda">
        —
      </span>
    )
  }
  const aprovado = conf.status === 'aprovado'
  const titulo = aprovado
    ? `Conferido por ${conf.conferido_por} · aprovado por ${conf.aprovado_por}`
    : `Conferido por ${conf.conferido_por} — falta o 2º ok`
  return (
    <span
      className={base}
      title={conf.divergente ? `${titulo}. Atenção: os números mudaram depois do ok.` : titulo}
      style={{
        background: conf.divergente
          ? 'color-mix(in srgb, var(--status-warning) 22%, transparent)'
          : aprovado
            ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
            : 'color-mix(in srgb, var(--status-warning) 18%, transparent)',
        color: aprovado && !conf.divergente ? 'var(--status-good-text)' : 'var(--text-primary)',
      }}
    >
      {conf.divergente ? '⚠ ' : ''}
      {conf.oks}/2
    </span>
  )
}

/** Botão de exportação que baixa via fetch: aguenta o servidor gratuito acordando
 * (~1 min) e mostra erro de verdade — o download nativo do navegador desistia. */
function BotaoExport({ rotulo, url, nome, primario = false }: { rotulo: string; url: string; nome: string; primario?: boolean }) {
  const [estado, setEstado] = useState<'pronto' | 'gerando' | 'erro'>('pronto')

  async function baixar() {
    setEstado('gerando')
    try {
      await baixarArquivo(url, nome)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  return (
    <button
      className={primario ? 'btn btn-primary' : 'btn btn-ghost'}
      disabled={estado === 'gerando'}
      onClick={baixar}
      title={estado === 'gerando' ? 'Gerando o relatório — no servidor gratuito pode levar até 1 minuto' : undefined}
      style={estado === 'erro' ? { color: 'var(--neg)', borderColor: 'var(--neg)' } : undefined}
    >
      {estado === 'gerando' ? 'Gerando…' : estado === 'erro' ? `${rotulo} — falhou, tentar de novo` : rotulo}
    </button>
  )
}

export default function Projetos() {
  const { empresaIds, de, ate, params, set } = useFiltros()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: api.lerConfig })
  const margemAlvo = (config?.margem_alvo ?? 20) / 100

  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  // o filtro de conferência mora na URL: o Dashboard linka direto para "pendentes"
  // e voltar do detalhe do projeto devolve a lista como estava
  const confDaUrl = params.get('conf') || 'todos'
  const filtroConf = (FILTROS_CONFERENCIA.some((f) => f.id === confDaUrl) ? confDaUrl : 'todos') as FiltroConferencia
  const setFiltroConf = (id: FiltroConferencia) => set('conf', id === 'todos' ? '' : id)
  const [ordem, setOrdem] = useState<{ campo: CampoOrdenavel; desc: boolean }>({ campo: 'receita', desc: true })

  function ordenarPor(campo: CampoOrdenavel) {
    setOrdem((o) => ({ campo, desc: o.campo === campo ? !o.desc : true }))
  }

  const todos = data?.projetos || []
  const porBusca = busca
    ? todos.filter((p) =>
        `${p.projeto} ${p.cliente} ${p.empresas}`.toLowerCase().includes(busca.toLowerCase()),
      )
    : todos
  const filtrados =
    filtroConf === 'todos'
      ? porBusca
      : porBusca.filter((p) =>
          filtroConf === 'divergente' ? p.conferencia?.divergente : p.conferencia?.status === filtroConf,
        )
  const projetos = [...filtrados].sort((a, b) => {
    const va = a[ordem.campo]
    const vb = b[ordem.campo]
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb)
    return ordem.desc ? -cmp : cmp
  })

  const Th = ({ campo, children, numerica = true }: { campo: CampoOrdenavel; children: React.ReactNode; numerica?: boolean }) => (
    <th
      className={`ordenavel ${numerica ? 'num' : ''}`}
      onClick={() => ordenarPor(campo)}
      title="Clique para ordenar"
    >
      {children} {ordem.campo === campo ? (ordem.desc ? '▾' : '▴') : ''}
    </th>
  )

  const abrir = (p: LinhaFechamento) => navigate(`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`)

  return (
    <div>
      <PageHeader
        titulo="Projetos"
        subtitulo="Só projetos de venda (numeração BR) — clique na linha para abrir o detalhe"
        acoes={
          <>
            <BotaoExport rotulo="Exportar PDF" url={api.urlExportPdf(empresaIds, de, ate)} nome="fechamento.pdf" primario />
            <BotaoExport rotulo="CSV" url={api.urlExportCsv(empresaIds, de, ate)} nome="fechamento.csv" />
            <BotaoExport rotulo="Excel" url={api.urlExportXlsx(empresaIds, de, ate)} nome="fechamento.xlsx" />
          </>
        }
      />
      <FiltrosBar />
      {error && (
        <p className="mb-3 text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar o fechamento: {(error as Error).message}
        </p>
      )}
      <div className="card">
        <div className="card-head">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="input w-64"
              placeholder="Buscar projeto ou cliente…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por conferência">
              {FILTROS_CONFERENCIA.map((op) => {
                const ativo = filtroConf === op.id
                return (
                  <button
                    key={op.id}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold"
                    onClick={() => setFiltroConf(op.id)}
                    style={{
                      background: ativo ? 'var(--accent)' : 'var(--surface-2)',
                      color: ativo ? 'var(--surface-1)' : 'var(--text-muted)',
                    }}
                  >
                    {op.rotulo}
                    {op.id === 'pendente' && (data?.consolidado.qtd_pendentes ?? 0) > 0
                      ? ` (${data!.consolidado.qtd_pendentes})`
                      : ''}
                  </button>
                )
              })}
            </div>
            {(busca || filtroConf !== 'todos') && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {projetos.length} de {todos.length}
              </span>
            )}
          </div>
          <div className="acoes">
            <LegendaSeries />
          </div>
        </div>
        <div className="tabela-wrap">
        <table className="data">
          <thead>
            <tr>
              <Th campo="projeto" numerica={false}>Projeto</Th>
              <th>Empresas</th>
              <th>Cliente</th>
              <Th campo="receita">Receita</Th>
              <Th campo="producao">Produção</Th>
              <Th campo="frete">Frete</Th>
              <Th campo="imposto">Impostos</Th>
              <Th campo="comissao">Comissão</Th>
              <Th campo="outros">Outros</Th>
              <Th campo="resultado">Resultado</Th>
              <Th campo="margem">Margem</Th>
              <th style={{ minWidth: 140 }}>Composição</th>
              <th>Status</th>
              <th title="Dupla conferência: 1/2 conferido, 2/2 conferido e aprovado">Conf.</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [1, 2, 3, 4, 5, 6].map((i) => (
                <tr key={i}>
                  <td colSpan={14}>
                    <Skeleton altura={18} />
                  </td>
                </tr>
              ))}
            {!isLoading && !error && projetos.length === 0 && (
              <tr>
                <td colSpan={14} style={{ color: 'var(--text-muted)' }}>
                  {filtroConf === 'todos'
                    ? 'Nenhum projeto no período. Sincronize os dados na aba "Sincronizar".'
                    : 'Nenhum projeto neste filtro de conferência.'}
                </td>
              </tr>
            )}
            {projetos.map((p) => (
              <tr key={p.projeto} className="linha-clicavel" onClick={() => abrir(p)}>
                <td className="whitespace-nowrap">
                  <Link
                    to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    {p.projeto}
                  </Link>
                </td>
                <td>
                  <ChipsEmpresas empresas={p.empresas} />
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  <span className="block max-w-36 truncate" title={p.cliente}>
                    {p.cliente || '—'}
                  </span>
                </td>
                <td className="num">{fmtBRL(p.receita)}</td>
                <td className="num">{fmtBRL(p.producao)}</td>
                <td className="num">{fmtBRL(p.frete)}</td>
                <td className="num">{fmtBRL(p.imposto)}</td>
                <td className="num">{fmtBRL(p.comissao)}</td>
                <td className="num">{fmtBRL(p.outros)}</td>
                <td className="num font-semibold" style={{ color: p.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                  {fmtBRL(p.resultado)}
                </td>
                <td className="num font-semibold">{fmtPct(p.margem)}</td>
                <td>
                  <BarraComposicao
                    compacta
                    receita={p.receita}
                    producao={p.producao}
                    frete={p.frete}
                    imposto={p.imposto}
                    comissao={p.comissao}
                    outros={p.outros}
                    resultado={p.resultado}
                  />
                </td>
                <td>
                  <BadgeMeta margem={p.margem} receita={p.receita} alvo={margemAlvo} />
                </td>
                <td>
                  <SeloConferencia p={p} />
                </td>
              </tr>
            ))}
          </tbody>
          {(() => {
            const linhas = projetos
            if (!linhas.length) return null
            const soma = (campo: 'receita' | 'producao' | 'frete' | 'comissao' | 'imposto' | 'outros' | 'resultado') =>
              linhas.reduce((s, p) => s + p[campo], 0)
            const receita = soma('receita')
            const resultado = soma('resultado')
            return (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--baseline)' }}>
                  <td title="Soma das linhas exibidas">Total</td>
                  <td colSpan={2} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {linhas.length} projetos
                  </td>
                  <td className="num">{fmtBRL(receita)}</td>
                  <td className="num">{fmtBRL(soma('producao'))}</td>
                  <td className="num">{fmtBRL(soma('frete'))}</td>
                  <td className="num">{fmtBRL(soma('imposto'))}</td>
                  <td className="num">{fmtBRL(soma('comissao'))}</td>
                  <td className="num">{fmtBRL(soma('outros'))}</td>
                  <td className="num" style={{ color: resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                    {fmtBRL(resultado)}
                  </td>
                  <td className="num">{fmtPct(receita > 0 ? resultado / receita : 0)}</td>
                  <td colSpan={2}></td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }} title="Projetos com os dois ok">
                    {linhas.filter((p) => p.conferencia?.status === 'aprovado').length}/{linhas.length}
                  </td>
                </tr>
              </tfoot>
            )
          })()}
        </table>
        </div>
      </div>
    </div>
  )
}
