import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Simulacao } from '../api/client'
import { PageHeader } from '../components/Layout'
import { fmtBRL, fmtPct } from '../lib/format'

export default function Simulador() {
  const [custo, setCusto] = useState('')
  const [margem, setMargem] = useState('20')
  const [comissao, setComissao] = useState('')
  const [preco, setPreco] = useState('')
  const [resultado, setResultado] = useState<Simulacao | null>(null)

  const simular = useMutation({
    mutationFn: () =>
      api.simular(Number(custo), Number(margem || 0), preco ? Number(preco) : undefined, comissao ? Number(comissao) : undefined),
    onSuccess: setResultado,
  })

  return (
    <div>
      <PageHeader
        titulo="Simulador de venda"
        subtitulo="Antes de fechar o pedido: qual o preço mínimo para a margem que você quer — e por qual empresa faturar"
      />

      <div className="card px-5 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            Custo estimado do pedido (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              className="input mt-1 block w-44"
              placeholder="ex.: 25000"
              value={custo}
              onChange={(e) => setCusto(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Margem desejada (%)
            <input
              type="number"
              min="0"
              max="90"
              step="0.5"
              className="input mt-1 block w-32"
              value={margem}
              onChange={(e) => setMargem(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Comissão do vendedor (%)
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              className="input mt-1 block w-32"
              placeholder="0"
              value={comissao}
              onChange={(e) => setComissao(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Preço que o cliente topa (opcional)
            <input
              type="number"
              min="0"
              step="0.01"
              className="input mt-1 block w-44"
              placeholder="para testar a margem"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            disabled={!custo || Number(custo) <= 0 || simular.isPending}
            onClick={() => simular.mutate()}
          >
            {simular.isPending ? 'Calculando…' : 'Simular'}
          </button>
        </div>
        {simular.isError && (
          <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
            {(simular.error as Error).message}
          </p>
        )}
        <p className="help mt-3">
          A conta usa o imposto real de cada empresa: no Presumido, a % efetiva observada nas vendas dos últimos 12
          meses; no Simples, a alíquota do mês (faturamento de 12 meses) — as mesmas do fechamento.
        </p>
      </div>

      {resultado && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {resultado.cenarios.map((c) => {
            const recomendada = resultado.empresa_recomendada === c.empresa
            return (
              <div
                key={c.empresa_id}
                className="card px-5 py-4"
                style={recomendada ? { borderColor: 'var(--status-good)', boxShadow: '0 0 0 1px var(--status-good)' } : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold">{c.empresa}</h3>
                  {recomendada && (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      style={{ background: 'color-mix(in srgb, var(--status-good) 18%, transparent)', color: 'var(--status-good-text)' }}
                    >
                      MELHOR OPÇÃO
                    </span>
                  )}
                </div>
                <div className="titulo-secao mt-3">Preço mínimo p/ {Number(margem)}% de margem</div>
                <div className="mt-1 text-3xl font-extrabold tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {c.preco_minimo ? fmtBRL(c.preco_minimo) : '—'}
                </div>
                <p className="help mt-1">
                  Imposto estimado: {fmtPct(c.aliquota)} da venda ({c.origem_aliquota})
                  {c.comissao > 0 && <> · comissão de {fmtPct(c.comissao)} já descontada</>}.
                </p>
                {c.com_preco_informado && (
                  <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
                    <div className="titulo-secao">Com o preço informado</div>
                    <p className="mt-1 text-sm">
                      Imposto {fmtBRL(c.com_preco_informado.imposto)}
                      {c.com_preco_informado.comissao > 0 && <> · comissão {fmtBRL(c.com_preco_informado.comissao)}</>} · resultado{' '}
                      <b style={{ color: c.com_preco_informado.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                        {fmtBRL(c.com_preco_informado.resultado)}
                      </b>{' '}
                      · margem <b>{fmtPct(c.com_preco_informado.margem)}</b>
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
