import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type FaixaLabel } from '../api/client'
import { PageHeader } from '../components/Layout'
import { Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

type Aba = 'produtos' | 'labels' | 'aliquotas' | 'parametros'

export default function CadastroPrecificacao() {
  const [aba, setAba] = useState<Aba>('produtos')
  return (
    <div>
      <PageHeader
        titulo="Cadastros de precificação"
        subtitulo="Produtos, tabelas de label, alíquotas e parâmetros — a cliente mantém os preços sem depender de ninguém"
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(
          [
            ['produtos', 'Produtos'],
            ['labels', 'Tabela de label'],
            ['aliquotas', 'Alíquotas'],
            ['parametros', 'Parâmetros'],
          ] as [Aba, string][]
        ).map(([chave, rotulo]) => (
          <button key={chave} className={`tab ${aba === chave ? 'tab-ativa' : ''}`} onClick={() => setAba(chave)}>
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'produtos' && <Produtos />}
      {aba === 'labels' && <TabelaLabels />}
      {aba === 'aliquotas' && <Aliquotas />}
      {aba === 'parametros' && <Parametros />}
    </div>
  )
}

function useInvalidar() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['prec-opcoes'] })
    qc.invalidateQueries({ queryKey: ['cad-labels'] })
  }
}

// ============================ Produtos ============================

const CATEGORIAS = ['copo', 'balde', 'bowl', 'tirante', 'label', 'outro']

