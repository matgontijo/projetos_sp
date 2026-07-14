import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type LinhaFechamento } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { BadgeLucro, BarraComposicao, ChipsEmpresas, LegendaSeries, Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

type CampoOrdenavel = 'projeto' | 'receita' | 'producao' | 'frete' | 'imposto' | 'outros' | 'resultado' | 'margem'

export default function Projetos() {
  const { empresaIds, de, ate, params } = useFiltros()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })

  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<{ campo: CampoOrdenavel; desc: boolean }>({ campo: 'receita', desc: true })

  function ordenarPor(campo: CampoOrdenavel) {
    setOrdem((o) => ({ campo, desc: o.campo === campo ? !o.desc : true }))
  }

  const todos = data?.projetos || []
  const filtrados = busca
    ? todos.filter((p) =>
        `${p.projeto} ${p.cliente} ${p.empresas}`.toLowerCase().includes(busca.toLowerCase()),
      )
    : todos
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
        subtitulo="Um fechamento por projeto — clique na linha para abrir o detalhe"
        acoes={
          <>
            <a className="btn btn-primary" href={api.urlExportPdf(empresaIds, de, ate)} download>
              Exportar PDF
            </a>
            <a className="btn btn-ghost" href={api.urlExportCsv(empresaIds, de, ate)} download>
              CSV
            </a>
            <a className="btn btn-ghost" href={api.urlExportXlsx(empresaIds, de, ate)} download>
              Excel
            </a>
          </>
        }
      />
      <FiltrosBar />
      {error && (
        <p className="mb-3 text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar o fechamento: {(error as Error).message}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            className="input w-64"
            placeholder="Buscar projeto ou cliente…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {projetos.length} de {todos.length}
            </span>
          )}
        </div>
        <LegendaSeries />
      </div>
      <div className="card overflow-x-auto">
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
              <Th campo="outros">Outros</Th>
              <Th campo="resultado">Resultado</Th>
              <Th campo="margem">Margem</Th>
              <th style={{ minWidth: 140 }}>Composição</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [1, 2, 3, 4, 5, 6].map((i) => (
                <tr key={i}>
                  <td colSpan={12}>
                    <Skeleton altura={18} />
                  </td>
                </tr>
              ))}
            {!isLoading && !error && projetos.length === 0 && (
              <tr>
                <td colSpan={12} style={{ color: 'var(--text-muted)' }}>
                  Nenhum projeto no período. Sincronize os dados na aba "Sincronizar".
                </td>
              </tr>
            )}
            {projetos.map((p) => (
              <tr key={p.projeto} className="linha-clicavel" onClick={() => abrir(p)}>
                <td className="whitespace-nowrap">
                  <Link
                    to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: 'var(--serie-producao)' }}
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
                    outros={p.outros}
                    resultado={p.resultado}
                  />
                </td>
                <td>
                  <BadgeLucro resultado={p.resultado} />
                </td>
              </tr>
            ))}
          </tbody>
          {(() => {
            const linhas = projetos.filter((p) => p.projeto !== 'Sem projeto')
            if (!linhas.length) return null
            const soma = (campo: 'receita' | 'producao' | 'frete' | 'imposto' | 'outros' | 'resultado') =>
              linhas.reduce((s, p) => s + p[campo], 0)
            const receita = soma('receita')
            const resultado = soma('resultado')
            return (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--baseline)' }}>
                  <td title="Soma das linhas exibidas (a linha 'Sem projeto' fica de fora)">Total</td>
                  <td colSpan={2} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {linhas.length} projetos
                  </td>
                  <td className="num">{fmtBRL(receita)}</td>
                  <td className="num">{fmtBRL(soma('producao'))}</td>
                  <td className="num">{fmtBRL(soma('frete'))}</td>
                  <td className="num">{fmtBRL(soma('imposto'))}</td>
                  <td className="num">{fmtBRL(soma('outros'))}</td>
                  <td className="num" style={{ color: resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                    {fmtBRL(resultado)}
                  </td>
                  <td className="num">{fmtPct(receita > 0 ? resultado / receita : 0)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )
          })()}
        </table>
      </div>
    </div>
  )
}
