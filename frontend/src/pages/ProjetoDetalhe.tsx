import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type LinhaFechamento, type Orcamento } from '../api/client'
import { useFiltros } from '../components/Filtros'
import { BadgeLucro, siglaEmpresa, ValorContado } from '../components/Viz'
import { fmtBRL, fmtData, fmtDataHora, fmtPct } from '../lib/format'

const GRUPO_LABEL: Record<string, string> = {
  producao: 'Produção',
  frete: 'Frete',
  comissao: 'Comissão',
  imposto: 'Imposto',
  outros: 'Outros',
  ignorar: 'Ignorar',
}
const GRUPOS_AJUSTE = ['producao', 'frete', 'comissao', 'imposto', 'outros', 'ignorar'] as const

// Dupla conferência: pendente → conferido (1 ok) → aprovado (2 ok)
const ROTULO_CONFERENCIA = {
  pendente: { texto: 'Pendente de conferência', ajuda: 'Ninguém conferiu este projeto ainda' },
  conferido: { texto: '1 de 2', ajuda: 'Conferido — falta o 2º ok (aprovação), de outra pessoa' },
  aprovado: { texto: '✓✓ Conferido e aprovado', ajuda: 'Os dois ok foram dados, por pessoas diferentes' },
} as const

const ESTILO_CONFERENCIA: Record<string, CSSProperties> = {
  pendente: { background: 'var(--surface-2)', color: 'var(--text-muted)' },
  conferido: {
    background: 'color-mix(in srgb, var(--status-warning) 18%, transparent)',
    color: 'var(--text-primary)',
  },
  aprovado: {
    background: 'color-mix(in srgb, var(--status-good) 15%, transparent)',
    color: 'var(--status-good-text)',
  },
}