function Produtos() {
  const invalidar = useInvalidar()
  const { data: opcoes, isLoading } = useQuery({ queryKey: ['prec-opcoes'], queryFn: api.precificacaoOpcoes })
  const [novoNome, setNovoNome] = useState('')
  const [novaCategoria, setNovaCategoria] = useState('copo')
  const [novoCusto, setNovoCusto] = useState('')
  const [editando, setEditando] = useState<number | null>(null)
  const [custoEdit, setCustoEdit] = useState('')

  const criar = useMutation({
    mutationFn: () => api.criarProduto({ nome: novoNome.trim(), categoria: novaCategoria, custo_base: Number(novoCusto) || 0, ativo: true }),
    onSuccess: () => {
      setNovoNome('')
      setNovoCusto('')
      invalidar()
    },
  })
  const editar = useMutation({
    mutationFn: ({ id, nome, categoria, custo }: { id: number; nome: string; categoria: string; custo: number }) =>
      api.editarProduto(id, { nome, categoria, custo_base: custo, ativo: true }),
    onSuccess: () => {
      setEditando(null)
      invalidar()
    },
  })
  const excluir = useMutation({ mutationFn: (id: number) => api.excluirProduto(id), onSuccess: invalidar })

  if (isLoading) return <Skeleton altura={190} />
  return (
    <div className="card px-5 py-4">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Novo produto
          <input className="input mt-1 block w-52" placeholder="ex.: Copo 550ml" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
        </label>
        <label className="text-sm">
          Categoria
          <select className="input mt-1 block w-32" value={novaCategoria} onChange={(e) => setNovaCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Custo base (R$/un)
          <input type="number" min="0" step="0.0001" className="input mt-1 block w-32" value={novoCusto} onChange={(e) => setNovoCusto(e.target.value)} />
        </label>
        <button className="btn btn-primary" disabled={!novoNome.trim() || criar.isPending} onClick={() => criar.mutate()}>
          Adicionar
        </button>
      </div>
      <table className="tabela w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">Produto</th>
            <th className="text-left">Categoria</th>
            <th className="text-right">Custo base</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(opcoes?.produtos || []).map((p) => (
            <tr key={p.id}>
              <td className="font-semibold">{p.nome}</td>
              <td>{p.categoria}</td>
              <td className="num text-right">
                {editando === p.id ? (
                  <input
                    type="number"
                    step="0.0001"
                    className="input w-28 text-right"
                    value={custoEdit}
                    autoFocus
                    onChange={(e) => setCustoEdit(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' && editar.mutate({ id: p.id, nome: p.nome, categoria: p.categoria, custo: Number(custoEdit) || 0 })
                    }
                  />
                ) : (
                  fmtBRL(p.custo_base)
                )}
              </td>
              <td>
                <div className="flex justify-end gap-1.5">
                  {editando === p.id ? (
                    <button
                      className="btn btn-primary px-2 py-1 text-xs"
                      onClick={() => editar.mutate({ id: p.id, nome: p.nome, categoria: p.categoria, custo: Number(custoEdit) || 0 })}
                    >
                      Salvar
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost px-2 py-1 text-xs"
                      onClick={() => {
                        setEditando(p.id)
                        setCustoEdit(String(p.custo_base))
                      }}
                    >
                      Editar custo
                    </button>
                  )}
                  <button className="btn btn-ghost px-2 py-1 text-xs" style={{ color: 'var(--neg)' }} onClick={() => excluir.mutate(p.id)}>
                    Desativar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="help mt-3">Desativar não apaga: orçamentos antigos continuam apontando para o produto (auditoria).</p>
    </div>
  )
}

// ============================ Tabela de label ============================

function TabelaLabels() {
  const invalidar = useInvalidar()
  const { data: tabelas, isLoading } = useQuery({ queryKey: ['cad-labels'], queryFn: api.listarTabelasLabel })
  const [acabamento, setAcabamento] = useState('')
  const [faixas, setFaixas] = useState<FaixaLabel[]>([])

  useEffect(() => {
    if (tabelas?.length && !acabamento) setAcabamento(tabelas[0].acabamento)
  }, [tabelas, acabamento])
  useEffect(() => {
    const t = tabelas?.find((t) => t.acabamento === acabamento)
    if (t) setFaixas(t.faixas.map((f) => ({ ...f })))
  }, [tabelas, acabamento])

  const salvar = useMutation({
    mutationFn: () => api.salvarTabelaLabel(acabamento, faixas.filter((f) => f.quantidade_min > 0)),
    onSuccess: invalidar,
  })

  if (isLoading) return <Skeleton altura={190} />
  return (
    <div className="card px-5 py-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Acabamento
          <select className="input mt-1 block w-44" value={acabamento} onChange={(e) => setAcabamento(e.target.value)}>
            {(tabelas || []).map((t) => (
              <option key={t.acabamento} value={t.acabamento}>
                {t.acabamento}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost text-sm" onClick={() => setFaixas([...faixas, { quantidade_min: 0, preco_unitario: 0 }])}>
          + Faixa
        </button>
        <button className="btn btn-primary text-sm" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? 'Salvando…' : 'Salvar tabela'}
        </button>
        {salvar.isSuccess && <span className="text-xs font-bold" style={{ color: 'var(--status-good-text)' }}>Salvo ✓</span>}
      </div>
      <div className="grid gap-1.5" style={{ maxWidth: 420 }}>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
          <span>A partir de (un)</span>
          <span>Preço unitário (R$)</span>
          <span />
        </div>
        {faixas.map((f, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <input
              type="number"
              min="1"
              className="input"
              value={f.quantidade_min || ''}
              onChange={(e) => setFaixas(faixas.map((x, j) => (j === i ? { ...x, quantidade_min: Number(e.target.value) } : x)))}
            />
            <input
              type="number"
              min="0"
              step="0.0001"
              className="input"
              value={f.preco_unitario}
              onChange={(e) => setFaixas(faixas.map((x, j) => (j === i ? { ...x, preco_unitario: Number(e.target.value) } : x)))}
            />
            <button className="btn btn-ghost px-2 py-1 text-xs" style={{ color: 'var(--neg)' }} onClick={() => setFaixas(faixas.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <p className="help mt-3">O cálculo usa a maior faixa ≤ quantidade do pedido (preço cai com a escala, como na planilha).</p>
    </div>
  )
}

// ============================ Alíquotas ============================

function Aliquotas() {
  const qc = useQueryClient()
  const { data: opcoes, isLoading } = useQuery({ queryKey: ['prec-opcoes'], queryFn: api.precificacaoOpcoes })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const salvar = useMutation({
    mutationFn: ({ local, aliquota }: { local: string; aliquota: number }) => api.salvarAliquota(local, aliquota),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prec-opcoes'] }),
  })

  if (isLoading) return <Skeleton altura={190} />
  return (
    <div className="card px-5 py-4" style={{ maxWidth: 560 }}>
      <div className="grid gap-1.5">
        {(opcoes?.locais || []).map((l) => {
          const valor = edits[l.local] ?? String(l.aliquota * 100)
          const mudou = Number(valor) !== l.aliquota * 100
          return (
            <div key={l.local} className="grid grid-cols-[1fr_120px_90px] items-center gap-2 text-sm">
              <span>
                {l.local}
                {l.regime && (
                  <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    ({l.regime === 'simples' ? 'Simples' : 'Presumido'})
                  </span>
                )}
              </span>
              <input
                type="number"
                min="0"
                max="60"
                step="0.05"
                className="input text-right"
                value={valor}
                onChange={(e) => setEdits({ ...edits, [l.local]: e.target.value })}
              />
              <button
                className="btn btn-primary px-2 py-1 text-xs"
                disabled={!mudou || salvar.isPending}
                onClick={() => salvar.mutate({ local: l.local, aliquota: Number(valor) / 100 })}
              >
                Salvar
              </button>
            </div>
          )
        })}
      </div>
      <p className="help mt-3">
        Valores em % sobre a venda. O regime da empresa escolhe a linha automaticamente ("Simples Nacional" ou "Demais estados"); o
        vendedor pode sobrescrever escolhendo o local na calculadora.
      </p>
    </div>
  )
}

// ============================ Parâmetros ============================

function Parametros() {
  const qc = useQueryClient()
  const { data: opcoes, isLoading } = useQuery({ queryKey: ['prec-opcoes'], queryFn: api.precificacaoOpcoes })
  const [form, setForm] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (opcoes && !form)
      setForm({
        margem_padrao: String(opcoes.parametros.margem_padrao * 100),
        comissao_padrao: String(opcoes.parametros.comissao_padrao * 100),
        custo_fixo_padrao: String(opcoes.parametros.custo_fixo_padrao * 100),
        juros_mes: String(opcoes.parametros.juros_mes * 100),
        prazo_padrao: String(opcoes.parametros.prazo_padrao),
      })
  }, [opcoes, form])

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarParametrosPrecificacao({
        margem_padrao: Number(form!.margem_padrao) / 100,
        comissao_padrao: Number(form!.comissao_padrao) / 100,
        custo_fixo_padrao: Number(form!.custo_fixo_padrao) / 100,
        juros_mes: Number(form!.juros_mes) / 100,
        prazo_padrao: Number(form!.prazo_padrao),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prec-opcoes'] }),
  })

  if (isLoading || !form) return <Skeleton altura={190} />
  const campo = (chave: string, rotulo: string, sufixo: string) => (
    <label className="text-sm">
      {rotulo}
      <div className="mt-1 flex items-center gap-1.5">
        <input type="number" min="0" step="0.1" className="input block w-28" value={form[chave]} onChange={(e) => setForm({ ...form, [chave]: e.target.value })} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sufixo}</span>
      </div>
    </label>
  )
  return (
    <div className="card px-5 py-4" style={{ maxWidth: 560 }}>
      <div className="grid grid-cols-2 gap-4">
        {campo('margem_padrao', 'Margem padrão', '%')}
        {campo('comissao_padrao', 'Comissão padrão', '%')}
        {campo('custo_fixo_padrao', 'Contribuição custo fixo', '%')}
        {campo('juros_mes', 'Custo financeiro', '% a.m.')}
        {campo('prazo_padrao', 'Prazo padrão', 'dias')}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button className="btn btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? 'Salvando…' : 'Salvar parâmetros'}
        </button>
        {salvar.isSuccess && <span className="text-xs font-bold" style={{ color: 'var(--status-good-text)' }}>Salvo ✓</span>}
      </div>
      <p className="help mt-3">
        Estes são os valores que a calculadora usa quando o vendedor não altera nada. Hoje: margem {opcoes ? fmtPct(opcoes.parametros.margem_padrao) : ''} ·
        comissão {opcoes ? fmtPct(opcoes.parametros.comissao_padrao) : ''} · juros {opcoes ? fmtPct(opcoes.parametros.juros_mes) : ''} a.m.
      </p>
    </div>
  )
}
