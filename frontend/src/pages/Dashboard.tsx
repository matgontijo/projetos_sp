import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { BarraComposicao, KPICard, LegendaSeries, RankingMargem } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

export default function Dashboard() {
  const { empresaIds, de, ate } = useFiltros()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })

  const consolidado = data?.consolidado
  const ranking = [...(data?.projetos || [])]
    .filter((p) => p.receita > 0)
    .sort((a, b) => b.margem - a.margem)
    .slice(0, 15)
    .map((p) => ({
      chave: p.projeto,
      rotulo: p.projeto,
      margem: p.margem,
      detalhe: `${p.projeto} — receita ${fmtBRL(p.receita)}, resultado ${fmtBRL(p.resultado)}, margem ${fmtPct(p.margem)}`,
    }))

  return (
    <div>
      <FiltrosBar />
      {isLoading && <p style={{ color: 'var(--text-muted)' }}>Carregando fechamento…</p>}
      {error && (
        <p className="text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar: {(error as Error).message}
        </p>
      )}
      {consolidado && consolidado.qtd_projetos === 0 && (
        <div className="card px-6 py-6">
          <h2 className="mb-2 text-base font-bold">Comece por aqui</h2>
          <ol className="grid gap-2 text-sm md:grid-cols-3" style={{ color: 'var(--text-secondary)' }}>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>1. Conectar as empresas</b>
              <p className="help mt-1">
                Em <Link to="/empresas" className="underline">Empresas</Link>, cole as chaves da Omie de cada CNPJ e
                teste a conexão.
              </p>
            </li>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>2. Buscar os dados</b>
              <p className="help mt-1">
                Em <Link to="/sincronizar" className="underline">Buscar dados</Link>, escolha o período — o app puxa
                notas, contas a receber e a pagar.
              </p>
            </li>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>3. Classificar os custos</b>
              <p className="help mt-1">
                Em <Link to="/empresas" className="underline">Empresas → Classificar custos</Link>, diga o que é
                produção, frete ou imposto. Pronto: o fechamento sai sozinho.
              </p>
            </li>
          </ol>
        </div>
      )}
      {consolidado && consolidado.qtd_projetos > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KPICard titulo="Receita" valor={fmtBRL(consolidado.receita)} sub={`${consolidado.qtd_projetos} projetos`} />
            <KPICard
              titulo="Custos (prod. + frete + outros)"
              valor={fmtBRL(consolidado.producao + consolidado.frete + consolidado.outros)}
            />
            <KPICard titulo="Impostos" valor={fmtBRL(consolidado.imposto)} />
            <KPICard
              titulo="Resultado"
              valor={fmtBRL(consolidado.resultado)}
              tom={consolidado.resultado >= 0 ? 'pos' : 'neg'}
            />
            <KPICard
              titulo="Margem média"
              valor={fmtPct(consolidado.margem_media)}
              tom={consolidado.margem_media >= 0 ? 'pos' : 'neg'}
            />
          </div>

          {consolidado.nao_classificado > 0 && (
            <div
              className="mt-3 rounded-lg px-4 py-2 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--status-warning) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--status-warning) 40%, transparent)',
              }}
            >
              ⚠ {fmtBRL(consolidado.nao_classificado)} em contas a pagar com categoria <b>não classificada</b> (somadas
              em "Outros"). Classifique em{' '}
              <Link to="/empresas" className="underline font-semibold">
                Empresas → Categorias
              </Link>
              .
            </div>
          )}

          <div className="card mt-4 px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold">Composição da receita (consolidado)</h2>
              <LegendaSeries />
            </div>
            <BarraComposicao
              receita={consolidado.receita}
              producao={consolidado.producao}
              frete={consolidado.frete}
              imposto={consolidado.imposto}
              outros={consolidado.outros}
              resultado={consolidado.resultado}
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Cada segmento é a fração da receita consumida pelo grupo; o segmento "Resultado" é o que sobra.
              {consolidado.cp_impostos > 0 &&
                ` Tributos pagos via contas a pagar (${fmtBRL(consolidado.cp_impostos)}) são exibidos no detalhe e não somam no custo (o imposto vem da NF-e).`}
            </p>
          </div>

          <div className="card mt-4 px-5 py-4">
            <h2 className="mb-1 text-sm font-bold">Ranking de margem por projeto</h2>
            <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Margem % (resultado ÷ receita) — azul = positiva, vermelho = negativa. Top 15 por margem.
            </p>
            {ranking.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Nenhum projeto com receita no período. Sincronize os dados em "Sincronizar".
              </p>
            ) : (
              <RankingMargem itens={ranking} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
