import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, usuarioLogado, type TesteConexao, type UsuarioLogado } from '../api/client'
import { PageHeader } from '../components/Layout'
import { fmtBRL } from '../lib/format'

const GRUPOS = [
  { valor: '', label: '— ainda não classificada —' },
  { valor: 'producao', label: 'Produção (custo do produto)' },
  { valor: 'frete', label: 'Frete / logística' },
  { valor: 'comissao', label: 'Comissão (soma no custo)' },
  { valor: 'imposto', label: 'Imposto (não soma no custo)' },
  { valor: 'outros', label: 'Outros custos do projeto' },
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
  aliquota_extra: string
}

const FORM_VAZIO: FormEmpresa = {
  nome: '', cnpj: '', app_key: '', app_secret: '', regime: 'nota', simples_anexo: '', aliquota_extra: '',
}

export default function Empresas() {
  const queryClient = useQueryClient()
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const [form, setForm] = useState<FormEmpresa | null>(null)
  const [testes, setTestes] = useState<Record<number, TesteConexao | 'testando'>>({})
  const [painelAberto, setPainelAberto] = useState<{ empresa: number; painel: 'categorias' | 'simples' } | null>(null)

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['empresas'] })

  const salvar = useMutation({
    mutationFn: async (f: FormEmpresa) => {
      const payload: Record<string, unknown> = {
        nome: f.nome,
        cnpj: f.cnpj,
        regime: f.regime,
        simples_anexo: f.simples_anexo || null,
        aliquota_extra: f.aliquota_extra === '' ? 0 : Number(f.aliquota_extra),
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

  function alternarPainel(empresa: number, painel: 'categorias' | 'simples') {
    setPainelAberto((atual) =>
      atual && atual.empresa === empresa && atual.painel === painel ? null : { empresa, painel },
    )
  }

  return (
    <div>
      <PageHeader
        titulo="Empresas"
        subtitulo="Cada CNPJ tem sua conta Omie — o app junta tudo por número de projeto, mesmo quando quem fatura e quem paga são empresas diferentes"
        acoes={
          <button className="btn btn-primary" onClick={() => setForm({ ...FORM_VAZIO })}>
            + Conectar empresa
          </button>
        }
      />

      <Preferencias />
      {usuarioLogado()?.papel === 'admin' && <Equipe />}

      <div className="grid gap-3 lg:grid-cols-2">
        {(empresas || []).map((e) => {
          const teste = testes[e.id]
          return (
            <div key={e.id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold" title={e.nome}>
                    {e.nome}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {e.cnpj || 'CNPJ não informado'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{
                        background: 'color-mix(in srgb, var(--serie-producao) 12%, transparent)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {e.regime === 'simples' ? `Simples Nacional · Anexo ${e.simples_anexo || 'I'}` : 'Lucro Presumido / Real'}
                    </span>
                    {e.aliquota_extra > 0 && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--serie-imposto) 15%, transparent)', color: 'var(--text-secondary)' }}
                      >
                        +{String(e.aliquota_extra).replace('.', ',')}% de imposto s/ receita
                      </span>
                    )}
                    {!e.ativa && (
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--gridline)' }}>
                        INATIVA
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
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
                        aliquota_extra: e.aliquota_extra ? String(e.aliquota_extra) : '',
                      })
                    }
                  >
                    Editar
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--neg)' }}
                    onClick={() => {
                      if (confirm(`Excluir a empresa "${e.nome}" e todos os dados sincronizados dela?`)) excluir.mutate(e.id)
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

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-ghost text-xs" onClick={() => alternarPainel(e.id, 'categorias')}>
                  {painelAberto?.empresa === e.id && painelAberto.painel === 'categorias'
                    ? 'Fechar classificação'
                    : 'Classificar custos'}
                </button>
                {e.regime === 'simples' && (
                  <button className="btn btn-ghost text-xs" onClick={() => alternarPainel(e.id, 'simples')}>
                    {painelAberto?.empresa === e.id && painelAberto.painel === 'simples'
                      ? 'Fechar imposto do Simples'
                      : 'Imposto do Simples'}
                  </button>
                )}
              </div>
              {painelAberto?.empresa === e.id && painelAberto.painel === 'categorias' && <Categorias empresaId={e.id} />}
              {painelAberto?.empresa === e.id && painelAberto.painel === 'simples' && (
                <SimplesConfig empresaId={e.id} anexo={e.simples_anexo || 'I'} />
              )}
            </div>
          )
        })}
        {empresas && empresas.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            Nenhuma empresa conectada ainda. Clique em "+ Conectar empresa" e cole o app_key/app_secret que ficam no
            Portal do Desenvolvedor da Omie.
          </p>
        )}
      </div>

      {form && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setForm(null)}
        >
          <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto px-6 py-5" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold">{form.id ? `Editar ${form.nome}` : 'Conectar empresa'}</h3>
            <p className="help mb-4">
              As chaves ficam criptografadas no servidor e nunca aparecem de novo. O app só lê dados da Omie — nunca
              altera nada lá.
            </p>
            <div className="grid gap-3">
              <label className="text-sm">
                Nome da empresa
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
                App Key {form.id && <span style={{ color: 'var(--text-muted)' }}>(deixe em branco para manter a atual)</span>}
                <input
                  className="input mt-1 w-full"
                  autoComplete="off"
                  value={form.app_key}
                  onChange={(ev) => setForm({ ...form, app_key: ev.target.value })}
                />
              </label>
              <label className="text-sm">
                App Secret {form.id && <span style={{ color: 'var(--text-muted)' }}>(deixe em branco para manter a atual)</span>}
                <input
                  className="input mt-1 w-full"
                  type="password"
                  autoComplete="off"
                  value={form.app_secret}
                  onChange={(ev) => setForm({ ...form, app_secret: ev.target.value })}
                />
              </label>
              {form.id && (form.app_key || form.app_secret) && (
                <p className="help" style={{ color: 'var(--serie-imposto)' }}>
                  Ao trocar as chaves, os dados sincronizados desta empresa são apagados (pertencem à conta antiga) —
                  rode uma nova busca depois.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  Como calcular os impostos?
                  <select
                    className="input mt-1 w-full"
                    value={form.regime}
                    onChange={(ev) => setForm({ ...form, regime: ev.target.value as 'nota' | 'simples' })}
                  >
                    <option value="nota">Pelas notas fiscais (Presumido/Real)</option>
                    <option value="simples">Simples Nacional (automático)</option>
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
                      <option value="">— pergunte ao contador —</option>
                      <option value="I">Anexo I — comércio/revenda</option>
                      <option value="II">Anexo II — indústria</option>
                      <option value="III">Anexo III — serviços</option>
                      <option value="IV">Anexo IV — serviços (obras etc.)</option>
                      <option value="V">Anexo V — serviços técnicos</option>
                    </select>
                  </label>
                )}
              </div>
              <label className="text-sm">
                Imposto extra sobre a receita (%)
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className="input mt-1 w-full"
                  placeholder="0"
                  value={form.aliquota_extra}
                  onChange={(ev) => setForm({ ...form, aliquota_extra: ev.target.value })}
                />
                <span className="help mt-1 block">
                  Para impostos que não aparecem na nota fiscal, como IRPJ/CSLL do Lucro Presumido (na planilha de
                  vocês isso é ~3,4% da venda). Deixe 0 se não souber — dá para ajustar depois.
                </span>
              </label>
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

function Preferencias() {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: api.lerConfig })
  const [margem, setMargem] = useState<string | null>(null)

  const salvar = useMutation({
    mutationFn: (dados: Partial<{ margem_alvo: number; sync_auto: boolean; sync_hora: number }>) =>
      api.salvarConfig(dados),
    onSuccess: () => {
      setMargem(null)
      queryClient.invalidateQueries({ queryKey: ['config'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
    },
  })

  if (!config) return null
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-5 px-5 py-4">
      <div>
        <span className="titulo-secao">Meta de margem</span>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="95"
            step="0.5"
            className="input w-24"
            value={margem ?? String(config.margem_alvo)}
            onChange={(e) => setMargem(e.target.value)}
          />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>%</span>
          {margem !== null && Number(margem) !== config.margem_alvo && (
            <button className="btn btn-primary text-xs" disabled={salvar.isPending} onClick={() => salvar.mutate({ margem_alvo: Number(margem) })}>
              Salvar
            </button>
          )}
        </div>
        <p className="help mt-1">Define o semáforo dos projetos e os alertas.</p>
      </div>
      <div>
        <span className="titulo-secao">Busca automática</span>
        <div className="mt-1 flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.sync_auto}
              onChange={(e) => salvar.mutate({ sync_auto: e.target.checked })}
            />
            Buscar dados da Omie todo dia
          </label>
          {config.sync_auto && (
            <>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>a partir das</span>
              <select
                className="input w-20 py-1"
                value={config.sync_hora}
                onChange={(e) => salvar.mutate({ sync_hora: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>
                ))}
              </select>
            </>
          )}
        </div>
        <p className="help mt-1">
          No plano gratuito do Render a busca só roda se o servidor estiver acordado; no plano pago roda sempre.
        </p>
      </div>
    </div>
  )
}

const PAPEIS_OPCOES = [
  { valor: 'admin', label: 'Administradora — tudo, inclusive usuários' },
  { valor: 'financeiro', label: 'Financeiro — opera tudo, menos usuários' },
  { valor: 'comercial', label: 'Comercial — só precificação e orçamentos' },
  { valor: 'leitura', label: 'Leitura — só consulta e simulador' },
]

function Equipe() {
  const queryClient = useQueryClient()
  const eu = usuarioLogado()
  const { data: usuarios } = useQuery({ queryKey: ['usuarios'], queryFn: api.listarUsuarios })
  const [novo, setNovo] = useState<{ nome: string; email: string; senha: string; papel: string } | null>(null)
  const [erro, setErro] = useState('')

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['usuarios'] })

  const criar = useMutation({
    mutationFn: () => api.criarUsuario(novo!),
    onSuccess: () => {
      setNovo(null)
      setErro('')
      invalidar()
    },
    onError: (e) => setErro((e as Error).message),
  })
  const atualizar = useMutation({
    mutationFn: ({ id, dados }: { id: number; dados: Partial<{ papel: string; ativo: boolean; senha: string }> }) =>
      api.atualizarUsuario(id, dados),
    onSuccess: () => {
      setErro('')
      invalidar()
    },
    onError: (e) => setErro((e as Error).message),
  })

  function redefinirSenha(u: UsuarioLogado) {
    const senha = prompt(`Nova senha para ${u.nome} (mínimo 8 caracteres):`)
    if (senha && senha.length >= 8) atualizar.mutate({ id: u.id, dados: { senha } })
    else if (senha) setErro('A senha precisa de pelo menos 8 caracteres')
  }

  return (
    <div className="card mb-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="titulo-secao">Equipe</span>
          <p className="help mt-0.5">Quem entra no app e o que pode fazer. Só administradoras veem esta área.</p>
        </div>
        <button className="btn btn-primary text-xs" onClick={() => setNovo({ nome: '', email: '', senha: '', papel: 'financeiro' })}>
          + Adicionar pessoa
        </button>
      </div>
      {erro && (
        <p className="mt-2 text-sm" style={{ color: 'var(--neg)' }}>
          {erro}
        </p>
      )}
      {novo && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
          <label className="text-xs">
            Nome
            <input className="input mt-1 block w-36" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </label>
          <label className="text-xs">
            E-mail
            <input type="email" className="input mt-1 block w-52" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
          </label>
          <label className="text-xs">
            Senha (mín. 8)
            <input type="password" className="input mt-1 block w-36" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
          </label>
          <label className="text-xs">
            Acesso
            <select className="input mt-1 block" value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
              {PAPEIS_OPCOES.map((p) => (
                <option key={p.valor} value={p.valor}>{p.label}</option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary text-xs"
            disabled={!novo.nome.trim() || !novo.email.trim() || novo.senha.length < 8 || criar.isPending}
            onClick={() => criar.mutate()}
          >
            Criar
          </button>
          <button className="btn btn-ghost text-xs" onClick={() => setNovo(null)}>
            Cancelar
          </button>
        </div>
      )}
      <div className="mt-3 grid gap-1.5">
        {(usuarios || []).map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
            <b className="w-40 truncate" title={u.email} style={{ opacity: u.ativo ? 1 : 0.5 }}>
              {u.nome}
              {u.id === eu?.id && ' (você)'}
            </b>
            <select
              className="input py-1 text-xs"
              value={u.papel}
              disabled={u.id === eu?.id}
              onChange={(e) => atualizar.mutate({ id: u.id, dados: { papel: e.target.value } })}
            >
              {PAPEIS_OPCOES.map((p) => (
                <option key={p.valor} value={p.valor}>{p.label.split(' — ')[0]}</option>
              ))}
            </select>
            <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => redefinirSenha(u)}>
              Redefinir senha
            </button>
            {u.id !== eu?.id && (
              <button
                className="btn btn-ghost px-2 py-0.5 text-xs"
                style={{ color: u.ativo ? 'var(--neg)' : 'var(--status-good-text)' }}
                onClick={() => atualizar.mutate({ id: u.id, dados: { ativo: !u.ativo } })}
              >
                {u.ativo ? 'Desativar' : 'Reativar'}
              </button>
            )}
            {!u.ativo && (
              <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>
                DESATIVADA
              </span>
            )}
          </div>
        ))}
      </div>
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
  const [busca, setBusca] = useState('')
  const [soPendentes, setSoPendentes] = useState(true)

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

  const lista = (categorias || []).filter((c) => {
    const grupoAtual = alteradas[c.codigo_categoria] !== undefined ? alteradas[c.codigo_categoria] : c.grupo
    if (soPendentes && grupoAtual) return false
    if (busca && !(c.descricao || c.codigo_categoria).toLowerCase().includes(busca.toLowerCase())) return false
    return true
  })
  const pendentes = (categorias || []).filter((c) =>
    alteradas[c.codigo_categoria] !== undefined ? !alteradas[c.codigo_categoria] : !c.grupo,
  ).length

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
      <p className="help mb-2">
        Diga o que cada categoria de conta a pagar representa no custo do projeto. Tributos já vêm sugeridos como
        "Imposto" (eles aparecem no detalhe mas não somam no custo, para não contar duas vezes).
        {pendentes > 0 && (
          <b> Faltam {pendentes} categorias sem classificação — elas caem em "Outros".</b>
        )}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 text-xs"
          placeholder="buscar categoria…"
          value={busca}
          onChange={(ev) => setBusca(ev.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={soPendentes} onChange={(ev) => setSoPendentes(ev.target.checked)} />
          só pendentes
        </label>
        <button
          className="btn btn-primary text-xs"
          disabled={!Object.keys(alteradas).length || salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar ({Object.keys(alteradas).length})
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {lista.map((c) => (
          <div key={c.codigo_categoria} className="flex items-center justify-between gap-2 py-1 text-sm">
            <span className="truncate" title={c.codigo_categoria}>
              {c.descricao || c.codigo_categoria}
            </span>
            <select
              className="input py-1 text-xs"
              value={alteradas[c.codigo_categoria] !== undefined ? (alteradas[c.codigo_categoria] ?? '') : (c.grupo ?? '')}
              onChange={(ev) => setAlteradas((a) => ({ ...a, [c.codigo_categoria]: ev.target.value || null }))}
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
            Nenhuma categoria ainda — rode uma busca de dados primeiro (aba "Buscar dados").
          </p>
        )}
        {categorias && categorias.length > 0 && lista.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Nada aqui — {soPendentes ? 'todas as categorias já foram classificadas 🎉' : 'nenhuma categoria bate com a busca'}.
          </p>
        )}
      </div>
    </div>
  )
}

function SimplesConfig({ empresaId, anexo }: { empresaId: number; anexo: string }) {
  const queryClient = useQueryClient()
  const { data: periodos } = useQuery({
    queryKey: ['simples', empresaId],
    queryFn: () => api.listarSimples(empresaId),
  })
  const [competencia, setCompetencia] = useState('')
  const [valor, setValor] = useState('')

  const salvar = useMutation({
    mutationFn: (dados: { competencia: string; rbt12: number | null }) => api.salvarSimples(empresaId, [dados]),
    onSuccess: () => {
      setCompetencia('')
      setValor('')
      queryClient.invalidateQueries({ queryKey: ['simples', empresaId] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  const informados = (periodos || []).filter((p) => p.rbt12 !== null)

  return (
    <div className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
      <p className="help">
        <b>O imposto do Simples é calculado sozinho.</b> Para cada mês, o app soma o que a empresa faturou nos 12
        meses anteriores e aplica a tabela oficial do Simples (Anexo {anexo}). Você não precisa configurar nada aqui.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Ajuste fino (opcional): informar o faturamento que o contador passou
        </summary>
        <p className="help mt-2">
          Se o contador te passar o <b>faturamento acumulado de 12 meses</b> usado na guia de algum mês, informe aqui
          que ele vale no lugar do cálculo automático (útil quando nem todas as vendas passam pela Omie).
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Mês
            <input
              type="month"
              className="input ml-1 text-xs"
              value={competencia}
              onChange={(ev) => setCompetencia(ev.target.value)}
            />
          </label>
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Faturamento 12 meses (R$)
            <input
              type="number"
              className="input ml-1 w-36 text-xs"
              placeholder="ex.: 3500000"
              value={valor}
              onChange={(ev) => setValor(ev.target.value)}
            />
          </label>
          <button
            className="btn btn-ghost text-xs"
            disabled={!competencia || valor === '' || salvar.isPending}
            onClick={() => salvar.mutate({ competencia, rbt12: Number(valor) })}
          >
            Salvar
          </button>
        </div>
        {informados.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {informados.map((p) => (
              <span
                key={p.competencia}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                style={{ borderColor: 'var(--gridline)', color: 'var(--text-secondary)' }}
              >
                {p.competencia}: {fmtBRL(p.rbt12 || 0)}
                <button
                  title="Voltar para o cálculo automático neste mês"
                  className="cursor-pointer font-bold"
                  style={{ color: 'var(--neg)' }}
                  onClick={() => salvar.mutate({ competencia: p.competencia, rbt12: null })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </details>
    </div>
  )
}
