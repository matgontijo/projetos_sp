import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

export default function Analises() {
  const { empresaIds, de, ate, params } = useFiltros()
  const [aba, setAba] = useState<'clientes' | 'vendedores' | 'caixa'>('clientes')

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
            ['caixa', 'Caixa'],
          ] as const
        ).map(([id, rotulo]) => (
          <button key={id} className={`tab ${aba === id ? 'tab-ativa' : ''}`} onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'clientes' && <Clientes empresaIds={empresaIds} de={de} ate={ate} params={params.toString()} />}
      {aba === 'vendedores' && <Vendedores empresaIds={empresaIds} de={de} ate={ate} />}
      {aba === 'caixa' && <CaixaTab empresaIds={empresaIds} de={de} ate={ate} params={params.toString()} />}
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
      <table className="data">
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
          {(data || []).map((c) => (
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
              <td className="num">{fmtBRL(c.receita)}</td>
              <td className="num font-semibold" style={{ color: c.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                {fmtBRL(c.resultado)}
              </td>
              <td className="num">{fmtPct(c.margem)}</td>
              <td className="num">{c.qtd_projetos}</td>
              <td className="num" style={{ color: c.projetos_prejuizo > 0 ? 'var(--neg)' : 'var(--text-muted)' }}>
                {c.projetos_prejuizo || '—'}
              </td>
            </tr>
          ))}
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
        <table className="data">
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
            {(data?.vendedores || []).map((v) => (
              <tr key={v.vendedor}>
                <td className="font-semibold">{v.vendedor}</td>
                <td className="num">{fmtBRL(v.receita)}</td>
                <td className="num" style={{ color: v.resultado_atribuido >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                  {fmtBRL(v.resultado_atribuido)}
                </td>
                <td className="num font-semibold">{fmtPct(v.margem_media)}</td>
                <td className="num">{v.qtd_projetos}</td>
              </tr>
            ))}
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

function CaixaTab({ empresaIds, de, ate, params }: { empresaIds?: string; de?: string; ate?: string; params: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analise-caixa', empresaIds, de, ate],
    queryFn: () => api.caixa(empresaIds, de, ate),
  })
  if (error) return <ErroCarga erro={error} />
  const t = data?.totais
  return (
    <div>
      {t && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card px-4 py-3">
            <div className="titulo-secao">A receber em aberto</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(t.receber_aberto)}</div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A receber ATRASADO</div>
            <div className="mt-1 text-xl font-extrabold" style={{ color: t.receber_atrasado > 0 ? 'var(--neg)' : undefined, fontVariantNumeric: 'tabular-nums' }}>
              {fmtBRL(t.receber_atrasado)}
            </div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A pagar em aberto</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(t.pagar_aberto)}</div>
          </div>
          <div className="card px-4 py-3">
            <div className="titulo-secao">A pagar atrasado</div>
            <div className="mt-1 text-xl font-extrabold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(t.pagar_atrasado)}</div>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="data">
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
            {(data?.projetos || []).filter((p) => p.receber_aberto > 0 || p.pagar_aberto > 0).map((p) => (
              <tr key={p.projeto}>
                <td>
                  <Link to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params}`} className="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
                    {p.projeto}
                  </Link>
                </td>
                <td className="num">{fmtBRL(p.receber_aberto)}</td>
                <td className="num font-semibold" style={{ color: p.receber_atrasado > 0 ? 'var(--neg)' : 'var(--text-muted)' }}>
                  {p.receber_atrasado > 0 ? fmtBRL(p.receber_atrasado) : '—'}
                </td>
                <td className="num">{p.maior_atraso_dias > 0 ? `${p.maior_atraso_dias} dias` : '—'}</td>
                <td className="num">{fmtBRL(p.pagar_aberto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
