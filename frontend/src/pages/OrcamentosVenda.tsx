import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, baixarArquivo, usuarioLogado, type OrcamentoVenda } from '../api/client'
import { PageHeader } from '../components/Layout'
import { KPICard, Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

const STATUS_COR: Record<string, { fundo: string; texto: string; rotulo: string }> = {
  rascunho: { fundo: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', texto: 'var(--text-secondary)', rotulo: 'Rascunho' },
  enviado: { fundo: 'color-mix(in srgb, var(--serie-producao) 18%, transparent)', texto: 'var(--serie-producao)', rotulo: 'Enviado' },
  aprovado: { fundo: 'color-mix(in srgb, var(--status-good) 18%, transparent)', texto: 'var(--status-good-text)', rotulo: 'Aprovado' },
}

function BadgeStatus({ status }: { status: string }) {
  const s = STATUS_COR[status] || STATUS_COR.rascunho
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold" style={{ background: s.fundo, color: s.texto }}>
      {s.rotulo}
    </span>
  )
}

export default function OrcamentosVenda() {
  const usuario = usuarioLogado()
  const queryClient = useQueryClient()
  const [cliente, setCliente] = useState('')
  const [status, setStatus] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [abertoId, setAbertoId] = useState<number | null>(null)
  const [faturarId, setFaturarId] = useState<number | null>(null)
  const [baixando, setBaixando] = useState('')

  const { data: empresas } = useQuery({ queryKey: ['prec-empresas'], queryFn: api.precificacaoEmpresas })
  const filtros = { cliente: cliente || undefined, status: status || undefined, empresa_id: empresaId || undefined, de: de || undefined, ate: ate || undefined }
  const lista = useQuery({
    queryKey: ['orc-venda', filtros],
    queryFn: () => api.listarOrcamentosVenda(filtros),
    placeholderData: (prev) => prev,
  })
  const resumo = useQuery({
    queryKey: ['orc-resumo'],
    queryFn: api.resumoOrcamentos,
    enabled: usuario?.papel === 'admin',
  })
  const detalhe = useQuery({
    queryKey: ['orc-detalhe', abertoId],
    queryFn: () => api.detalheOrcamentoVenda(abertoId!),
    enabled: abertoId !== null,
  })

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ['orc-venda'] })
    queryClient.invalidateQueries({ queryKey: ['orc-resumo'] })
    queryClient.invalidateQueries({ queryKey: ['orc-detalhe'] })
  }
  const mudarStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.mudarStatusOrcamento(id, status),
    onSuccess: invalidar,
  })
  const excluir = useMutation({ mutationFn: (id: number) => api.excluirOrcamentoVenda(id), onSuccess: invalidar })

  async function baixar(chave: string, url: string, nome: string) {
    setBaixando(chave)
    try {
      await baixarArquivo(url, nome)
    } finally {
      setBaixando('')
    }
  }

  const orcamentos = lista.data || []
  const d = detalhe.data
  const snap = d?.snapshot?.itens?.[0]

  return (
    <div>
      <PageHeader
        titulo="Orçamentos"
        subtitulo="Histórico com o cálculo congelado de cada proposta — quem fez, quando e por qual empresa"
        acoes={
          <>
            <Link to="/precificacao" className="btn btn-primary text-sm">
              + Novo orçamento
            </Link>
            <button className="btn btn-ghost text-sm" disabled={baixando === 'xlsx'} onClick={() => baixar('xlsx', api.urlExportOrcamentos('xlsx'), 'orcamentos.xlsx')}>
              {baixando === 'xlsx' ? 'Gerando…' : 'Excel'}
            </button>
            <button className="btn btn-ghost text-sm" disabled={baixando === 'csv'} onClick={() => baixar('csv', api.urlExportOrcamentos('csv'), 'orcamentos.csv')}>
              {baixando === 'csv' ? 'Gerando…' : 'CSV'}
            </button>
          </>
        }
      />

      {usuario?.papel === 'admin' && resumo.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPICard titulo="Orçamentos no mês" valor={String(resumo.data.orcamentos_mes)} sub={fmtBRL(resumo.data.total_mes)} />
          <KPICard titulo="Ticket médio" valor={fmtBRL(resumo.data.ticket_medio)} />
          <KPICard titulo="Margem média" valor={fmtPct(resumo.data.margem_media)} />
          <KPICard
            titulo="Aprovados / enviados"
            valor={`${resumo.data.por_status.aprovado || 0} / ${resumo.data.por_status.enviado || 0}`}
            sub={`${resumo.data.por_status.rascunho || 0} rascunhos`}
          />
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 px-5 py-3.5">
        <label className="text-sm">
          Cliente
          <input className="input mt-1 block w-44" placeholder="buscar…" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </label>
        <label className="text-sm">
          Empresa
          <select className="input mt-1 block w-40" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            <option value="">Todas</option>
            {(empresas || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome.split(' ').slice(0, 2).join(' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select className="input mt-1 block w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="rascunho">Rascunho</option>
            <option value="enviado">Enviado</option>
            <option value="aprovado">Aprovado</option>
          </select>
        </label>
        <label className="text-sm">
          De
          <input type="date" className="input mt-1 block" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="text-sm">
          Até
          <input type="date" className="input mt-1 block" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
      </div>

      {lista.isLoading && <div className="mt-4"><Skeleton altura={190} /></div>}
      {lista.isError && (
        <p className="mt-4 text-sm" style={{ color: 'var(--neg)' }}>
          {(lista.error as Error).message}
        </p>
      )}

      {!lista.isLoading && orcamentos.length === 0 && (
        <div className="card mt-4">
          <div className="vazio">
            <span className="vazio-titulo">
              Nenhum orçamento {cliente || status || de ? 'com esses filtros' : 'ainda'}
            </span>
            <Link to="/precificacao" className="font-bold hover:underline" style={{ color: 'var(--accent)' }}>
              Criar o primeiro →
            </Link>
          </div>
        </div>
      )}

      {orcamentos.length > 0 && (
        <div className="card mt-4 overflow-x-auto">
          <table className="tabela w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Número</th>
                <th className="text-left">Cliente</th>
                <th className="text-left">Empresa</th>
                <th className="text-right">Qtde</th>
                <th className="text-right">Unitário</th>
                <th className="text-right">Total</th>
                <th className="text-left">Condição</th>
                <th className="text-left">Status</th>
                <th className="text-left">Criado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orcamentos.map((o: OrcamentoVenda) => (
                <tr key={o.id} className="cursor-pointer" onClick={() => setAbertoId(o.id)}>
                  <td className="font-bold">{o.numero}</td>
                  <td className="max-w-44 truncate" title={o.cliente}>{o.cliente || '—'}</td>
                  <td>{o.empresa.split(' ').slice(0, 2).join(' ')}</td>
                  <td className="num text-right">{o.quantidade.toLocaleString('pt-BR')}</td>
                  <td className="num text-right">{fmtBRL(o.preco_unitario)}</td>
                  <td className="num text-right font-bold">{fmtBRL(o.total)}</td>
                  <td>{o.condicao}</td>
                  <td>
                    <BadgeStatus status={o.status} />
                  </td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {o.criado_por}
                    <br />
                    {o.criado_em ? new Date(o.criado_em).toLocaleDateString('pt-BR') : ''}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {o.status === 'rascunho' && (
                        <>
                          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => mudarStatus.mutate({ id: o.id, status: 'enviado' })}>
                            Enviar
                          </button>
                          <button
                            className="btn btn-ghost px-2 py-1 text-xs"
                            style={{ color: 'var(--neg)' }}
                            onClick={() => excluir.mutate(o.id)}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                      {o.status === 'enviado' && (
                        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => mudarStatus.mutate({ id: o.id, status: 'aprovado' })}>
                          Aprovar
                        </button>
                      )}
                      {o.status === 'aprovado' && (
                        <button
                          className="btn btn-ghost px-2 py-1 text-xs font-bold"
                          style={{ color: 'var(--status-good-text)' }}
                          onClick={() => setFaturarId(o.id)}
                        >
                          Faturar
                        </button>
                      )}
                      <button
                        className="btn btn-ghost px-2 py-1 text-xs"
                        disabled={baixando === `pdf${o.id}`}
                        onClick={() => baixar(`pdf${o.id}`, api.urlPdfOrcamento(o.id), `proposta_${o.numero}.pdf`)}
                      >
                        {baixando === `pdf${o.id}` ? '…' : 'PDF'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(mudarStatus.isError || excluir.isError) && (
        <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
          {((mudarStatus.error || excluir.error) as Error).message}
        </p>
      )}

      {/* detalhe: cálculo congelado */}
      {abertoId !== null && (
        <div
          className="fixed inset-0 z-40 grid place-items-center p-4"
          style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
          onClick={() => setAbertoId(null)}
        >
          <div className="card max-h-[85vh] w-full max-w-xl overflow-y-auto px-6 py-5" onClick={(e) => e.stopPropagation()}>
            {detalhe.isLoading && <Skeleton altura={160} />}
            {d && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold">{d.numero}</h2>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {d.cliente || 'Sem cliente'} · {d.empresa} · {d.condicao}
                    </p>
                  </div>
                  <BadgeStatus status={d.status} />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <KPICard titulo="Preço unitário" valor={fmtBRL(d.preco_unitario)} />
                  <KPICard titulo="Quantidade" valor={d.quantidade.toLocaleString('pt-BR')} />
                  <KPICard titulo="Total" valor={fmtBRL(d.total)} />
                </div>

                {snap && (
                  <div className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--surface-2)' }}>
                    <div className="titulo-secao mb-2">Cálculo congelado (snapshot)</div>
                    {snap.componentes.map((c, i) => (
                      <div key={i} className="flex justify-between">
                        <span style={{ color: 'var(--text-secondary)' }}>{c.nome}</span>
                        <span className="num">{fmtBRL(c.valor)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex justify-between border-t pt-1" style={{ borderColor: 'var(--gridline)' }}>
                      <span>Custo unitário</span>
                      <b className="num">{fmtBRL(snap.custo_unitario)}</b>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>Imposto ({snap.local_faturamento})</span>
                      <span className="num">{fmtPct(snap.aliquota_imposto)}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>Margem</span>
                      <span className="num">{fmtPct(snap.margem)}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                      <span>Comissão</span>
                      <span className="num">{fmtPct(snap.comissao)}</span>
                    </div>
                    {snap.custo_financeiro_unitario > 0 && (
                      <div className="flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                        <span>Custo financeiro</span>
                        <span className="num">{fmtBRL(snap.custo_financeiro_unitario)}/un</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Criado por <b>{d.criado_por}</b>
                  {d.criado_em && <> em {new Date(d.criado_em).toLocaleString('pt-BR')}</>} — o snapshot não muda mesmo se tabelas e
                  alíquotas mudarem depois.
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button className="btn btn-ghost text-sm" onClick={() => setFaturarId(d.id)}>
                    Resumo p/ faturamento
                  </button>
                  <button
                    className="btn btn-ghost text-sm"
                    disabled={baixando === `pdfd${d.id}`}
                    onClick={() => baixar(`pdfd${d.id}`, api.urlPdfOrcamento(d.id), `proposta_${d.numero}.pdf`)}
                  >
                    {baixando === `pdfd${d.id}` ? 'Gerando…' : 'PDF da proposta'}
                  </button>
                  <button className="btn btn-primary text-sm" onClick={() => setAbertoId(null)}>
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* resumo para o faturamento no Omie (só leitura — o app não emite nota) */}
      {faturarId !== null && <ResumoFaturamento id={faturarId} onClose={() => setFaturarId(null)} />}
    </div>
  )
}

/** Campos fiscais que o app NÃO tem — o Paulo completa no Omie ao montar a nota. */
const CAMPOS_OMIE = ['Endereço do cliente', 'Natureza da operação (CFOP)', 'NCM de cada produto', 'Transportadora / frete']

/** Resumo para faturamento: tudo que o Paulo precisa pra digitar a nota no Omie. */
function ResumoFaturamento({ id, onClose }: { id: number; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const { data: f, isLoading, isError, error } = useQuery({
    queryKey: ['faturamento', id],
    queryFn: () => api.faturamentoOrcamento(id),
  })

  function textoResumo(): string {
    if (!f) return ''
    const linhas = [
      `RESUMO PARA FATURAMENTO — ${f.numero}`,
      ``,
      `Emitir pela: ${f.emitente.nome}`,
      `CNPJ: ${f.emitente.cnpj}  (${f.emitente.regime})`,
      `Cliente: ${f.cliente || '—'}`,
      `CNPJ do cliente: ${f.cliente_cnpj || '—'}`,
      `Pagamento: ${f.condicao}`,
      ``,
      `ITENS:`,
      ...f.itens.map((i, n) => `  ${n + 1}. ${i.descricao} — ${i.quantidade.toLocaleString('pt-BR')} un x ${fmtBRL(i.preco_unitario)} = ${fmtBRL(i.total)}`),
      ``,
      `TOTAL DA NOTA: ${fmtBRL(f.total)}`,
      `Imposto estimado (${fmtPct(f.aliquota)}): ${fmtBRL(f.imposto_total)}`,
    ]
    return linhas.join('\n')
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoResumo())
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard indisponível */
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, black 50%, transparent)' }}
      onClick={onClose}
    >
      <div className="card max-h-[88vh] w-full max-w-lg overflow-y-auto px-6 py-5" onClick={(e) => e.stopPropagation()}>
        {isLoading && <Skeleton altura={200} />}
        {isError && <p className="text-sm" style={{ color: 'var(--neg)' }}>{(error as Error).message}</p>}
        {f && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold">Resumo para faturamento</h2>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {f.numero} — use estes dados para montar a nota no Omie
                </p>
              </div>
              <BadgeStatus status={f.status} />
            </div>

            {/* emitente: o dado mais importante (por qual CNPJ faturar) */}
            <div
              className="mt-4 rounded-lg px-4 py-3"
              style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
            >
              <div className="titulo-secao">Emitir a nota pela</div>
              <div className="mt-0.5 text-base font-extrabold">{f.emitente.nome}</div>
              <div className="num text-sm" style={{ color: 'var(--text-secondary)' }}>
                CNPJ {f.emitente.cnpj || '—'} · {f.emitente.regime}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="titulo-secao">Cliente</div>
                <div className="font-semibold">{f.cliente || '—'}</div>
                <div className="num text-xs" style={{ color: 'var(--text-secondary)' }}>
                  CNPJ {f.cliente_cnpj || '— (preencher)'}
                </div>
              </div>
              <div>
                <div className="titulo-secao">Pagamento</div>
                <div className="font-semibold">{f.condicao}</div>
              </div>
            </div>

            <div className="mt-4">
              <div className="titulo-secao mb-1">Itens da nota</div>
              <div className="overflow-x-auto">
                <table className="tabela w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left">Descrição</th>
                      <th className="text-right">Qtde</th>
                      <th className="text-right">Unitário</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.itens.map((i, n) => (
                      <tr key={n}>
                        <td>{i.descricao}</td>
                        <td className="num text-right">{i.quantidade.toLocaleString('pt-BR')}</td>
                        <td className="num text-right">{fmtBRL(i.preco_unitario)}</td>
                        <td className="num text-right font-bold">{fmtBRL(i.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--gridline)' }}>
              <div>
                <div className="titulo-secao">Total da nota</div>
                <div className="text-xl font-extrabold" style={{ color: 'var(--accent)' }}>{fmtBRL(f.total)}</div>
              </div>
              <div className="text-right text-sm" style={{ color: 'var(--text-secondary)' }}>
                Imposto estimado
                <div className="num font-semibold">{fmtBRL(f.imposto_total)} <span style={{ color: 'var(--text-muted)' }}>({fmtPct(f.aliquota)})</span></div>
              </div>
            </div>

            {/* o que ainda falta preencher no Omie (o app não tem esses campos fiscais) */}
            <div className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--surface-2)' }}>
              <div className="titulo-secao mb-1.5">No Omie, complete os campos fiscais</div>
              <ul className="grid gap-1" style={{ color: 'var(--text-secondary)' }}>
                {CAMPOS_OMIE.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost text-sm" onClick={copiar}>
                {copiado ? 'Copiado ✓' : 'Copiar resumo'}
              </button>
              <button className="btn btn-primary text-sm" onClick={onClose}>
                Fechar
              </button>
            </div>
            <p className="help mt-3">O app não emite nota — só organiza os dados. A emissão continua sendo feita por você no Omie.</p>
          </>
        )}
      </div>
    </div>
  )
}
