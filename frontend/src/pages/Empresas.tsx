import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type TesteConexao } from '../api/client'

const GRUPOS = [
  { valor: '', label: '— não classificada —' },
  { valor: 'producao', label: 'Produção' },
  { valor: 'frete', label: 'Frete' },
  { valor: 'imposto', label: 'Imposto' },
  { valor: 'outros', label: 'Outros' },
  { valor: 'ignorar', label: 'Ignorar (fora do fechamento)' },
]

interface FormEmpresa {
  id?: number
  nome: string
  cnpj: string
  app_key: string
  app_secret: string
  regime: 'nota' | 'simples'
  simples_anexo: string
}

const FORM_VAZIO: FormEmpresa = { nome: '', cnpj: '', app_key: '', app_secret: '', regime: 'nota', simples_anexo: '' }

export default function Empresas() {
  const queryClient = useQueryClient()
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const [form, setForm] = useState<FormEmpresa | null>(null)
  const [testes, setTestes] = useState<Record<number, TesteConexao | 'testando'>>({})
  const [empresaCategorias, setEmpresaCategorias] = useState<number | null>(null)

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['empresas'] })

  const salvar = useMutation({
    mutationFn: async (f: FormEmpresa) => {
      const payload: Record<string, unknown> = {
        nome: f.nome,
        cnpj: f.cnpj,
        regime: f.regime,
        simples_anexo: f.simples_anexo || null,
      }
      if (f.app_key) payload.app_key = f.app_key
      if (f.app_secret) payload.app_secret = f.app_secret
      if (f.id) return api.atualizarEmpresa(f.id, payload)
      return api.criarEmpresa(payload)
    },
    onSuccess: () => {
      invalidar()
      setForm(null)
    },
  })

  const excluir = useMutation({
    mutationFn: (id: number) => api.excluirEmpresa(id),
    onSuccess: invalidar,
  })

  async function testar(id: number) {
    setTestes((t) => ({ ...t, [id]: 'testando' }))
    try {
      const resultado = await api.testarConexao(id)
      setTestes((t) => ({ ...t, [id]: resultado }))
    } catch (e) {
      setTestes((t) => ({ ...t, [id]: { ok: false, total_projetos: null, erro: (e as Error).message } }))
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Empresas (contas Omie)</h2>
        <button className="btn btn-primary" onClick={() => setForm({ ...FORM_VAZIO })}>
          + Nova empresa
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(empresas || []).map((e) => {
          const teste = testes[e.id]
          return (
            <div key={e.id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{e.nome}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {e.cnpj || 'CNPJ não informado'} ·{' '}
                    {e.regime === 'simples' ? `Simples Nacional (Anexo ${e.simples_anexo || 'I'})` : 'Impostos pela NF-e (Presumido/Real)'}
                    {!e.ativa && ' · INATIVA'}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button className="btn btn-ghost" onClick={() => testar(e.id)}>
                    {teste === 'testando' ? 'Testando…' : 'Testar conexão'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      setForm({
                        id: e.id,
                        nome: e.nome,
                        cnpj: e.cnpj,
                        app_key: '',
                        app_secret: '',
                        regime: e.regime,
                        simples_anexo: e.simples_anexo || '',
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--neg)' }}
                    onClick={() => {
                      if (confirm(`Excluir a empresa "${e.nome}" e todo o cache sincronizado dela?`)) excluir.mutate(e.id)
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </div>
              {teste && teste !== 'testando' && (
                <div className="mt-2 text-sm" style={{ color: teste.ok ? 'var(--status-good-text)' : 'var(--neg)' }}>
                  {teste.ok ? `✓ Conectado — ${teste.total_projetos} projetos na Omie` : `✕ ${teste.erro}`}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => setEmpresaCategorias(empresaCategorias === e.id ? null : e.id)}
                >
                  {empresaCategorias === e.id ? 'Fechar categorias' : 'Mapear categorias de custo'}
                </button>
              </div>
              {empresaCategorias === e.id && <Categorias empresaId={e.id} />}
              {e.regime === 'simples' && <SimplesConfig empresaId={e.id} />}
            </div>
          )
        })}
        {empresas && empresas.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            Nenhuma empresa cadastrada. Clique em "+ Nova empresa" e informe o app_key/app_secret gerados no Portal do
            Desenvolvedor da Omie.
          </p>
        )}
      </div>

      {form && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setForm(null)}
        >
          <div className="card w-full max-w-lg px-6 py-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-4 text-base font-bold">{form.id ? `Editar ${form.nome}` : 'Nova empresa'}</h3>
            <div className="grid gap-3">
              <label className="text-sm">
                Nome
                <input
                  className="input mt-1 w-full"
                  value={form.nome}
                  onChange={(ev) => setForm({ ...form, nome: ev.target.value })}
                />
              </label>
              <label className="text-sm">
                CNPJ
                <input
                  className="input mt-1 w-full"
                  value={form.cnpj}
                  onChange={(ev) => setForm({ ...form, cnpj: ev.target.value })}
                />
              </label>
              <label className="text-sm">
                App Key {form.id && <span style={{ color: 'var(--text-muted)' }}>(deixe em branco para manter)</span>}
                <input
                  className="input mt-1 w-full"
                  autoComplete="off"
                  value={form.app_key}
                  onChange={(ev) => setForm({ ...form, app_key: ev.target.value })}
                />
              </label>
              <label className="text-sm">
                App Secret {form.id && <span style={{ color: 'var(--text-muted)' }}>(deixe em branco para manter)</span>}
                <input
                  className="input mt-1 w-full"
                  type="password"
                  autoComplete="off"
                  value={form.app_secret}
                  onChange={(ev) => setForm({ ...form, app_secret: ev.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Regime tributário
                  <select
                    className="input mt-1 w-full"
                    value={form.regime}
                    onChange={(ev) => setForm({ ...form, regime: ev.target.value as 'nota' | 'simples' })}
                  >
                    <option value="nota">Ler impostos da NF-e (Presumido/Real)</option>
                    <option value="simples">Simples Nacional (alíquota efetiva)</option>
                  </select>
                </label>
                {form.regime === 'simples' && (
                  <label className="text-sm">
                    Anexo do Simples
                    <select
                      className="input mt-1 w-full"
                      value={form.simples_anexo}
                      onChange={(ev) => setForm({ ...form, simples_anexo: ev.target.value })}
                    >
                      <option value="">— selecione —</option>
                      {['I', 'II', 'III', 'IV', 'V'].map((a) => (
                        <option key={a} value={a}>
                          Anexo {a}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            {salvar.isError && (
              <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
                {(salvar.error as Error).message}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={salvar.isPending || !form.nome || (!form.id && (!form.app_key || !form.app_secret))}
                onClick={() => salvar.mutate(form)}
              >
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Categorias({ empresaId }: { empresaId: number }) {
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['categorias', empresaId],
    queryFn: () => api.listarCategorias(empresaId),
  })
  const [alteradas, setAlteradas] = useState<Record<string, string | null>>({})

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarCategorias(
        empresaId,
        Object.entries(alteradas).map(([codigo_categoria, grupo]) => ({ codigo_categoria, grupo })),
      ),
    onSuccess: () => {
      setAlteradas({})
      queryClient.invalidateQueries({ queryKey: ['categorias', empresaId] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Categoria Omie → grupo de custo (tributos apurados devem ficar em "Imposto")
        </div>
        <button
          className="btn btn-primary text-xs"
          disabled={!Object.keys(alteradas).length || salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar alterações ({Object.keys(alteradas).length})
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {(categorias || []).map((c) => (
          <div key={c.codigo_categoria} className="flex items-center justify-between gap-2 py-1 text-sm">
            <span className="truncate" title={c.codigo_categoria}>
              {c.descricao || c.codigo_categoria}
            </span>
            <select
              className="input py-1 text-xs"
              value={alteradas[c.codigo_categoria] !== undefined ? (alteradas[c.codigo_categoria] ?? '') : (c.grupo ?? '')}
              onChange={(ev) =>
                setAlteradas((a) => ({ ...a, [c.codigo_categoria]: ev.target.value || null }))
              }
            >
              {GRUPOS.map((g) => (
                <option key={g.valor} value={g.valor}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        {categorias && categorias.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Nenhuma categoria sincronizada ainda — rode uma sincronização primeiro.
          </p>
        )}
      </div>
    </div>
  )
}

function SimplesConfig({ empresaId }: { empresaId: number }) {
  const queryClient = useQueryClient()
  const { data: periodos } = useQuery({
    queryKey: ['simples', empresaId],
    queryFn: () => api.listarSimples(empresaId),
  })
  const [competencia, setCompetencia] = useState('')
  const [rbt12, setRbt12] = useState('')

  const salvar = useMutation({
    mutationFn: () =>
      api.salvarSimples(empresaId, [{ competencia, rbt12: rbt12 ? Number(rbt12) : null }]),
    onSuccess: () => {
      setCompetencia('')
      setRbt12('')
      queryClient.invalidateQueries({ queryKey: ['simples', empresaId] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
      <div className="mb-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        RBT12 por competência (se vazio, é derivado das receitas sincronizadas dos 12 meses anteriores)
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          className="input text-xs"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
        />
        <input
          type="number"
          className="input w-36 text-xs"
          placeholder="RBT12 (R$)"
          value={rbt12}
          onChange={(e) => setRbt12(e.target.value)}
        />
        <button className="btn btn-ghost text-xs" disabled={!competencia || salvar.isPending} onClick={() => salvar.mutate()}>
          Salvar competência
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {(periodos || []).map((p) => (
          <span key={p.competencia} className="rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--gridline)' }}>
            {p.competencia}: {p.rbt12 ? `R$ ${p.rbt12.toLocaleString('pt-BR')}` : 'derivado'}
          </span>
        ))}
      </div>
    </div>
  )
}
