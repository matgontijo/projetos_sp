import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { BarraValor, GraficoFluxo, Skeleton, ValorContado } from '../components/Viz'
import { fmtBRL, fmtData, fmtPct } from '../lib/format'

export default function Analises() {
  const { empresaIds, de, ate, params } = useFiltros()
  const [aba, setAba] = useState<'clientes' | 'vendedores' | 'comissoes' | 'caixa' | 'orfaos'>('clientes')

  return (
    <div>
      <PageHeader
        titulo="Análises"
        subtitulo="Quem sustenta a margem, quem vende bem e onde o dinheiro está parado — só projetos de venda (BR)"
      />
      <FiltrosBar />
      <div className="mb-4 flex gap-1 border-b" style={{ borderColor: 'var(--baseline)' }}>
        {(
          [
            ['clientes', 'Clientes (curva ABC)'],
            ['vendedores', 'Vendedores'],
            ['comissoes', 'Comissões'],
            ['caixa', 'Caixa'],
            ['orfaos', 'Sem projeto'],
          ] as const
        ).map(([id, rotulo]) => (
          <button key={id} className={`tab ${aba === id ? 'tab-ativa' : ''}`} onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'clientes' && <Clientes empresaIds={empresaIds} de={de} ate={ate} params={params.toString()} />}
      {aba === 'vendedores' && <Vendedores empresaIds={empresaIds} de={de} ate={ate} />}
      {aba === 'comissoes' && <ComissoesTab empresaIds={empresaIds} de={de} ate={ate} />}
      {aba === 'caixa' && <CaixaTab empresaIds={empresaIds} de={de} ate={ate} params={params.toString()} />}
      {aba === 'orfaos' && <OrfaosTab empresaIds={empresaIds} de={de} ate={ate} />}
    </div>
  )
}

function ErroCarga({ erro }: { erro: unknown }) {
  return (
    <p className="mb-3 text-sm" style={{ color: 'var(--neg)' }}>
      Erro ao carregar: {(erro as Error).message}. Se o app acabou de ser atualizado, aguarde o servidor terminar o
      deploy e recarregue a página.
    </p>
  )
}

function Clientes({ empresaIds, de, ate, params }: { empresaIds?: string; de?: string; ate?: string; params: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-clientes', empresaIds, de, ate],
    queryFn: () => api.rankingClientes(empresaIds, de, ate),
  })
  if (error) return <ErroCarga erro={error} />
  return (
    <div className="card overflow-x-auto">
      <table className="data tabela-rica">
        <thead>
          <tr>
            <th>Classe</th>
            <th>Cliente</th>
            <th className="num">Receita</th>
            <th className="num">Resultado</th>
            <th className="num">Margem</th>
            <th className="num">Projetos</th>
            <th className="num">No prejuízo</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr><td colSpan={7}><Skeleton altura={18} /></td></tr>
          )}
          {(() => { const maxR = Math.max(...(data || []).map((c) => c.receita), 1); const maxRes = Math.max(...(data || []).map((c) => Math.abs(c.resultado)), 1); return (data || []).map((c) => (
            <tr key={c.cliente}>
              <td>
                <span
                  className="inline-grid h-6 w-6 place-items-center rounded-md text-xs font-black"
                  title={c.classe === 'A' ? 'Classe A: junto com os demais A, soma 80% da receita' : c.classe === 'B' ? 'Classe B: dos 80% aos 95% da receita' : 'Classe C: os 5% finais'}
                  style={{
                    background:
                      c.classe === 'A'
                        ? 'color-mix(in srgb, var(--serie-producao) 20%, transparent)'
                        : c.classe === 'B'
                          ? 'color-mix(in srgb, var(--serie-imposto) 20%, transparent)'
                          : 'var(--surface-2)',
                  }}
                >
                  {c.classe}
                </span>
              </td>
              <td>
                <Link
                  to={`/projetos?${params}`}
                  className="font-semibold hover:underline"
                  title="Ver os projetos deste cliente na lista (use a busca)"
                >
                  {c.cliente}
                </Link>
              </td>
              <td className="num">
                {fmtBRL(c.receita)}
                <BarraValor valor={c.receita} max={maxR} />
              </td>
              <td className="num font-semibold" style={{ color: c.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                {fmtBRL(c.resultado)}
                <BarraValor valor={c.resultado} max={maxRes} cor={c.resultado >= 0 ? 'color-mix(in srgb, var(--status-good) 65%, transparent)' : 'color-mix(in srgb, var(--neg) 70%, transparent)'} />
              </td>
              <td className="num">{fmtPct(c.margem)}</td>
              <td className="num">{c.qtd_projetos}</td>
              <td className="num" style={{ color: c.projetos_prejuizo > 0 ? 'var(--neg)' : 'var(--text-muted)' }}>
                {c.projetos_prejuizo || '—'}
              </td>
            </tr>
          )) })()}
          {data && data.length === 0 && (
            <tr><td colSpan={7} style={{ color: 'var(--text-muted)' }}>Sem dados no período.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Vendedores({ empresaIds, de, ate }: { empresaIds?: string; de?: string; ate?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-vendedores', empresaIds, de, ate],
    queryFn: () => api.rankingVendedores(empresaIds, de, ate),
  })
  if (error) return <ErroCarga erro={error} />
  return (
    <div>
      <div className="card overflow-x-auto">
        <table className="data tabela-rica">
          <thead>
            <tr>
              <th>Vendedor</th>
              <th className="num">Receita vendida</th>
              <th className="num">Resultado atribuído</th>
              <th className="num">Margem média</th>
              <th className="num">Projetos</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5}><Skeleton altura={18} /></td></tr>
            )}
            {(() => { const maxRv = Math.max(...(data?.vendedores || []).map((v) => v.receita), 1); const maxResV = Math.max(...(data?.vendedores || []).map((v) => Math.abs(v.resultado_atribuido)), 1); return (data?.vendedores || []).map((v) => (
              <tr key={v.vendedor}>
                <td className="font-semibold">{v.vendedor}</td>
                <td className="num">
                  {fmtBRL(v.receita)}
                  <BarraValor valor={v.receita} max={maxRv} />
                </td>
                <td className="num" style={{ color: v.resultado_atribuido >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                  {fmtBRL(v.resultado_atribuido)}
                  <BarraValor valor={v.resultado_atribuido} max={maxResV} cor={v.resultado_atribuido >= 0 ? 'color-mix(in srgb, var(--status-good) 65%, transparent)' : 'color-mix(in srgb, var(--neg) 70%, transparent)'} />
                </td>
                <td className="num font-semibold">{fmtPct(v.margem_media)}</td>
                <td className="num">{v.qtd_projetos}</td>
              </tr>
            )) })()}
            {data && data.vendedores.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                  Nenhuma venda com vendedor identificado — rode uma nova busca de dados para preencher (o campo passou
                  a ser sincronizado agora).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.receita_sem_vendedor > 0 && (
        <p className="help mt-2">
          {fmtBRL(data.receita_sem_vendedor)} em vendas sem vendedor identificado na Omie ficam fora deste ranking.
        </p>
      )}
      <p className="help mt-1">
        Margem média ponderada pela receita: o vendedor que vende caro E com margem sobe; volume com margem ruim desce.
      </p>
    </div>
  )
}

function FluxoCard({ empresaIds, de, ate }: { empresaIds?: string; de?: string; ate?: string }) {
  const [projeto, setProjeto] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['analise-fluxo', empresaIds, de, ate, projeto],
    queryFn: () => api.fluxo(empresaIds, de, ate, projeto || undefined),
  })
  return (
    <div className="card mb-4 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="titulo-secao">Fluxo de caixa por vencimento</span>
          <p className="help mt-0.5">
            Quando o dinheiro dos projetos entra e sai de verdade — inclusive os meses ainda por vir.
          </p>
        </div>
        <select
          className="input w-52 py-1.5 text-sm"
          aria-label="Filtrar fluxo por projeto"
          value={projeto}
          onChange={(e) => setProjeto(e.target.value)}
        >
          <option value="">Todos os projetos</option>
          {(data?.projetos || []).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      {isLoading ? <Skeleton altura={200} /> : <GraficoFluxo serie={data?.meses || []} />}
    </div>
  )
}

function CaixaTab({ empresaIds, de, ate, params }: { empresaIds?: string; de?: string; ate?: string; params: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-caixa', empresaIds, de, ate],
    queryFn: () => api.caixa(empresaIds, de, ate),
  })
  if (error) return <ErroCarga erro={error} />
  const t = data?.totais
  return (
    <div>
      <FluxoCard empresaIds={empresaIds} de={de} ate={ate} />
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card px-4 py-3">
            <div className="titulo-secao">A receber em aberto</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <ValorContado valor={t.receber_aberto} formato={fmtBRL} />
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A receber ATRASADO</div>
            <div className="mt-1 text-xl font-extrabold" style={{ color: t.receber_atrasado > 0 ? 'var(--neg)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
              <ValorContado valor={t.receber_atrasado} formato={fmtBRL} />
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A pagar em aberto</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <ValorContado valor={t.pagar_aberto} formato={fmtBRL} />
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A pagar atrasado</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <ValorContado valor={t.pagar_atrasado} formato={fmtBRL} />
            </div>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="data tabela-rica">
          <thead>
            <tr>
              <th>Projeto</th>
              <th className="num">A receber</th>
              <th className="num">Atrasado</th>
              <th className="num">Maior atraso</th>
              <th className="num">A pagar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5}><Skeleton altura={18} /></td></tr>
            )}
            {(() => { const abertos = (data?.projetos || []).filter((p) => p.receber_aberto > 0 || p.pagar_aberto > 0); const maxRec = Math.max(...abertos.map((p) => p.receber_aberto), 1); const maxPag = Math.max(...abertos.map((p) => p.pagar_aberto), 1); return abertos.map((p) => (
              <tr key={p.projeto}>
                <td>
                  <Link to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params}`} className="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
                    {p.projeto}
                  </Link>
                </td>
                <td className="num">
                  {fmtBRL(p.receber_aberto)}
                  <BarraValor valor={p.receber_aberto} max={maxRec} />
                </td>
                <td className="num font-semibold" style={{ color: p.receber_atrasado > 0 ? 'var(--neg)' : 'var(--text-muted)' }}>
                  {p.receber_atrasado > 0 ? fmtBRL(p.receber_atrasado) : '—'}
                </td>
                <td className="num">{p.maior_atraso_dias > 0 ? `${p.maior_atraso_dias} dias` : '—'}</td>
                <td className="num">
                  {fmtBRL(p.pagar_aberto)}
                  <BarraValor valor={p.pagar_aberto} max={maxPag} cor="color-mix(in srgb, var(--serie-imposto) 60%, transparent)" />
                </td>
              </tr>
            )) })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Comissões: % sobre o que efetivamente ENTROU (títulos recebidos), por vendedor. */
function ComissoesTab({ empresaIds, de, ate }: { empresaIds?: string; de?: string; ate?: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-comissoes', empresaIds, de, ate],
    queryFn: () => api.comissoes(empresaIds, de, ate),
  })
  const [editando, setEditando] = useState<string | null>(null)
  const [pct, setPct] = useState('')
  const salvar = useMutation({
    mutationFn: ({ vendedor, valor }: { vendedor: string; valor: number }) => api.definirComissao(vendedor, valor),
    onSuccess: () => {
      setEditando(null)
      queryClient.invalidateQueries({ queryKey: ['analise-comissoes'] })
    },
  })
  if (error) return <ErroCarga erro={error} />
  if (isLoading || !data) return <Skeleton altura={220} />
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card px-4 py-3">
          <div className="titulo-secao">Comissão a pagar no período</div>
          <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <ValorContado valor={data.total_comissao} formato={fmtBRL} />
          </div>
        </div>
        <div className="card px-4 py-3">
          <div className="titulo-secao">Recebido sem vendedor</div>
          <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <ValorContado valor={data.recebido_sem_vendedor} formato={fmtBRL} />
          </div>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data tabela-rica">
          <thead>
            <tr>
              <th>Vendedor</th>
              <th className="num">Recebido no período</th>
              <th className="num">% comissão</th>
              <th className="num">Comissão</th>
            </tr>
          </thead>
          <tbody>
            {data.vendedores.map((v) => (
              <tr key={v.vendedor}>
                <td className="font-semibold">{v.vendedor}</td>
                <td className="num">{fmtBRL(v.recebido)}</td>
                <td className="num">
                  {editando === v.vendedor ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="50"
                        step="0.1"
                        className="input w-20 py-1 text-right"
                        value={pct}
                        autoFocus
                        onChange={(e) => setPct(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') salvar.mutate({ vendedor: v.vendedor, valor: Number(pct) })
                          if (e.key === 'Escape') setEditando(null)
                        }}
                      />
                      <button
                        className="btn btn-primary px-2 py-1 text-xs"
                        disabled={salvar.isPending}
                        onClick={() => salvar.mutate({ vendedor: v.vendedor, valor: Number(pct) })}
                      >
                        ok
                      </button>
                    </span>
                  ) : (
                    <button
                      className="cursor-pointer underline decoration-dotted underline-offset-4"
                      title="Clique para definir o % de comissão"
                      onClick={() => {
                        setEditando(v.vendedor)
                        setPct(String(v.pct))
                      }}
                    >
                      {v.pct.toLocaleString('pt-BR')}%
                    </button>
                  )}
                </td>
                <td className="num font-bold">{fmtBRL(v.comissao)}</td>
              </tr>
            ))}
            {data.vendedores.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                  Nenhum título recebido com vendedor no período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="help mt-2">
        Base: títulos a receber com status RECEBIDO/LIQUIDADO, emitidos no período filtrado, de projetos de venda.
        O % fica no cadastro do vendedor — clique no número para definir.
      </p>
      {salvar.error && (
        <p className="mt-1 text-sm" style={{ color: 'var(--neg)' }}>{(salvar.error as Error).message}</p>
      )}
    </div>
  )
}

/** Sem projeto: o dinheiro que o fechamento NÃO enxerga — para classificar na Omie. */
function OrfaosTab({ empresaIds, de, ate }: { empresaIds?: string; de?: string; ate?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-orfaos', empresaIds, de, ate],
    queryFn: () => api.semProjeto(empresaIds, de, ate),
  })
  if (error) return <ErroCarga erro={error} />
  if (isLoading || !data) return <Skeleton altura={220} />
  const t = data.totais
  const ROTULO: Record<string, string> = { receber: 'A receber', pagar: 'A pagar', nfe: 'NF-e' }
  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        {(['receber', 'pagar', 'nfe'] as const).map((k) => (
          <div key={k} className="card px-4 py-3">
            <div className="titulo-secao">{ROTULO[k]} sem projeto</div>
            <div
              className="mt-1 text-xl font-extrabold"
              style={{ color: t[k] > 0 ? 'var(--neg)' : 'var(--status-good-text)', fontVariantNumeric: 'tabular-nums' }}
            >
              <ValorContado valor={t[k]} formato={fmtBRL} />
            </div>
          </div>
        ))}
      </div>
      {data.qtd === 0 ? (
        <div className="card px-5 py-8 text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--status-good-text)' }}>
            Tudo classificado — nenhum lançamento sem projeto no período.
          </p>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="data tabela-rica">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Empresa</th>
                  <th>Data</th>
                  <th>Documento</th>
                  <th>Categoria</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.itens.map((i) => (
                  <tr key={`${i.origem}-${i.codigo_omie}`}>
                    <td>{ROTULO[i.tipo] || i.tipo}</td>
                    <td>{i.empresa}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{i.data ? fmtData(i.data) : '—'}</td>
                    <td>{i.documento || `#${i.codigo_omie}`}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{i.categoria || '—'}</td>
                    <td className="num font-bold">{fmtBRL(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help mt-2">
            {data.qtd > data.itens.length ? `Mostrando os ${data.itens.length} maiores de ${data.qtd}. ` : ''}
            Esses valores NÃO entram em nenhum fechamento. O caminho: abrir o lançamento na Omie, preencher o
            projeto, e rodar Buscar dados de novo — ele passa a contar na hora.
          </p>
        </>
      )}
    </div>
  )
}
