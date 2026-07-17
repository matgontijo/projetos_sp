import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, baixarArquivo, type EntradaCalculo } from '../api/client'
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

const GRUPO_LABEL: Record<string, string> = {
  insumo: 'Insumo',
  label: 'Label',
  tirante: 'Tirante',
  frete: 'Frete',
  porta_copo: 'Porta-copo',
  outros: 'Outros',
}

export default function Precificacao() {
  const { data: empresas } = useQuery({ queryKey: ['prec-empresas'], queryFn: api.precificacaoEmpresas })
  const { data: opcoes } = useQuery({ queryKey: ['prec-opcoes'], queryFn: api.precificacaoOpcoes })

  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [produtoId, setProdutoId] = useState<number | null>(null)
  const [quantidade, setQuantidade] = useState('1000')
  const [acabamento, setAcabamento] = useState('liso')
  const [local, setLocal] = useState('') // vazio = automático pelo regime da empresa
  const [condicao, setCondicao] = useState('0')
  const [margem, setMargem] = useState('')
  const [comissao, setComissao] = useState('')
  const [portaCopo, setPortaCopo] = useState(false)
  const [extraNome, setExtraNome] = useState('')
  const [extraValor, setExtraValor] = useState('')
  const [cliente, setCliente] = useState('')
  const [salvo, setSalvo] = useState<{ id: number; numero: string } | null>(null)

  // defaults quando as opções chegam
  useEffect(() => {
    if (opcoes && margem === '') setMargem(String(opcoes.parametros.margem_padrao * 100))
    if (opcoes && comissao === '') setComissao(String(opcoes.parametros.comissao_padrao * 100))
  }, [opcoes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (empresas?.length && empresaId === null) setEmpresaId(empresas[0].id)
  }, [empresas, empresaId])

  const qtd = Number(quantidade) || 0
  const entrada: EntradaCalculo | null =
    empresaId && qtd > 0
      ? {
          produto_id: produtoId,
          quantidade: qtd,
          acabamento,
          empresa_faturamento_id: empresaId,
          local_faturamento: local || null,
          condicao_pagamento_dias: Number(condicao) || 0,
          margem: margem === '' ? null : Number(margem) / 100,
          comissao: comissao === '' ? null : Number(comissao) / 100,
          porta_copo: portaCopo,
          extras: extraValor && Number(extraValor) > 0 ? [{ nome: extraNome || 'Custo extra', valor: Number(extraValor) }] : [],
        }
      : null
  const entradaLenta = useDebounce(entrada)

  const calculo = useQuery({
    queryKey: ['prec-calc', entradaLenta],
    queryFn: () => api.precificacaoCalcular(entradaLenta!),
    enabled: !!entradaLenta,
    placeholderData: (prev) => prev,
  })
  const comparacao = useQuery({
    queryKey: ['prec-comp', entradaLenta],
    queryFn: () => api.precificacaoComparar(entradaLenta!),
    enabled: !!entradaLenta && (empresas?.length || 0) > 1,
    placeholderData: (prev) => prev,
  })

  const salvar = useMutation({
    mutationFn: () => api.criarOrcamentoVenda({ cliente, itens: [entrada!] }),
    onSuccess: (r) => setSalvo({ id: r.id, numero: r.numero }),
  })
  // qualquer mudança na configuração invalida o "salvo" (o preço mudou)
  useEffect(() => setSalvo(null), [entradaLenta])

  const [gerandoPdf, setGerandoPdf] = useState(false)
  const r = calculo.data
  const empresaAtual = empresas?.find((e) => e.id === empresaId)
  const aPrazo = (Number(condicao) || 0) > 0
  const melhor = comparacao.data?.cenarios.find((c) => c.empresa_id === comparacao.data?.melhor_empresa_id)

  return (
    <div>
      <PageHeader
        titulo="Precificação"
        subtitulo="Escolha a empresa, o produto e a quantidade — o preço sai com o imposto certo, sem digitar alíquota"
        acoes={
          <Link to="/orcamentos-venda" className="btn btn-ghost text-sm">
            Ver histórico →
          </Link>
        }
      />

      <div className="card px-5 py-4">
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
                Imposto do regime: {r ? `${fmtPct(r.aliquota_imposto)} (${r.local_faturamento})` : '…'}
              </span>
            )}
          </label>
          <label className="text-sm">
            Produto
            <select
              className="input mt-1 block w-full"
              value={produtoId ?? ''}
              onChange={(e) => setProdutoId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— só extras/label —</option>
              {(opcoes?.produtos || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Quantidade
            <input type="number" min="1" className="input mt-1 block w-full" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </label>
          <label className="text-sm">
            Acabamento do label
            <select className="input mt-1 block w-full" value={acabamento} onChange={(e) => setAcabamento(e.target.value)}>
              <option value="sem_label">Sem label</option>
              {(opcoes?.acabamentos || []).map((a) => (
                <option key={a} value={a}>
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
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
            Margem (%)
            <input type="number" min="0" max="90" step="0.5" className="input mt-1 block w-full" value={margem} onChange={(e) => setMargem(e.target.value)} />
          </label>
          <label className="text-sm">
            Comissão (%)
            <input type="number" min="0" max="50" step="0.5" className="input mt-1 block w-full" value={comissao} onChange={(e) => setComissao(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={portaCopo} onChange={(e) => setPortaCopo(e.target.checked)} />
            Porta-copo PVC
          </label>
          <label className="text-sm">
            Custo extra (nome)
            <input className="input mt-1 block w-40" placeholder="ex.: ferramental" value={extraNome} onChange={(e) => setExtraNome(e.target.value)} />
          </label>
          <label className="text-sm">
            Custo extra (R$/un)
            <input type="number" min="0" step="0.01" className="input mt-1 block w-32" value={extraValor} onChange={(e) => setExtraValor(e.target.value)} />
          </label>
        </div>
        {calculo.isError && (
          <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--neg)' }}>
            {(calculo.error as Error).message}
          </p>
        )}
        {r?.aviso && (
          <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--status-warning)' }}>
            ⚠ {r.aviso}
          </p>
        )}
      </div>

      {!r && calculo.isLoading && <div className="mt-4"><Skeleton altura={160} /></div>}

      {r && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KPICard titulo="Custo unitário" valor={fmtBRL(r.custo_unitario)} />
            <KPICard titulo="Imposto" valor={fmtPct(r.aliquota_imposto)} sub={fmtBRL(r.imposto_unitario) + '/un'} />
            <KPICard titulo="Margem" valor={fmtPct(r.margem)} sub={fmtBRL(r.margem_valor_unitario) + '/un'} />
            <KPICard titulo="Preço à vista" valor={fmtBRL(r.preco_a_vista)} hero={!aPrazo} />
            <KPICard
              titulo={aPrazo ? `Preço a ${condicao} dias` : 'Preço a prazo (30d)'}
              valor={fmtBRL(r.preco_a_prazo)}
             
              hero={aPrazo}
              sub={r.custo_financeiro_unitario > 0 ? `+${fmtBRL(r.custo_financeiro_unitario)} fin.` : undefined}
            />
            <KPICard titulo={`Total (${r.quantidade.toLocaleString('pt-BR')} un)`} valor={fmtBRL(r.total)} hero />
          </div>

          {melhor && comparacao.data && comparacao.data.economia > 0.01 && (
            <div
              className="card mt-4 flex flex-wrap items-center gap-3 px-5 py-3.5"
              style={{ borderColor: 'var(--status-good)' }}
            >
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                style={{ background: 'color-mix(in srgb, var(--status-good) 18%, transparent)', color: 'var(--status-good-text)' }}
              >
                DICA
              </span>
              <span className="text-sm">
                Faturando pela <b>{melhor.empresa.split(' ').slice(0, 2).join(' ')}</b> ({fmtPct(melhor.aliquota_imposto)} de imposto) o
                pedido sai <b style={{ color: 'var(--status-good-text)' }}>{fmtBRL(comparacao.data.economia)} mais barato</b>.
              </span>
              {melhor.empresa_id !== empresaId && (
                <button className="btn btn-ghost text-xs" onClick={() => { setEmpresaId(melhor.empresa_id); setLocal('') }}>
                  Usar essa empresa
                </button>
              )}
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card px-5 py-4">
              <h2 className="mb-2 text-sm font-bold">Composição do custo (por unidade)</h2>
              <div className="grid gap-1.5">
                {r.componentes.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {c.nome} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({GRUPO_LABEL[c.grupo] || c.grupo})</span>
                    </span>
                    <b className="num">{fmtBRL(c.valor)}</b>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between gap-3 border-t pt-2 text-sm" style={{ borderColor: 'var(--gridline)' }}>
                  <b>Custo total</b>
                  <b className="num">{fmtBRL(r.custo_unitario)}</b>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span>÷ fator de venda (1 − imposto − margem − comissão)</span>
                  <span className="num">{r.fator_venda.toFixed(4).replace('.', ',')}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <b>= Preço à vista</b>
                  <b className="num" style={{ color: 'var(--status-good-text)' }}>{fmtBRL(r.preco_a_vista)}</b>
                </div>
              </div>
            </div>

            <div className="card px-5 py-4">
              <h2 className="mb-2 text-sm font-bold">Salvar orçamento</h2>
              <label className="block text-sm">
                Cliente
                <input className="input mt-1 block w-full" placeholder="ex.: Paróquia Nossa Senhora de Guadalupe" value={cliente} onChange={(e) => setCliente(e.target.value)} />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-primary"
                  disabled={!cliente.trim() || !entrada || salvar.isPending || !!salvo}
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
              </div>
              {salvar.isError && (
                <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
                  {(salvar.error as Error).message}
                </p>
              )}
              <p className="help mt-3">
                O cálculo é congelado no orçamento (snapshot) com autor e data. Depois de enviado, vira imutável — auditoria garantida.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
