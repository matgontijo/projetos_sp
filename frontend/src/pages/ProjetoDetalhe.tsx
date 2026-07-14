import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, usuarioAtual } from '../api/client'
import { useFiltros } from '../components/Filtros'
import { BadgeLucro, KPICard, siglaEmpresa } from '../components/Viz'
import { fmtBRL, fmtData, fmtDataHora, fmtPct } from '../lib/format'

const GRUPO_LABEL: Record<string, string> = {
  producao: 'Produção',
  frete: 'Frete',
  imposto: 'Imposto',
  outros: 'Outros',
  ignorar: 'Ignorar',
}
const GRUPOS_AJUSTE = ['producao', 'frete', 'imposto', 'outros', 'ignorar'] as const

interface ModalAjuste {
  empresa_id: number
  alvo_tipo: 'titulo' | 'nfe'
  alvo_id: number
  campo: 'grupo' | 'codigo_projeto' | 'excluir' | 'valor_imposto'
  descricao: string
  valorAtual: string
  restaurar?: boolean // excluir='N' (reverte uma exclusão)
}

export default function ProjetoDetalhe() {
  const [searchParams] = useSearchParams()
  const nome = searchParams.get('nome') || ''
  const { empresaIds, de, ate, params } = useFiltros()
  const queryClient = useQueryClient()
  const [modal, setModal] = useState<ModalAjuste | null>(null)
  const [valorNovo, setValorNovo] = useState('')
  const [motivo, setMotivo] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['detalhe', nome, empresaIds, de, ate],
    queryFn: () => api.detalheProjeto(nome, empresaIds, de, ate),
    enabled: !!nome,
  })

  const criarAjuste = useMutation({
    mutationFn: () =>
      api.criarAjuste({
        empresa_id: modal!.empresa_id,
        alvo_tipo: modal!.alvo_tipo,
        alvo_id: modal!.alvo_id,
        campo: modal!.campo,
        valor_novo: modal!.campo === 'excluir' ? (modal!.restaurar ? 'N' : 'S') : valorNovo,
        motivo,
      }),
    onSuccess: () => {
      setModal(null)
      setValorNovo('')
      setMotivo('')
      queryClient.invalidateQueries({ queryKey: ['detalhe'] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  function abrirModal(m: ModalAjuste) {
    setValorNovo(m.campo === 'grupo' || m.campo === 'codigo_projeto' ? '' : m.valorAtual)
    setMotivo('')
    setModal(m)
  }

  const filtrosProjetos = new URLSearchParams(params)
  filtrosProjetos.delete('nome')

  const f = data?.fechamento
  const receber = (data?.titulos || []).filter((t) => t.tipo === 'receber')
  const pagar = (data?.titulos || []).filter((t) => t.tipo === 'pagar')
  const [aba, setAba] = useState<'receber' | 'pagar' | 'nfe' | 'ajustes'>('receber')
  const abas = [
    { id: 'receber' as const, rotulo: `Recebimentos (${receber.length})` },
    { id: 'pagar' as const, rotulo: `Pagamentos (${pagar.length})` },
    { id: 'nfe' as const, rotulo: `Notas fiscais (${data?.nfes.length || 0})` },
    { id: 'ajustes' as const, rotulo: `Ajustes (${data?.ajustes.length || 0})` },
  ]

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to={`/projetos?${filtrosProjetos.toString()}`} className="btn btn-ghost">
          ← Projetos
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight">{f?.projeto || nome}</h1>
        {f && <BadgeLucro resultado={f.resultado} />}
        {f && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }} title={f.empresas}>
            {f.cliente && `${f.cliente} · `}
            {f.empresas.split(',').map((n) => siglaEmpresa(n.trim())).join(' + ')}
          </span>
        )}
      </div>

      {!nome && (
        <p style={{ color: 'var(--text-muted)' }}>
          Nenhum projeto informado na URL. Volte para <Link to="/projetos" className="underline">a lista de projetos</Link>.
        </p>
      )}
      {isLoading && <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>}
      {error && (
        <p className="text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar o detalhe: {(error as Error).message}
        </p>
      )}
      {!isLoading && data && !f && (
        <p style={{ color: 'var(--text-muted)' }}>Projeto sem lançamentos no período/empresas filtrados.</p>
      )}

      {f && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <KPICard titulo="Receita" valor={fmtBRL(f.receita)} sub={`${f.qtd_receber} títulos`} />
            <KPICard titulo="Produção" valor={fmtBRL(f.producao)} />
            <KPICard titulo="Frete" valor={fmtBRL(f.frete)} />
            <KPICard
              titulo="Impostos"
              valor={fmtBRL(f.imposto)}
              sub={
                [
                  f.imposto_nfe > 0 && `NF-e ${fmtBRL(f.imposto_nfe)}`,
                  f.imposto_simples > 0 && `Simples ${fmtBRL(f.imposto_simples)}`,
                  f.imposto_extra > 0 && `Extra ${fmtBRL(f.imposto_extra)}`,
                ]
                  .filter(Boolean)
                  .join(' + ') || `${f.qtd_nfe} NF-e`
              }
            />
            <KPICard titulo="Resultado" valor={fmtBRL(f.resultado)} tom={f.resultado >= 0 ? 'pos' : 'neg'} />
            <KPICard titulo="Margem" valor={fmtPct(f.margem)} tom={f.margem >= 0 ? 'pos' : 'neg'} />
          </div>

          <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <b>Cálculo:</b> {fmtBRL(f.receita)} (receita) − {fmtBRL(f.producao)} (produção) − {fmtBRL(f.frete)} (frete) −{' '}
            {fmtBRL(f.imposto)} (impostos) − {fmtBRL(f.outros)} (outros) = <b>{fmtBRL(f.resultado)}</b>
            {f.cp_impostos > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                · Tributos em contas a pagar ({fmtBRL(f.cp_impostos)}) não somam no custo — já contados via NF-e.
              </span>
            )}
          </p>
        </>
      )}

      {data && (
        <div className="mt-4 flex gap-1 border-b" style={{ borderColor: 'var(--baseline)' }}>
          {abas.map((a) => (
            <button key={a.id} className={`tab ${aba === a.id ? 'tab-ativa' : ''}`} onClick={() => setAba(a.id)}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}

      {aba === 'receber' && data && (
      <Secao titulo={`Contas a Receber (${receber.length})`}>
        <table className="data">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Emissão</th>
              <th>Vencimento</th>
              <th>Doc / NF</th>
              <th>Status</th>
              <th className="num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {receber.map((t) => (
              <tr key={t.id} style={t.cancelado || t.excluido ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} title={t.empresa_nome}>
                  {siglaEmpresa(t.empresa_nome)}
                </td>
                <td>{fmtData(t.data_emissao)}</td>
                <td>{fmtData(t.data_vencimento)}</td>
                <td>{t.numero_documento_fiscal || t.numero_documento || '—'}</td>
                <td className="text-xs">{t.status_titulo}{t.excluido && ' (excluído por ajuste)'}</td>
                <td className="num">{fmtBRL(t.valor_documento)}</td>
                <td className="text-right">
                  <BotoesAjuste
                    excluido={t.excluido}
                    onMover={() =>
                      abrirModal({
                        empresa_id: t.empresa_id, alvo_tipo: 'titulo', alvo_id: t.id, campo: 'codigo_projeto',
                        descricao: `Mover título ${t.numero_documento || t.id} para outro projeto (código Omie da ${t.empresa_nome})`,
                        valorAtual: '',
                      })
                    }
                    onExcluir={() =>
                      abrirModal({
                        empresa_id: t.empresa_id, alvo_tipo: 'titulo', alvo_id: t.id, campo: 'excluir',
                        descricao: t.excluido
                          ? `Restaurar título ${t.numero_documento || t.id} no fechamento`
                          : `Excluir título ${t.numero_documento || t.id} do fechamento`,
                        valorAtual: t.excluido ? 'S' : 'N',
                        restaurar: t.excluido,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
      )}

      {aba === 'pagar' && data && (
      <Secao titulo={`Contas a Pagar (${pagar.length})`}>
        <table className="data">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Emissão</th>
              <th>Categoria</th>
              <th>Grupo</th>
              <th>Status</th>
              <th className="num">Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pagar.map((t) => (
              <tr key={t.id} style={t.cancelado || t.excluido ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} title={t.empresa_nome}>
                  {siglaEmpresa(t.empresa_nome)}
                </td>
                <td>{fmtData(t.data_emissao)}</td>
                <td className="text-xs">{t.codigo_categoria || '—'}</td>
                <td>
                  {t.parcelas.length > 1 ? (
                    <span className="text-xs" title="Título rateado entre categorias — parcelas conforme o fechamento">
                      {t.parcelas
                        .map((p) => `${p.grupo ? GRUPO_LABEL[p.grupo] || p.grupo : 'não classif.'} ${fmtBRL(p.valor)}`)
                        .join(' · ')}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold">
                      {t.grupo ? GRUPO_LABEL[t.grupo] || t.grupo : '— não classificado —'}
                      {t.grupo_ajustado && ' ✎'}
                    </span>
                  )}
                </td>
                <td className="text-xs">{t.status_titulo}{t.excluido && ' (excluído por ajuste)'}</td>
                <td className="num">{fmtBRL(t.valor_documento)}</td>
                <td className="text-right">
                  <BotoesAjuste
                    excluido={t.excluido}
                    onReclassificar={() =>
                      abrirModal({
                        empresa_id: t.empresa_id, alvo_tipo: 'titulo', alvo_id: t.id, campo: 'grupo',
                        descricao: `Reclassificar custo (categoria ${t.codigo_categoria || '—'})${t.parcelas.length > 1 ? ' — ATENÇÃO: o título é rateado; o novo grupo vale para o valor inteiro' : ''}`,
                        valorAtual: t.grupo || '',
                      })
                    }
                    onMover={() =>
                      abrirModal({
                        empresa_id: t.empresa_id, alvo_tipo: 'titulo', alvo_id: t.id, campo: 'codigo_projeto',
                        descricao: `Mover título ${t.id} para outro projeto (código Omie da ${t.empresa_nome})`, valorAtual: '',
                      })
                    }
                    onExcluir={() =>
                      abrirModal({
                        empresa_id: t.empresa_id, alvo_tipo: 'titulo', alvo_id: t.id, campo: 'excluir',
                        descricao: t.excluido
                          ? `Restaurar título ${t.id} no fechamento`
                          : `Excluir título ${t.id} do fechamento`,
                        valorAtual: t.excluido ? 'S' : 'N',
                        restaurar: t.excluido,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
      )}

      {aba === 'nfe' && data && (
      <Secao titulo={`NF-e emitidas (${data?.nfes.length || 0})`}>
        <table className="data">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>NF</th>
              <th>Emissão</th>
              <th>Destinatário</th>
              <th className="num">Valor NF</th>
              <th className="num">ICMS</th>
              <th className="num">ST</th>
              <th className="num">IPI</th>
              <th className="num">PIS</th>
              <th className="num">COFINS</th>
              <th className="num">Impostos</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data?.nfes || []).map((n) => (
              <tr key={n.id} style={n.cancelada || n.excluida ? { opacity: 0.45, textDecoration: 'line-through' } : undefined}>
                <td className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }} title={n.empresa_nome}>
                  {siglaEmpresa(n.empresa_nome)}
                </td>
                <td className="font-semibold">
                  {n.n_nf}
                  {n.serie && `/${n.serie}`}
                </td>
                <td>{fmtData(n.d_emi)}</td>
                <td className="max-w-48 truncate">{n.dest_nome}</td>
                <td className="num">{fmtBRL(n.v_nf)}</td>
                <td className="num">{fmtBRL(n.v_icms)}</td>
                <td className="num">{fmtBRL(n.v_st)}</td>
                <td className="num">{fmtBRL(n.v_ipi)}</td>
                <td className="num">{fmtBRL(n.v_pis)}</td>
                <td className="num">{fmtBRL(n.v_cofins)}</td>
                <td className="num font-semibold">
                  {fmtBRL(n.imposto_total)}
                  {n.imposto_ajustado && ' ✎'}
                </td>
                <td className="text-right">
                  <BotoesAjuste
                    excluido={n.excluida}
                    rotuloReclassificar="Corrigir imposto"
                    onReclassificar={() =>
                      abrirModal({
                        empresa_id: n.empresa_id, alvo_tipo: 'nfe', alvo_id: n.id, campo: 'valor_imposto',
                        descricao: `Corrigir imposto da NF ${n.n_nf}`, valorAtual: n.imposto_total.toFixed(2),
                      })
                    }
                    onMover={() =>
                      abrirModal({
                        empresa_id: n.empresa_id, alvo_tipo: 'nfe', alvo_id: n.id, campo: 'codigo_projeto',
                        descricao: `Mover NF ${n.n_nf} para outro projeto (código Omie da ${n.empresa_nome})`, valorAtual: '',
                      })
                    }
                    onExcluir={() =>
                      abrirModal({
                        empresa_id: n.empresa_id, alvo_tipo: 'nfe', alvo_id: n.id, campo: 'excluir',
                        descricao: n.excluida
                          ? `Restaurar NF ${n.n_nf} no fechamento`
                          : `Excluir NF ${n.n_nf} do fechamento`,
                        valorAtual: n.excluida ? 'S' : 'N',
                        restaurar: n.excluida,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
      )}

      {aba === 'ajustes' && data && (
      <Secao titulo={`Histórico de ajustes (${data?.ajustes.length || 0})`}>
        <table className="data">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Alvo</th>
              <th>Campo</th>
              <th>De → Para</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {(data?.ajustes || []).map((a) => (
              <tr key={a.id}>
                <td>{fmtDataHora(a.criado_em)}</td>
                <td>{a.usuario}</td>
                <td className="text-xs">
                  {a.alvo_tipo} #{a.alvo_id}
                </td>
                <td className="text-xs">{a.campo}</td>
                <td className="text-xs">
                  {a.valor_anterior || '—'} → <b>{a.valor_novo}</b>
                </td>
                <td className="text-xs">{a.motivo || '—'}</td>
              </tr>
            ))}
            {data && data.ajustes.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  Nenhum ajuste manual neste projeto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Secao>
      )}

      {modal && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setModal(null)}
        >
          <div className="card w-full max-w-md px-6 py-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold">Ajuste manual</h3>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {modal.descricao}
            </p>
            {!usuarioAtual() && (
              <p className="mb-3 text-sm" style={{ color: 'var(--neg)' }}>
                Informe seu nome no campo "Usuário" (topo da página) — o ajuste é auditável.
              </p>
            )}
            {modal.campo === 'grupo' && (
              <label className="text-sm">
                Novo grupo
                <select className="input mt-1 w-full" value={valorNovo} onChange={(e) => setValorNovo(e.target.value)}>
                  <option value="">— selecione —</option>
                  {GRUPOS_AJUSTE.map((v) => (
                    <option key={v} value={v}>
                      {GRUPO_LABEL[v]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal.campo === 'codigo_projeto' && (
              <label className="text-sm">
                Código Omie do projeto de destino, na mesma empresa do lançamento (0 = sem projeto)
                <input
                  type="number"
                  className="input mt-1 w-full"
                  value={valorNovo}
                  onChange={(e) => setValorNovo(e.target.value)}
                />
              </label>
            )}
            {modal.campo === 'valor_imposto' && (
              <label className="text-sm">
                Novo valor de imposto (R$)
                <input
                  type="number"
                  step="0.01"
                  className="input mt-1 w-full"
                  value={valorNovo}
                  onChange={(e) => setValorNovo(e.target.value)}
                />
              </label>
            )}
            {modal.campo === 'excluir' && (
              <p className="text-sm">
                {modal.restaurar
                  ? 'O lançamento voltará a contar no fechamento.'
                  : 'O lançamento continuará no cache, mas ficará fora do fechamento (reversível pelo botão "Restaurar").'}
              </p>
            )}
            <label className="mt-3 block text-sm">
              Motivo (auditoria)
              <input
                className="input mt-1 w-full"
                placeholder="ex.: custo lançado no projeto errado"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            {criarAjuste.isError && (
              <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
                {(criarAjuste.error as Error).message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={criarAjuste.isPending || (modal.campo !== 'excluir' && !valorNovo) || !motivo || !usuarioAtual()}
                onClick={() => criarAjuste.mutate()}
              >
                {criarAjuste.isPending ? 'Salvando…' : 'Salvar ajuste'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="card mt-4 overflow-x-auto">
      <h3 className="px-4 pt-3 text-sm font-bold">{titulo}</h3>
      <div className="p-2">{children}</div>
    </div>
  )
}

function BotoesAjuste({
  onReclassificar,
  onMover,
  onExcluir,
  rotuloReclassificar = 'Reclassificar',
  excluido = false,
}: {
  onReclassificar?: () => void
  onMover: () => void
  onExcluir: () => void
  rotuloReclassificar?: string
  excluido?: boolean
}) {
  return (
    <span className="inline-flex gap-1 text-xs whitespace-nowrap">
      {onReclassificar && !excluido && (
        <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={onReclassificar}>
          {rotuloReclassificar}
        </button>
      )}
      {!excluido && (
        <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={onMover}>
          Mover
        </button>
      )}
      <button
        className="btn btn-ghost px-2 py-0.5 text-xs"
        style={{ color: excluido ? 'var(--status-good-text)' : 'var(--neg)' }}
        onClick={onExcluir}
      >
        {excluido ? 'Restaurar' : 'Excluir'}
      </button>
    </span>
  )
}
