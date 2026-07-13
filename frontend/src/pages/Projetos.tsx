import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { BadgeLucro, BarraComposicao, LegendaSeries } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

export default function Projetos() {
  const { empresaIds, de, ate, params } = useFiltros()
  const { data, isLoading } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })

  const projetos = data?.projetos || []

  return (
    <div>
      <FiltrosBar />
      <div className="mb-3 flex items-center justify-between gap-3">
        <LegendaSeries />
        <div className="flex gap-2">
          <a className="btn btn-ghost" href={api.urlExportCsv(empresaIds, de, ate)} download>
            Exportar CSV
          </a>
          <a className="btn btn-ghost" href={api.urlExportXlsx(empresaIds, de, ate)} download>
            Exportar Excel
          </a>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Empresas</th>
              <th>Cliente</th>
              <th className="num">Receita</th>
              <th className="num">Produção</th>
              <th className="num">Frete</th>
              <th className="num">Impostos</th>
              <th className="num">Outros</th>
              <th className="num">Resultado</th>
              <th className="num">Margem</th>
              <th style={{ minWidth: 140 }}>Composição</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={12} style={{ color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && projetos.length === 0 && (
              <tr>
                <td colSpan={12} style={{ color: 'var(--text-muted)' }}>
                  Nenhum projeto no período. Sincronize os dados na aba "Sincronizar".
                </td>
              </tr>
            )}
            {projetos.map((p) => (
              <tr key={p.projeto}>
                <td>
                  <Link
                    to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`}
                    className="font-semibold underline-offset-2 hover:underline"
                    style={{ color: 'var(--serie-producao)' }}
                  >
                    {p.projeto}
                  </Link>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>{p.empresas}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{p.cliente || '—'}</td>
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
        </table>
      </div>
    </div>
  )
}
