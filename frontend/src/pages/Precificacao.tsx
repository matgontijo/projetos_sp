import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, baixarArquivo, type EntradaCalculo, type ResultadoCalculo } from '../api/client'
import { PageHeader } from '../components/Layout'
import { KPICard, Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

/** Segura o valor por alguns ms antes de disparar o cálculo (tempo real sem spam). */
function useDebounce<T>(valor: T, ms = 350): T {
  const [d, setD] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setD(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return d
}

/** Uma linha do orçamento (um produto). Vários formam um pedido (ex.: copo + tirante). */
interface LinhaItem {
  id: number
  produtoId: number | null
  quantidade: string
  acabamento: string
  margem: string
  comissao: string
  portaCopo: boolean
  extraNome: string
  extraValor: string
}

let proximoId = 1
function novaLinha(): LinhaItem {
  return {
    id: proximoId++,
    produtoId: null,
    quantidade: '1000',
    acabamento: 'liso',
    margem: '',
    comissao: '',
    portaCopo: false,
    extraNome: '',
    extraValor: '',
  }
}

export default function Precificacao() {
  const { data: empresas } = useQuery({ queryKey: ['prec-empresas'], queryFn: api.precificacaoEmpresas })
  const { data: opcoes } = useQuery({ queryKey: ['prec-opcoes'], queryFn: api.precificacaoOpcoes })

  // dados do orçamento (valem para o pedido inteiro)
  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [local, setLocal] = useState('') // vazio = automático pelo regime da empresa
  const [condicao, setCondicao] = useState('0')
  const [cliente, setCliente] = useState('')
  const [clienteCnpj, setClienteCnpj] = useState('')
  // itens do pedido
  const [itens, setItens] = useState<LinhaItem[]>(() => [novaLinha()])
  const [salvo, setSalvo] = useState<{ id: number; numero: string } | null>(null)
  const [gerandoPdf, setGerandoPdf] = useState(false)

  useEffect(() => {
    if (empresas?.length && empresaId === null) setEmpresaId(empresas[0].id)
  }, [empresas, empresaId])

  const margemPadrao = opcoes ? String(opcoes.parametros.margem_padrao * 100) : ''
  const comissaoPadrao = opcoes ? String(opcoes.parametros.comissao_padrao * 100) : ''
  const aPrazo = (Number(condicao) || 0) > 0

  function atualizarLinha(id: number, patch: Partial<LinhaItem>) {
    setItens((atual) => atual.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  // converte uma linha em entrada do backend, mesclando os dados do pedido
  function linhaParaEntrada(l: LinhaItem): EntradaCalculo {
    return {
      produto_id: l.produtoId,
      quantidade: Number(l.quantidade) || 0,
      acabamento: l.acabamento,
      empresa_faturamento_id: empresaId!,
      local_faturamento: local || null,
      condicao_pagamento_dias: Number(condicao) || 0,
      margem: l.margem === '' ? null : Number(l.margem) / 100,
      comissao: l.comissao === '' ? null : Number(l.comissao) / 100,
      porta_copo: l.portaCopo,
      extras: l.extraValor && Number(l.extraValor) > 0 ? [{ nome: l.extraNome || 'Custo extra', valor: Number(l.extraValor) }] : [],
    }
  }

  // só linhas com quantidade válida entram no cálculo/salvamento
  const linhasValidas = itens.filter((l) => (Number(l.quantidade) || 0) > 0)
  const entradas: EntradaCalculo[] | null =
    empresaId && linhasValidas.length > 0 ? linhasValidas.map(linhaParaEntrada) : null
  const entradasLentas = useDebounce(entradas)

  const calculo = useQuery({
    queryKey: ['prec-pedido', entradasLentas],
    queryFn: () => api.precificacaoCalcularPedido(entradasLentas!),
    enabled: !!entradasLentas,
    placeholderData: (prev) => prev,
  })
  const comparacao = useQuery({
    queryKey: ['prec-comp-pedido', entradasLentas],
    queryFn: () => api.precificacaoCompararPedido(entradasLentas!),
    enabled: !!entradasLentas && (empresas?.length || 0) > 1,
    placeholderData: (prev) => prev,
  })

  const salvar = useMutation({
    mutationFn: () => api.criarOrcamentoVenda({ cliente, cliente_cnpj: clienteCnpj, itens: entradas! }),
    onSuccess: (res) => setSalvo({ id: res.id, numero: res.numero }),
  })
  // qualquer mudança na configuração invalida o "salvo" (o preço mudou)
  useEffect(() => setSalvo(null), [entradasLentas])

  const pedido = calculo.data
  // resultado por linha: os itens do backend seguem a ordem das linhas válidas
  const resultadoPorLinha = useMemo(() => {
    const mapa = new Map<number, ResultadoCalculo>()
    if (pedido) linhasValidas.forEach((l, i) => pedido.itens[i] && mapa.set(l.id, pedido.itens[i]))
    return mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])

  const empresaAtual = empresas?.find((e) => e.id === empresaId)
  const regimeInfo = pedido?.itens[0]
  const melhor = comparacao.data?.cenarios.find((c) => c.empresa_id === comparacao.data?.melhor_empresa_id)
  const avisos = [...new Set((pedido?.itens || []).map((i) => i.aviso).filter(Boolean))]

  return (
    <div>
      <PageHeader
        titulo="Precificação"
        subtitulo="Monte o pedido com um ou mais produtos (ex.: copo + tirante) — o preço sai com o imposto certo, sem digitar alíquota"
        acoes={
          <Link to="/orcamentos-venda" className="btn btn-ghost text-sm">
            Ver histórico →
          </Link>
        }
      />

      {/* ---------- dados do orçamento (pedido inteiro) ---------- */}
      <div className="card px-5 py-4">
        <h2 className="mb-3 text-sm font-bold">Dados do orçamento</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Empresa de faturamento
            <select className="input mt-1 block w-full" value={empresaId ?? ''} onChange={(e) => setEmpresaId(Number(e.target.value))}>
              {(empresas || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome.split(' ').slice(0, 2).join(' ')} — {e.regime === 'simples' ? 'Simples Nacional' : 'Lucro Presumido'}
                </option>
              ))}
            </select>
            {empresaAtual && (
              <span className="help mt-1 block">
                Imposto do regime: {regimeInfo ? `${fmtPct(regimeInfo.aliquota_imposto)} (${regimeInfo.local_faturamento})` : '…'}
              </span>
            )}
          </label>
          <label className="text-sm">
            Local de faturamento (opcional)
            <select className="input mt-1 block w-full" value={local} onChange={(e) => setLocal(e.target.value)}>
              <option value="">Automático pelo regime</option>
              {(opcoes?.locais || []).map((l) => (
                <option key={l.local} value={l.local}>
                  {l.local} ({fmtPct(l.aliquota)})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Condição de pagamento
            <select className="input mt-1 block w-full" value={condicao} onChange={(e) => setCondicao(e.target.value)}>
              <option value="0">À vista</option>
              {[30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} dias
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Cliente
            <input className="input mt-1 block w-full" placeholder="ex.: Paróquia N. Sra. de Guadalupe" value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </label>
          <label className="text-sm">
            CNPJ do cliente
            <input
              className="input mt-1 block w-full"
              placeholder="00.000.000/0000-00"
              value={clienteCnpj}
              onChange={(e) => setClienteCnpj(e.target.value)}
            />
            <span className="help mt-1 block">Usado no faturamento (montar a nota no Omie).</span>
          </label>
        </div>
      </div>

      {/* ---------- itens do pedido ---------- */}
      <div className="mt-4 grid gap-3">
        {itens.map((linha, idx) => (
          <LinhaCard
            key={linha.id}
            linha={linha}
            indice={idx}
            total={itens.length}
            produtos={opcoes?.produtos || []}
            acabamentos={opcoes?.acabamentos || []}
            margemPadrao={margemPadrao}
            comissaoPadrao={comissaoPadrao}
            resultado={resultadoPorLinha.get(linha.id)}
            aPrazo={aPrazo}
            onChange={(patch) => atualizarLinha(linha.id, patch)}
            onRemover={itens.length > 1 ? () => setItens((a) => a.filter((l) => l.id !== linha.id)) : undefined}
          />
        ))}
      </div>

      <button className="btn btn-ghost mt-3 text-sm" onClick={() => setItens((a) => [...a, novaLinha()])}>
        + Adicionar produto
      </button>

      {calculo.isError && (
        <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--neg)' }}>
          {(calculo.error as Error).message}
        </p>
      )}
      {avisos.map((a) => (
        <p key={a} className="mt-3 text-sm font-semibold" style={{ color: 'var(--status-warning)' }}>
          ⚠ {a}
        </p>
      ))}

      {!pedido && calculo.isLoading && (
        <div className="mt-4">
          <Skeleton altura={120} />
        </div>
      )}

      {/* ---------- resumo do pedido ---------- */}
      {pedido && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            <KPICard titulo="Custo do pedido" valor={fmtBRL(pedido.custo_total)} />
            <KPICard titulo="Impostos" valor={fmtBRL(pedido.imposto_total)} />
            <KPICard titulo="Total à vista" valor={fmtBRL(pedido.total_a_vista)} hero={!aPrazo} />
            <KPICard
              titulo={aPrazo ? `Total a ${condicao} dias` : 'Total a prazo (30d)'}
              valor={fmtBRL(pedido.total_a_prazo)}
              hero={aPrazo}
            />
            <KPICard titulo={`Itens no pedido`} valor={String(linhasValidas.length)} sub={`${pedido.itens.reduce((s, i) => s + i.quantidade, 0).toLocaleString('pt-BR')} un`} />
          </div>

          {melhor && comparacao.data && comparacao.data.economia > 0.01 && (
            <div className="card mt-4 flex flex-wrap items-center gap-3 px-5 py-3.5" style={{ borderColor: 'var(--status-good)' }}>
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                style={{ background: 'color-mix(in srgb, var(--status-good) 18%, transparent)', color: 'var(--status-good-text)' }}
              >
                DICA
              </span>
              <span className="text-sm">
                Faturando o pedido pela <b>{melhor.empresa.split(' ').slice(0, 2).join(' ')}</b> ({fmtPct(melhor.aliquota_imposto)} de imposto) ele sai{' '}
                <b style={{ color: 'var(--status-good-text)' }}>{fmtBRL(comparacao.data.economia)} mais barato</b>.
              </span>
              {melhor.empresa_id !== empresaId && (
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => {
                    setEmpresaId(melhor.empresa_id)
                    setLocal('')
                  }}
                >
                  Usar essa empresa
                </button>
              )}
            </div>
          )}

          {/* salvar + PDF */}
          <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="text-sm font-bold">Total do pedido</div>
              <div className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--accent)' }}>
                {fmtBRL(aPrazo ? pedido.total_a_prazo : pedido.total_a_vista)}
              </div>
              <p className="help mt-1">O cálculo é congelado no orçamento (snapshot) com autor e data. Depois de enviado, vira imutável.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={!cliente.trim() || !entradas || salvar.isPending || !!salvo}
                onClick={() => salvar.mutate()}
              >
                {salvar.isPending ? 'Salvando…' : salvo ? `Salvo: ${salvo.numero}` : 'Salvar orçamento'}
              </button>
              {salvo && (
                <button
                  className="btn btn-ghost"
                  disabled={gerandoPdf}
                  onClick={async () => {
                    setGerandoPdf(true)
                    try {
                      await baixarArquivo(api.urlPdfOrcamento(salvo.id), `proposta_${salvo.numero}.pdf`)
                    } finally {
                      setGerandoPdf(false)
                    }
                  }}
                >
                  {gerandoPdf ? 'Gerando…' : 'Gerar PDF da proposta'}
                </button>
              )}
              {!cliente.trim() && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Informe o cliente para salvar
                </span>
              )}
            </div>
          </div>
          {salvar.isError && (
            <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
              {(salvar.error as Error).message}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** Cartão de um item do pedido: campos do produto + resultado da linha em tempo real. */
function LinhaCard({
  linha,
  indice,
  total,
  produtos,
  acabamentos,
  margemPadrao,
  comissaoPadrao,
  resultado,
  aPrazo,
  onChange,
  onRemover,
}: {
  linha: LinhaItem
  indice: number
  total: number
  produtos: { id: number; nome: string }[]
  acabamentos: string[]
  margemPadrao: string
  comissaoPadrao: string
  resultado?: ResultadoCalculo
  aPrazo: boolean
  onChange: (patch: Partial<LinhaItem>) => void
  onRemover?: () => void
}) {
  const preco = resultado ? (aPrazo ? resultado.preco_a_prazo : resultado.preco_a_vista) : null
  const totalLinha = resultado ? resultado.total : null

  return (
    <div className="card px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{total > 1 ? `Item ${indice + 1}` : 'Produto'}</h3>
        {onRemover && (
          <button className="btn btn-perigo px-2 py-1 text-xs" onClick={onRemover}>
            Remover
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          Produto
          <select
            className="input mt-1 block w-full"
            value={linha.produtoId ?? ''}
            onChange={(e) => onChange({ produtoId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— só extras/label —</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Quantidade
          <input type="number" min="1" className="input mt-1 block w-full" value={linha.quantidade} onChange={(e) => onChange({ quantidade: e.target.value })} />
        </label>
        <label className="text-sm">
          Acabamento do label
          <select className="input mt-1 block w-full" value={linha.acabamento} onChange={(e) => onChange({ acabamento: e.target.value })}>
            <option value="sem_label">Sem label</option>
            {acabamentos.map((a) => (
              <option key={a} value={a}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Margem (%)
          <input
            type="number"
            min="0"
            max="90"
            step="0.5"
            className="input mt-1 block w-full"
            placeholder={margemPadrao}
            value={linha.margem}
            onChange={(e) => onChange({ margem: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Comissão (%)
          <input
            type="number"
            min="0"
            max="50"
            step="0.5"
            className="input mt-1 block w-full"
            placeholder={comissaoPadrao}
            value={linha.comissao}
            onChange={(e) => onChange({ comissao: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={linha.portaCopo} onChange={(e) => onChange({ portaCopo: e.target.checked })} />
            Porta-copo PVC
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Custo extra (nome)
          <input className="input mt-1 block w-40" placeholder="ex.: ferramental" value={linha.extraNome} onChange={(e) => onChange({ extraNome: e.target.value })} />
        </label>
        <label className="text-sm">
          Custo extra (R$/un)
          <input type="number" min="0" step="0.01" className="input mt-1 block w-32" value={linha.extraValor} onChange={(e) => onChange({ extraValor: e.target.value })} />
        </label>
      </div>

      {/* resultado da linha */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-3 text-sm" style={{ borderColor: 'var(--gridline)' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          Custo unit. <b className="num" style={{ color: 'var(--text-primary)' }}>{resultado ? fmtBRL(resultado.custo_unitario) : '—'}</b>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          Imposto <b className="num" style={{ color: 'var(--text-primary)' }}>{resultado ? fmtPct(resultado.aliquota_imposto) : '—'}</b>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          {aPrazo ? 'Preço a prazo' : 'Preço à vista'}{' '}
          <b className="num" style={{ color: 'var(--status-good-text)' }}>{preco !== null ? fmtBRL(preco) : '—'}</b>
        </span>
        <span className="ml-auto font-bold" style={{ color: 'var(--text-muted)' }}>
          Total do item <b className="num text-base" style={{ color: 'var(--accent)' }}>{totalLinha !== null ? fmtBRL(totalLinha) : '—'}</b>
        </span>
      </div>
    </div>
  )
}