/** Um dos dois ok: quem assinou, quando, e o desfazer da administradora. */
function SlotOk({
  titulo,
  quem,
  quando,
  vazio,
  onDesfazer,
}: {
  titulo: string
  quem: string
  quando: string | null
  vazio: string
  onDesfazer?: () => void
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {titulo}
      </p>
      {quem ? (
        <>
          <p className="mt-1 font-semibold">✓ {quem}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {fmtDataHora(quando)}
            {onDesfazer && (
              <button
                className="ml-2 underline"
                style={{ color: 'var(--status-critical)' }}
                title="Desfazer este ok (só administradora). A linha fica no histórico."
                onClick={onDesfazer}
              >
                desfazer
              </button>
            )}
          </p>
        </>
      ) : (
        <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
          {vazio}
        </p>
      )}
    </div>
  )
}

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
  const { data: orcamento } = useQuery({
    queryKey: ['orcamento', nome],
    queryFn: () => api.obterOrcamento(nome),
    enabled: !!nome,
  })
  const { data: aprovacoes } = useQuery({
    queryKey: ['aprovacoes', nome],
    queryFn: () => api.listarAprovacoes(nome),
    enabled: !!nome,
  })
  // quem pode dar o 2º ok vem do cadastro, que pode ter mudado desde o login —
  // por isso perguntamos ao servidor em vez de confiar no que está no navegador
  const { data: eu } = useQuery({ queryKey: ['eu'], queryFn: api.eu })

  function invalidarConferencia() {
    queryClient.invalidateQueries({ queryKey: ['aprovacoes', nome] })
    queryClient.invalidateQueries({ queryKey: ['detalhe'] })
    queryClient.invalidateQueries({ queryKey: ['fechamento'] })
  }
  const darOk = useMutation({
    mutationFn: () => api.aprovar({ nome, empresa_ids: empresaIds, de, ate }),
    onSuccess: invalidarConferencia,
  })
  const desfazerOk = useMutation({
    mutationFn: (id: number) => api.desfazerAprovacao(id),
    onSuccess: invalidarConferencia,
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
  // saldo do rodapé: só o que ENTRA no fechamento (cancelado/excluído fica fora)
  const totalReceber = somaValidos(receber, (t) => t.valor_documento, (t) => t.cancelado || t.excluido)
  const totalPagar = somaValidos(pagar, (t) => t.valor_documento, (t) => t.cancelado || t.excluido)
  const nfesValidas = (data?.nfes || []).filter((n) => !n.cancelada && !n.excluida)
  const totalNfe = {
    fora: (data?.nfes || []).length - nfesValidas.length,
    valor: nfesValidas.reduce((s, n) => s + n.v_nf, 0),
    imposto: nfesValidas.reduce((s, n) => s + n.imposto_total, 0),
  }
  const [aba, setAba] = useState<'receber' | 'pagar' | 'nfe' | 'ajustes' | 'comentarios'>('receber')
  const abas = [
    { id: 'receber' as const, rotulo: `Recebimentos (${receber.length})` },
    { id: 'pagar' as const, rotulo: `Pagamentos (${pagar.length})` },
    { id: 'nfe' as const, rotulo: `Notas fiscais (${data?.nfes.length || 0})` },
    { id: 'ajustes' as const, rotulo: `Ajustes (${data?.ajustes.length || 0})` },
    { id: 'comentarios' as const, rotulo: 'Comentários' },
  ]
  // Dupla conferência: o status vem calculado do servidor, junto do fechamento
  const conf = f?.conferencia
  const desfeitos = (aprovacoes || []).filter((a) => a.revogado_em)
  const podeAprovar = eu?.pode_aprovar ?? false
  const ehAdmin = eu?.papel === 'admin'
  const souQuemConferiu = !!conf?.conferido_por && conf.conferido_por === eu?.nome
  const proximoOk =
    conf?.status === 'pendente'
      ? { rotulo: 'Dar o 1º ok (conferi)', bloqueio: '' }
      : conf?.status === 'conferido'
        ? {
            rotulo: 'Dar o 2º ok (aprovar)',
            bloqueio: souQuemConferiu
              ? 'Você deu o 1º ok — o 2º tem de ser de outra pessoa'
              : !podeAprovar
                ? 'Só quem está marcado como aprovador no cadastro dá o 2º ok'
                : '',
          }
        : null

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
        {f && conf && (
          <span className="ml-auto flex items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-bold"
              title={ROTULO_CONFERENCIA[conf.status].ajuda}
              style={ESTILO_CONFERENCIA[conf.status]}
            >
              {conf.status === 'conferido'
                ? `✓ 1 de 2 · ${conf.conferido_por}`
                : ROTULO_CONFERENCIA[conf.status].texto}
            </span>
            {conf.divergente && (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                title={`Conferido com resultado de ${fmtBRL(conf.resultado_conferido ?? 0)}; agora está ${fmtBRL(f.resultado)}. Os ok continuam registrados — confira de novo se fizer sentido.`}
                style={{
                  background: 'color-mix(in srgb, var(--status-warning) 22%, transparent)',
                  color: 'var(--text-primary)',
                }}
              >
                ⚠ Mudou depois do ok
              </span>
            )}
            {proximoOk && (
              <button
                className={proximoOk.bloqueio ? 'btn btn-ghost' : 'btn btn-primary'}
                disabled={darOk.isPending || !!proximoOk.bloqueio}
                title={proximoOk.bloqueio || 'Congela os números de agora e assina o ok com o seu usuário'}
                onClick={() => darOk.mutate()}
              >
                {darOk.isPending ? 'Registrando…' : proximoOk.rotulo}
              </button>
            )}
          </span>
        )}
      </div>

      {f && conf && (
        <div className="card mb-5 p-4">
          <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
            <SlotOk
              titulo="1º ok · conferência"
              quem={conf.conferido_por}
              quando={conf.conferido_em}
              vazio="Ninguém conferiu ainda"
              // desfazer a conferência com a aprovação de pé deixaria o 2º ok órfão
              onDesfazer={ehAdmin && conf.status === 'conferido' && conf.conferido_id ? () => desfazerOk.mutate(conf.conferido_id!) : undefined}
            />
            <SlotOk
              titulo="2º ok · aprovação"
              quem={conf.aprovado_por}
              quando={conf.aprovado_em}
              vazio={conf.status === 'pendente' ? 'Aguardando o 1º ok' : 'Falta aprovar'}
              onDesfazer={ehAdmin && conf.aprovado_id ? () => desfazerOk.mutate(conf.aprovado_id!) : undefined}
            />
            <p className="max-w-md text-xs" style={{ color: 'var(--text-muted)' }}>
              O projeto só está fechado com os dois ok, e eles têm de ser de pessoas diferentes. O 2º ok é de quem
              estiver marcado como aprovador em Empresas&nbsp;→&nbsp;Equipe.
            </p>
          </div>
          {(darOk.error || desfazerOk.error) && (
            <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--status-critical)' }}>
              {(darOk.error || desfazerOk.error)?.message}
            </p>
          )}
          {desfeitos.length > 0 && (
            <details className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <summary className="cursor-pointer">Ok desfeitos ({desfeitos.length})</summary>
              <ul className="mt-2 space-y-1">
                {desfeitos.map((a) => (
                  <li key={a.id}>
                    {a.rotulo} de <b>{a.usuario}</b> em {fmtDataHora(a.criado_em)} — desfeito por{' '}
                    <b>{a.revogado_por}</b> em {fmtDataHora(a.revogado_em)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

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
        <div className="card overflow-hidden">
          <div className="hero-metricas">
            <div className="hero-protagonista">
              <div className="titulo-secao">Resultado do projeto</div>
              <div className="hero-valor mt-2" style={{ color: f.resultado >= 0 ? 'var(--text-primary)' : 'var(--neg)' }}>
                <ValorContado valor={f.resultado} formato={fmtBRL} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
                <span
                  className="pill"
                  style={{ '--pill': f.margem >= 0 ? 'var(--status-good)' : 'var(--neg)' } as React.CSSProperties}
                >
                  margem {fmtPct(f.margem)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {f.qtd_receber} títulos recebíveis · {f.qtd_nfe} NF-e
                </span>
              </div>
            </div>
            <div className="hero-sub">
              <div className="titulo-secao">Receita</div>
              <div className="valor mt-2">
                <ValorContado valor={f.receita} formato={fmtBRL} />
              </div>
            </div>
            <div className="hero-sub">
              <div className="titulo-secao">Custo total</div>
              <div className="valor mt-2">
                <ValorContado valor={f.custo_total} formato={fmtBRL} />
              </div>
            </div>
            <div
              className="hero-sub"
              title={
                [
                  f.imposto_nfe > 0 && `NF-e ${fmtBRL(f.imposto_nfe)}`,
                  f.imposto_simples > 0 && `Simples ${fmtBRL(f.imposto_simples)}`,
                  f.imposto_extra > 0 && `Extra ${fmtBRL(f.imposto_extra)}`,
                ]
                  .filter(Boolean)
                  .join(' + ') || `${f.qtd_nfe} NF-e`
              }
            >
              <div className="titulo-secao">Impostos</div>
              <div className="valor mt-2">
                <ValorContado valor={f.imposto} formato={fmtBRL} />
              </div>
            </div>
          </div>

          <div
            className="grid grid-cols-2 gap-x-6 gap-y-3 border-t px-5 py-3.5 sm:grid-cols-5"
            style={{ borderColor: 'var(--gridline)' }}
          >
            {(
              [
                ['Produção', f.producao, 'var(--serie-producao)'],
                ['Frete', f.frete, 'var(--serie-frete)'],
                ['Comissão', f.comissao, 'var(--serie-comissao)'],
                ['Impostos', f.imposto, 'var(--serie-imposto)'],
                ['Outros', f.outros, 'var(--serie-outros)'],
              ] as [string, number, string][]
            ).map(([rotulo, valor, cor]) => (
              <div key={rotulo} className="kpi min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: cor }} />
                  <span className="titulo-secao">{rotulo}</span>
                </div>
                <div className="kpi-valor mt-1" style={{ fontSize: 'clamp(12px, 9cqw, 19px)' }}>
                  <ValorContado valor={valor} formato={fmtBRL} />
                </div>
              </div>
            ))}
          </div>

          <p className="border-t px-5 py-3 text-sm" style={{ borderColor: 'var(--gridline)', color: 'var(--text-secondary)' }}>
            <b>Cálculo:</b> {fmtBRL(f.receita)} (receita) − {fmtBRL(f.producao)} (produção) − {fmtBRL(f.frete)} (frete) −{' '}
            {fmtBRL(f.comissao)} (comissão) − {fmtBRL(f.imposto)} (impostos) − {fmtBRL(f.outros)} (outros) ={' '}
            <b>{fmtBRL(f.resultado)}</b>
            {f.cp_impostos > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                · Tributos em contas a pagar ({fmtBRL(f.cp_impostos)}) não somam no custo — já contados via NF-e.
              </span>
            )}
          </p>
        </div>
      )}

      {f && orcamento && <OrcadoRealizado nome={nome} orcamento={orcamento} fechamento={f} />}

      {data && (
        <div className="mt-4 flex gap-1 overflow-x-auto border-b" style={{ borderColor: 'var(--baseline)' }}>
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
          <tfoot>
            <tr>
              <td colSpan={5}>
                Total recebido/a receber
                {totalReceber.fora > 0 && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    ({totalReceber.fora} fora do fechamento)
                  </span>
                )}
              </td>
              <td className="num">{fmtBRL(totalReceber.total)}</td>
              <td></td>
            </tr>
          </tfoot>
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
          <tfoot>
            <tr>
              <td colSpan={5}>
                Total pago/a pagar
                {totalPagar.fora > 0 && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    ({totalPagar.fora} fora do fechamento)
                  </span>
                )}
              </td>
              <td className="num">{fmtBRL(totalPagar.total)}</td>
              <td></td>
            </tr>
          </tfoot>
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
          <tfoot>
            <tr>
              <td colSpan={4}>
                Total das notas
                {totalNfe.fora > 0 && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    ({totalNfe.fora} fora do fechamento)
                  </span>
                )}
              </td>
              <td className="num">{fmtBRL(totalNfe.valor)}</td>
              <td colSpan={5}></td>
              <td className="num">{fmtBRL(totalNfe.imposto)}</td>
              <td></td>
            </tr>
          </tfoot>
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

      {aba === 'comentarios' && data && <Comentarios nome={nome} />}

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
            <p className="help mb-3">O ajuste fica registrado no histórico com o seu usuário.</p>
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
                disabled={criarAjuste.isPending || (modal.campo !== 'excluir' && !valorNovo) || !motivo}
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

/** Soma o que entra no fechamento e conta quantos ficaram de fora (rodapé das tabelas). */
function somaValidos<T>(itens: T[], valor: (i: T) => number, fora: (i: T) => boolean) {
  let total = 0
  let descartados = 0
  for (const item of itens) {
    if (fora(item)) descartados++
    else total += valor(item)
  }
  return { total, fora: descartados }
}

/** Projetado × realizado: a proposta prometia TANTO de lucro — deu quanto? */
function OrcadoRealizado({ nome, orcamento, fechamento }: { nome: string; orcamento: Orcamento; fechamento: LinhaFechamento }) {
  const queryClient = useQueryClient()
  const [projetado, setProjetado] = useState(orcamento.resultado_previsto?.toString() ?? '')
  const [editando, setEditando] = useState(orcamento.resultado_previsto === null)

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarOrcamento({ nome, resultado_previsto: projetado === '' ? null : Number(projetado) }),
    onSuccess: () => {
      setEditando(false)
      queryClient.invalidateQueries({ queryKey: ['orcamento', nome] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
    },
  })

  const previsto = orcamento.resultado_previsto
  const desvio = previsto === null ? null : fechamento.resultado - previsto

  return (
    <div className="card mt-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Resultado projetado × realizado</h3>
        {!editando && (
          <button className="btn btn-ghost text-xs" onClick={() => setEditando(true)}>
            {previsto === null ? 'Informar projetado' : 'Editar projetado'}
          </button>
        )}
      </div>
      {editando ? (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Resultado projetado (R$)
            <input
              type="number"
              className="input mt-1 block w-48"
              placeholder="ex.: 54129,11"
              value={projetado}
              onChange={(e) => setProjetado(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          <p className="help w-full">
            O lucro que a proposta prometia para este projeto. O app compara sozinho com o realizado e avisa quando
            render menos.
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-7 gap-y-2 text-sm">
          <span>
            <span className="titulo-secao mr-1.5">Projetado</span>
            <b>{previsto !== null ? fmtBRL(previsto) : '—'}</b>
          </span>
          <span>
            <span className="titulo-secao mr-1.5">Realizado</span>
            <b style={{ color: fechamento.resultado >= 0 ? undefined : 'var(--neg)' }}>{fmtBRL(fechamento.resultado)}</b>
          </span>
          {desvio !== null && (
            <span
              className="pill"
              style={{ '--pill': desvio >= 0 ? 'var(--status-good)' : 'var(--neg)' } as React.CSSProperties}
            >
              {desvio >= 0 ? '+' : '−'}
              {fmtBRL(Math.abs(desvio))} {desvio >= 0 ? 'acima do projetado' : 'abaixo do projetado'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Comentarios({ nome }: { nome: string }) {
  const queryClient = useQueryClient()
  const [texto, setTexto] = useState('')
  const { data: comentarios } = useQuery({
    queryKey: ['comentarios', nome],
    queryFn: () => api.listarComentarios(nome),
  })
  const enviar = useMutation({
    mutationFn: () => api.comentar(nome, texto),
    onSuccess: () => {
      setTexto('')
      queryClient.invalidateQueries({ queryKey: ['comentarios', nome] })
    },
  })
  return (
    <div className="card mt-4 px-5 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-sm" style={{ minWidth: 260 }}>
          Novo comentário
          <input
            className="input mt-1 w-full"
            placeholder="ex.: cliente aprovou reposição sem custo — margem cai de propósito"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && texto.trim() && enviar.mutate()}
          />
        </label>
        <button className="btn btn-primary" disabled={!texto.trim() || enviar.isPending} onClick={() => enviar.mutate()}>
          Comentar
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {(comentarios || []).map((c) => (
          <div key={c.id} className="rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
            <p className="text-sm">{c.texto}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {c.usuario} · {fmtDataHora(c.criado_em)}
            </p>
          </div>
        ))}
        {comentarios && comentarios.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Nenhum comentário ainda — a história do projeto começa aqui.
          </p>
        )}
      </div>
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
