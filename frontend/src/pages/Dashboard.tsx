import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import {
  BarraComposicao,
  Delta,
  GraficoMensal,
  KPICard,
  LegendaSeries,
  RankingMargem,
  Skeleton,
} from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

/** Período imediatamente anterior, com a mesma duração do filtro atual. */
function periodoAnterior(de?: string, ate?: string): { de: string; ate: string } | null {
  if (!de || !ate) return null
  const inicio = new Date(de)
  const fim = new Date(ate)
  const dias = Math.round((fim.getTime() - inicio.getTime()) / 864e5) + 1
  const anteriorFim = new Date(inicio.getTime() - 864e5)
  const anteriorInicio = new Date(anteriorFim.getTime() - (dias - 1) * 864e5)
  return { de: anteriorInicio.toISOString().slice(0, 10), ate: anteriorFim.toISOString().slice(0, 10) }
}

export default function Dashboard() {
  const { empresaIds, de, ate, params } = useFiltros()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })
  const { data: serie } = useQuery({
    queryKey: ['fechamento-mensal', empresaIds, de, ate],
    queryFn: () => api.fechamentoMensal(empresaIds, de, ate),
  })
  const { data: alertas } = useQuery({
    queryKey: ['alertas', empresaIds, de, ate],
    queryFn: () => api.alertas(empresaIds, de, ate),
  })
  const anterior = periodoAnterior(de, ate)
  const { data: dataAnterior } = useQuery({
    queryKey: ['fechamento', empresaIds, anterior?.de, anterior?.ate],
    queryFn: () => api.fechamento(empresaIds, anterior!.de, anterior!.ate),
    enabled: !!anterior,
  })

  const consolidado = data?.consolidado
  const consolidadoAnterior = dataAnterior?.consolidado
  // margem dos 15 MAIORES projetos por receita — ranking por margem pura deixaria
  // projetos minúsculos (ex.: R$ 1.620 sem custo = 100%) na frente dos relevantes
  const ranking = [...(data?.projetos || [])]
    .filter((p) => p.receita > 0)
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15)
    .sort((a, b) => b.margem - a.margem)
    .map((p) => ({
      chave: p.projeto,
      rotulo: p.projeto,
      margem: p.margem,
      detalhe: `${p.projeto} — receita ${fmtBRL(p.receita)}, resultado ${fmtBRL(p.resultado)}, margem ${fmtPct(p.margem)}`,
    }))

  return (
    <div>
      <PageHeader
        titulo="Visão geral"
        subtitulo="Só projetos de venda (numeração BR), com as duas empresas somadas por número de projeto"
      />
      <FiltrosBar />
      {isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card px-4 py-3">
              <Skeleton altura={12} largura={90} />
              <div className="mt-2">
                <Skeleton altura={26} largura={130} />
              </div>
            </div>
          ))}
        </div>
      )}
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
            <KPICard
              titulo="Receita"
              valor={fmtBRL(consolidado.receita)}
              sub={
                consolidadoAnterior ? (
                  <Delta atual={consolidado.receita} anterior={consolidadoAnterior.receita} />
                ) : (
                  `${consolidado.qtd_projetos} projetos`
                )
              }
            />
            <KPICard
              titulo="Custos"
              dica="Produção + frete + comissão + outros custos (impostos ficam no card ao lado)"
              valor={fmtBRL(consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros)}
              sub={
                consolidadoAnterior && (
                  <Delta
                    atual={consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros}
                    anterior={
                      consolidadoAnterior.producao +
                      consolidadoAnterior.frete +
                      consolidadoAnterior.comissao +
                      consolidadoAnterior.outros
                    }
                    invertido
                  />
                )
              }
            />
            <KPICard
              titulo="Impostos"
              valor={fmtBRL(consolidado.imposto)}
              sub={
                consolidadoAnterior && (
                  <Delta atual={consolidado.imposto} anterior={consolidadoAnterior.imposto} invertido />
                )
              }
            />
            <KPICard
              titulo="Resultado"
              valor={fmtBRL(consolidado.resultado)}
              tom={consolidado.resultado >= 0 ? 'pos' : 'neg'}
              sub={
                consolidadoAnterior && (
                  <Delta atual={consolidado.resultado} anterior={consolidadoAnterior.resultado} />
                )
              }
            />
            <KPICard
              titulo="Margem média"
              valor={fmtPct(consolidado.margem_media)}
              tom={consolidado.margem_media >= 0 ? 'pos' : 'neg'}
              sub={`${consolidado.qtd_projetos} projetos`}
            />
          </div>

          {alertas && alertas.length > 0 && (
            <div className="card mt-4 px-5 py-4">
              <h2 className="mb-2 text-sm font-bold">
                Precisa de atenção{' '}
                <span className="ml-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: 'color-mix(in srgb, var(--neg) 15%, transparent)', color: 'var(--neg)' }}>
                  {alertas.length}
                </span>
              </h2>
              <div className="grid gap-1.5">
                {alertas.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-sm">
                    <span
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: a.gravidade === 'critica' ? 'var(--status-critical)' : 'var(--status-warning)' }}
                      title={a.gravidade === 'critica' ? 'Crítico' : 'Atenção'}
                    />
                    <div>
                      {a.projeto ? (
                        <Link
                          to={`/projeto?nome=${encodeURIComponent(a.projeto)}&${params.toString()}`}
                          className="font-bold hover:underline"
                        >
                          {a.titulo}
                        </Link>
                      ) : (
                        <b>{a.titulo}</b>
                      )}{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>{a.detalhe}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {serie && serie.length > 1 && (
            <div className="card mt-4 px-5 py-4">
              <h2 className="mb-1 text-sm font-bold">Evolução mensal</h2>
              <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                Receita e resultado dos projetos, mês a mês. Passe o mouse para ver os valores.
              </p>
              <GraficoMensal serie={serie} />
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold">Composição da receita</h2>
              </div>
              <BarraComposicao
                receita={consolidado.receita}
                producao={consolidado.producao}
                frete={consolidado.frete}
                imposto={consolidado.imposto}
                comissao={consolidado.comissao}
                outros={consolidado.outros}
                resultado={consolidado.resultado}
              />
              <div className="mt-2">
                <LegendaSeries />
              </div>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Cada segmento é a fração da receita consumida pelo grupo; "Resultado" é o que sobra.
                {consolidado.cp_impostos > 0 &&
                  ` Tributos pagos via contas a pagar (${fmtBRL(consolidado.cp_impostos)}) aparecem no detalhe e não somam no custo.`}
              </p>
            </div>

            <div className="card px-5 py-4">
              <h2 className="mb-1 text-sm font-bold">Margem dos 15 maiores projetos</h2>
              <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                Ordenados pela margem — azul = lucro, vermelho = prejuízo. Clique para abrir o projeto.
              </p>
              {ranking.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhum projeto com receita no período.
                </p>
              ) : (
                <RankingMargem
                  itens={ranking}
                  aoClicar={(nome) => navigate(`/projeto?nome=${encodeURIComponent(nome)}&${params.toString()}`)}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
