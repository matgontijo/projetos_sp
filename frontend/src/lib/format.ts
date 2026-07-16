const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function fmtBRL(valor: number): string {
  return brl.format(valor ?? 0)
}

/** Forma curta para escalas de gráfico: R$ 5,4 mi · R$ 320 mil · R$ 900. */
export function fmtBRLCurto(valor: number): string {
  const abs = Math.abs(valor)
  const sinal = valor < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sinal}R$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')} mi`
  if (abs >= 1_000) return `${sinal}R$ ${Math.round(abs / 1_000)} mil`
  return `${sinal}R$ ${Math.round(abs)}`
}

export function fmtPct(fracao: number): string {
  return pct.format(fracao ?? 0)
}

export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}
