import type { ReactNode } from 'react'
import { fmtBRL, fmtPct } from '../lib/format'

export const SERIES = [
  { key: 'producao', label: 'Produção', cor: 'var(--serie-producao)' },
  { key: 'frete', label: 'Frete', cor: 'var(--serie-frete)' },
  { key: 'imposto', label: 'Impostos', cor: 'var(--serie-imposto)' },
  { key: 'outros', label: 'Outros', cor: 'var(--serie-outros)' },
  { key: 'resultado', label: 'Resultado', cor: 'var(--serie-resultado)' },
] as const

export function KPICard({ titulo, valor, sub, tom }: { titulo: string; valor: string; sub?: ReactNode; tom?: 'pos' | 'neg' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        {titulo}
      </div>
      <div
        className="mt-1 text-2xl font-bold"
        style={{ color: tom === 'neg' ? 'var(--neg)' : tom === 'pos' ? 'var(--status-good-text)' : 'var(--text-primary)' }}
      >
        {valor}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** Barra de composição da receita: produção/frete/impostos/outros + resultado (2px de gap entre segmentos). */
export function BarraComposicao({
  receita,
  producao,
  frete,
  imposto,
  outros,
  resultado,
  compacta = false,
}: {
  receita: number
  producao: number
  frete: number
  imposto: number
  outros: number
  resultado: number
  compacta?: boolean
}) {
  if (receita <= 0) {
    return (
      <div
        className="w-full rounded"
        style={{ height: compacta ? 10 : 16, background: 'var(--gridline)' }}
        title="Sem receita no período"
      />
    )
  }
  const partes = [
    { label: 'Produção', valor: producao, cor: 'var(--serie-producao)' },
    { label: 'Frete', valor: frete, cor: 'var(--serie-frete)' },
    { label: 'Impostos', valor: imposto, cor: 'var(--serie-imposto)' },
    { label: 'Outros', valor: outros, cor: 'var(--serie-outros)' },
    { label: 'Resultado', valor: Math.max(resultado, 0), cor: 'var(--serie-resultado)' },
  ].filter((p) => p.valor > 0)
  const total = partes.reduce((s, p) => s + p.valor, 0)

  return (
    <div
      className="flex w-full overflow-hidden rounded"
      style={{ height: compacta ? 10 : 16, gap: 2, background: 'transparent' }}
      role="img"
      aria-label={partes.map((p) => `${p.label} ${fmtBRL(p.valor)}`).join(', ')}
    >
      {partes.map((p) => (
        <div
          key={p.label}
          style={{ width: `${(p.valor / total) * 100}%`, background: p.cor, borderRadius: 2, minWidth: 2 }}
          title={`${p.label}: ${fmtBRL(p.valor)} (${fmtPct(p.valor / receita)} da receita)`}
        />
      ))}
    </div>
  )
}

export function LegendaSeries({ incluirResultado = true }: { incluirResultado?: boolean }) {
  const itens = incluirResultado ? SERIES : SERIES.filter((s) => s.key !== 'resultado')
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
      {itens.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** Ranking de margem: barras horizontais divergentes (azul positivo, vermelho negativo) em HTML puro. */
export function RankingMargem({
  itens,
}: {
  itens: { chave: string; rotulo: string; margem: number; detalhe: string }[]
}) {
  const maxAbs = Math.max(...itens.map((i) => Math.abs(i.margem)), 0.0001)
  return (
    <div className="grid gap-1.5" role="list">
      {itens.map((i) => {
        const positivo = i.margem >= 0
        const largura = (Math.abs(i.margem) / maxAbs) * 100
        return (
          <div key={i.chave} className="flex items-center gap-2" role="listitem" title={i.detalhe}>
            <span
              className="w-36 shrink-0 truncate text-right text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              {i.rotulo}
            </span>
            <div className="relative h-4 flex-1">
              {/* linha de base no zero (centro) */}
              <div
                className="absolute inset-y-0 left-1/2 w-px"
                style={{ background: 'var(--baseline)' }}
              />
              <div
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  background: positivo ? 'var(--pos)' : 'var(--neg)',
                  left: positivo ? '50%' : `${50 - largura / 2}%`,
                  width: `${largura / 2}%`,
                  minWidth: 2,
                }}
              />
            </div>
            <span
              className="w-14 shrink-0 text-xs font-semibold num"
              style={{ color: positivo ? 'var(--text-primary)' : 'var(--neg)' }}
            >
              {fmtPct(i.margem)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Nome curto da empresa: 1ª palavra (ou duas, se a 1ª for muito curta). */
export function siglaEmpresa(nome: string): string {
  const palavras = nome.trim().split(/\s+/)
  if (!palavras[0]) return nome
  return palavras[0].length >= 4 ? palavras[0] : palavras.slice(0, 2).join(' ')
}

/** Chips compactos para a lista "Empresa A, Empresa B" (tooltip com o nome completo). */
export function ChipsEmpresas({ empresas }: { empresas: string }) {
  const nomes = empresas.split(',').map((n) => n.trim()).filter(Boolean)
  return (
    <span className="inline-flex flex-wrap gap-1" title={empresas}>
      {nomes.map((nome) => (
        <span
          key={nome}
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
          style={{
            background: 'color-mix(in srgb, var(--serie-producao) 10%, transparent)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--gridline)',
          }}
        >
          {siglaEmpresa(nome)}
        </span>
      ))}
    </span>
  )
}

export function BadgeLucro({ resultado }: { resultado: number }) {
  const lucro = resultado >= 0
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        background: lucro
          ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
          : 'color-mix(in srgb, var(--status-critical) 15%, transparent)',
        color: lucro ? 'var(--status-good-text)' : 'var(--neg)',
      }}
    >
      {lucro ? '▲ Lucro' : '▼ Prejuízo'}
    </span>
  )
}
