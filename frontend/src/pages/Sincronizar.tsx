import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { fmtData, fmtDataHora } from '../lib/format'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}
// padrao: ano passado inteiro + ano atual — assim o imposto do Simples consegue
// derivar o faturamento dos 12 meses anteriores a cada competencia
function inicioPadrao(): string {
  return `${new Date().getFullYear() - 1}-01-01`
}

const RECURSO_LABEL: Record<string, string> = {
  projetos: 'Projetos',
  categorias: 'Categorias',
  clientes: 'Clientes',
  contas_receber: 'Contas a Receber',
  contas_pagar: 'Contas a Pagar',
  nfe: 'NF-e emitidas',
}

export default function Sincronizar() {
  const queryClient = useQueryClient()
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  const [de, setDe] = useState(inicioPadrao())
  const [ate, setAte] = useState(hoje())

  const { data: logs } = useQuery({
    queryKey: ['sync-logs'],
    queryFn: () => api.listarLogs(),
    refetchInterval: (query) =>
      (query.state.data || []).some((l) => l.status === 'executando') ? 2500 : 15000,
  })

  const sync = useMutation({
    mutationFn: () => {
      const ids = selecionadas.size ? [...selecionadas] : (empresas || []).filter((e) => e.ativa).map((e) => e.id)
      return api.iniciarSync(ids, de, ate)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  function alternar(id: number) {
    const novo = new Set(selecionadas)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    setSelecionadas(novo)
  }

  const empresaNome = (id: number) => empresas?.find((e) => e.id === id)?.nome || `#${id}`

  return (
    <div>
      <div className="card px-5 py-4">
        <h2 className="mb-1 text-sm font-bold">Buscar dados da Omie</h2>
        <p className="help mb-3">
          O app busca notas fiscais, contas a receber e contas a pagar do período e monta o fechamento por projeto.
          Pode rodar quantas vezes quiser — só atualiza o que mudou, sem duplicar nada. Dica: inclua o ano anterior
          no período para o imposto do Simples sair certinho (ele depende do faturamento dos 12 meses anteriores).
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              Empresas (nenhuma marcada = todas ativas)
            </div>
            <div className="flex flex-wrap gap-2">
              {(empresas || []).map((e) => (
                <label
                  key={e.id}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm"
                  style={{ borderColor: selecionadas.has(e.id) ? 'var(--serie-producao)' : 'var(--baseline)' }}
                >
                  <input type="checkbox" checked={selecionadas.has(e.id)} onChange={() => alternar(e.id)} />
                  {e.nome}
                </label>
              ))}
              {empresas && empresas.length === 0 && (
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Cadastre uma empresa primeiro (aba Empresas).
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              Emissão de
            </div>
            <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              até
            </div>
            <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            disabled={sync.isPending || !empresas?.length}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? 'Iniciando…' : 'Buscar dados'}
          </button>
        </div>
        {sync.isSuccess && (
          <p className="mt-2 text-sm" style={{ color: 'var(--status-good-text)' }}>
            Busca iniciada — acompanhe o progresso abaixo. Com muitos lançamentos pode levar alguns minutos.
          </p>
        )}
        {sync.isError && (
          <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
            Erro: {(sync.error as Error).message}
          </p>
        )}
      </div>

      <div className="card mt-4 overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Recurso</th>
              <th>Período</th>
              <th>Status</th>
              <th className="num">Registros</th>
              <th>Início</th>
              <th>Mensagem</th>
            </tr>
          </thead>
          <tbody>
            {(logs || []).map((l) => (
              <tr key={l.id}>
                <td>{empresaNome(l.empresa_id)}</td>
                <td>{RECURSO_LABEL[l.recurso] || l.recurso}</td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {fmtData(l.periodo_de)} – {fmtData(l.periodo_ate)}
                </td>
                <td>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      background:
                        l.status === 'concluido'
                          ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
                          : l.status === 'erro'
                            ? 'color-mix(in srgb, var(--status-critical) 15%, transparent)'
                            : 'color-mix(in srgb, var(--serie-producao) 15%, transparent)',
                      color:
                        l.status === 'concluido'
                          ? 'var(--status-good-text)'
                          : l.status === 'erro'
                            ? 'var(--neg)'
                            : 'var(--serie-producao)',
                    }}
                  >
                    {l.status === 'executando' ? '⟳ executando' : l.status === 'concluido' ? '✓ concluído' : '✕ erro'}
                  </span>
                </td>
                <td className="num">{l.qtd_registros}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{fmtDataHora(l.iniciado_em)}</td>
                <td className="max-w-md truncate text-xs" style={{ color: 'var(--neg)' }} title={l.mensagem}>
                  {l.mensagem}
                </td>
              </tr>
            ))}
            {logs && logs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--text-muted)' }}>
                  Nenhuma sincronização executada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
