import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type PedidoCompra } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { KPICard, Skeleton } from '../components/Viz'
import { fmtBRL } from '../lib/format'

const SITUACOES: { valor: string; rotulo: string; cor: string; ajuda: string }[] = [
  { valor: 'pendente', rotulo: 'Pendente', cor: 'var(--status-warning)', ajuda: 'Ainda não virou conta a pagar' },
  { valor: 'recebido', rotulo: 'Recebido', cor: 'var(--serie-producao)', ajuda: 'Mercadoria recebida' },
  { valor: 'faturado', rotulo: 'Faturado', cor: 'var(--serie-resultado)', ajuda: 'Já tem nota do fornecedor' },
  { valor: 'encerrado', rotulo: 'Encerrado', cor: 'var(--text-muted)', ajuda: 'Pedido concluído' },
]

function BadgeSituacao({ situacao }: { situacao: string }) {
  const s = SITUACOES.find((x) => x.valor === situacao)
  if (!s) return <span className="text-xs">{situacao}</span>
  return (
    <span className="pill" style={{ '--pill': s.cor } as React.CSSProperties} title={s.ajuda}>
      {s.rotulo}
    </span>
  )
}

function dataBR(iso: string | null) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—'
}

export default function Compras() {
  const { empresaIds } = useFiltros()
  const [situacao, setSituacao] = useState('pendente')
  const [busca, setBusca] = useState('')

  const resumo = useQuery({
    queryKey: ['compras-resumo', empresaIds],
    queryFn: () => api.resumoCompras(empresaIds),
  })
  const filtros = { empresa_ids: empresaIds, situacao: situacao || undefined, busca: busca || undefined }
  const lista = useQuery({
    queryKey: ['compras-pedidos', filtros],
    queryFn: () => api.pedidosCompra(filtros),
    placeholderData: (prev) => prev,
  })

  const r = resumo.data
  const pedidos = lista.data || []

  return (
    <div>
      <PageHeader
        titulo="Compras"
        subtitulo="Pedidos de compra do Omie — a saída comprometida antes de virar conta a pagar, e o crédito de impostos"
      />

      <FiltrosBar />

      {resumo.isLoading && (
        <div className="mt-4">
          <Skeleton altura={90} />
        </div>
      )}

      {r && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPICard
            titulo="Comprometido (30 dias)"
            valor={fmtBRL(r.comprometido_30_dias)}
            sub="parcelas a vencer de pedidos pendentes"
            hero
          />
          <KPICard
            titulo="Comprometido vencido"
            valor={fmtBRL(r.comprometido_vencido)}
            sub="pendente com vencimento passado"
            tom={r.comprometido_vencido > 0 ? 'neg' : undefined}
          />
          <KPICard
            titulo="Crédito de impostos"
            valor={fmtBRL(r.credito_impostos)}
            sub="ICMS + PIS + COFINS das compras"
          />
          <KPICard titulo="Pedidos" valor={String(r.total_pedidos)} sub="no período sincronizado" />
        </div>
      )}

      {/* filtro por situação */}
      <div className="card mt-4 flex flex-wrap items-center gap-3 px-5 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          {SITUACOES.map((s) => {
            const dados = r?.por_situacao?.[s.valor]
            const ativo = situacao === s.valor
            return (
              <button
                key={s.valor}
                className={`tab ${ativo ? 'tab-ativa' : ''}`}
                title={s.ajuda}
                onClick={() => setSituacao(ativo ? '' : s.valor)}
              >
                {s.rotulo}
                {dados && (
                  <span className="ml-1.5 text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    {dados.qtd}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <label className="ml-auto text-sm">
          <input
            className="input w-56"
            placeholder="Buscar por número ou observação…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
      </div>

      {situacao === 'pendente' && (
        <p className="help mt-2">
          <b>Pendente</b> = o pedido existe no Omie mas <b>ainda não virou conta a pagar</b>. É a saída que não aparece
          em nenhum outro lugar — por isso ela conta no comprometido.
        </p>
      )}

      {lista.isLoading && !lista.data && (
        <div className="mt-4">
          <Skeleton altura={200} />
        </div>
      )}
      {lista.isError && (
        <p className="mt-4 text-sm" style={{ color: 'var(--neg)' }}>
          {(lista.error as Error).message}
        </p>
      )}

      {lista.data && pedidos.length === 0 && (
        <div className="card mt-4">
          <div className="vazio">
            <span className="vazio-titulo">Nenhum pedido de compra aqui</span>
            <span>
              {busca || situacao
                ? 'Tente limpar o filtro ou a busca.'
                : 'Rode a busca de dados do Omie para trazer os pedidos.'}
            </span>
          </div>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="card mt-4 overflow-x-auto">
          <table className="tabela w-full">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Empresa</th>
                <th>Descrição / observação</th>
                <th className="text-right">Valor</th>
                <th className="text-right">Crédito imp.</th>
                <th>Previsão</th>
                <th>1º vencimento</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.map((p: PedidoCompra) => {
                const vencido =
                  p.situacao === 'pendente' &&
                  p.proximo_vencimento &&
                  new Date(p.proximo_vencimento + 'T00:00:00') < new Date(new Date().toDateString())
                return (
                  <tr key={p.id}>
                    <td className="font-bold">{p.numero || '—'}</td>
                    <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {p.empresa.split(' ').slice(0, 2).join(' ')}
                    </td>
                    <td className="max-w-[22rem] truncate" title={p.observacao}>
                      {p.observacao || <span style={{ color: 'var(--text-muted)' }}>sem observação</span>}
                    </td>
                    <td className="num text-right font-bold">{fmtBRL(p.valor_total)}</td>
                    <td className="num text-right" style={{ color: p.credito_impostos > 0 ? 'var(--status-good-text)' : 'var(--text-muted)' }}>
                      {p.credito_impostos > 0 ? fmtBRL(p.credito_impostos) : '—'}
                    </td>
                    <td className="text-xs">{dataBR(p.data_previsao)}</td>
                    <td className="text-xs" style={{ color: vencido ? 'var(--neg)' : undefined, fontWeight: vencido ? 700 : undefined }}>
                      {dataBR(p.proximo_vencimento)}
                      {p.qtd_parcelas > 1 && (
                        <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({p.qtd_parcelas}x)</span>
                      )}
                    </td>
                    <td>
                      <BadgeSituacao situacao={p.situacao} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="help mt-3">
        Dados lidos do módulo de compras do Omie — o app <b>nunca escreve</b> lá. O crédito de impostos é a soma de
        ICMS, PIS e COFINS dos itens do pedido.
      </p>
    </div>
  )
}
