import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  api,
  baixarArquivo,
  usuarioLogado,
  type Empresa,
  type ImpostoEmpresa,
  type TesteConexao,
  type UsuarioLogado,
} from '../api/client'
import { PageHeader } from '../components/Layout'

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
  impostos: ImpostoEmpresa[]
  fonte_imposto: 'nfe' | 'aliquota'
}

const FORM_VAZIO: FormEmpresa = {
  nome: '', cnpj: '', app_key: '', app_secret: '', regime: 'nota', impostos: [], fonte_imposto: 'nfe',
}

/** A tabela que a contabilidade manda no Lucro Presumido — 19,05% da venda. */
const TABELA_PRESUMIDO: ImpostoEmpresa[] = [
  { nome: 'PIS', aliquota: 0.65 },
  { nome: 'COFINS', aliquota: 3 },
  { nome: 'ICMS', aliquota: 12 },
  { nome: 'CSLL', aliquota: 1.2 },
  { nome: 'IRPJ', aliquota: 1.08 },
  { nome: 'Add. IRPJ', aliquota: 1.12 },
]

/** Só o que NÃO aparece na nota fiscal (o resto vem da NF-e). */
const FORA_DA_NOTA: ImpostoEmpresa[] = [
  { nome: 'CSLL', aliquota: 1.2 },
  { nome: 'IRPJ', aliquota: 1.08 },
  { nome: 'Add. IRPJ', aliquota: 1.12 },
]

const somaImpostos = (itens: ImpostoEmpresa[]) => itens.reduce((s, i) => s + (Number(i.aliquota) || 0), 0)
const pct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`

/** Empresa antiga tinha um % único; vira a primeira linha da tabela. */
function impostosDaEmpresa(e: Empresa): ImpostoEmpresa[] {
  if (e.impostos?.length) return e.impostos
  if (e.aliquota_extra > 0) {
    return [{ nome: e.regime === 'simples' ? 'Simples Nacional' : 'Imposto sobre a receita', aliquota: e.aliquota_extra }]
  }
  return []
}

export default function Empresas() {
  const queryClient = useQueryClient()
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const [form, setForm] = useState<FormEmpresa | null>(null)
  const [testes, setTestes] = useState<Record<number, TesteConexao | 'testando'>>({})
  const [categoriasAbertas, setCategoriasAbertas] = useState<number | null>(null)
  const [perfisAbertos, setPerfisAbertos] = useState<number | null>(null)

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ['empresas'] })

  const salvar = useMutation({
    mutationFn: async (f: FormEmpresa) => {
      const impostos = f.impostos
        .filter((i) => i.nome.trim())
        .map((i) => ({ nome: i.nome.trim(), aliquota: Number(i.aliquota) || 0 }))
      const payload: Record<string, unknown> = {
        nome: f.nome,
        cnpj: f.cnpj,
        regime: f.regime,
        impostos,
        fonte_imposto: f.fonte_imposto,
        // campo antigo segue espelhando o total, para nada ficar inconsistente
        aliquota_extra: somaImpostos(impostos),
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

  function alternarCategorias(empresa: number) {
    setCategoriasAbertas((atual) => (atual === empresa ? null : empresa))
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
      {usuarioLogado()?.papel === 'admin' && <Backup />}

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
                        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {e.regime === 'simples' ? 'Simples Nacional' : 'Lucro Presumido / Real'}
                    </span>
                    {somaImpostos(impostosDaEmpresa(e)) > 0 && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--serie-imposto) 15%, transparent)', color: 'var(--text-secondary)' }}
                        title={impostosDaEmpresa(e)
                          .map((i) => `${i.nome} ${pct(Number(i.aliquota))}`)
                          .join(' · ')}
                      >
                        {e.regime === 'nota' && e.fonte_imposto === 'nfe' ? '+' : ''}
                        {pct(somaImpostos(impostosDaEmpresa(e)))} s/ receita
                        {impostosDaEmpresa(e).length > 1 && ` · ${impostosDaEmpresa(e).length} impostos`}
                      </span>
                    )}
                    {e.regime === 'nota' && e.fonte_imposto === 'aliquota' && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
                        title="A NF-e não entra no cálculo: o imposto sai só desta tabela"
                      >
                        calculado pela tabela
                      </span>
                    )}
                    {e.regime === 'simples' && !(somaImpostos(impostosDaEmpresa(e)) > 0) && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--neg) 12%, transparent)', color: 'var(--neg)' }}
                      >
                        sem alíquota — imposto fica R$ 0
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
                        impostos: impostosDaEmpresa(e),
                        fonte_imposto: e.fonte_imposto || 'nfe',
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
                <button className="btn btn-ghost text-xs" onClick={() => alternarCategorias(e.id)}>
                  {categoriasAbertas === e.id ? 'Fechar classificação' : 'Classificar custos'}
                </button>
                {e.regime !== 'simples' && (
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => setPerfisAbertos(perfisAbertos === e.id ? null : e.id)}
                  >
                    {perfisAbertos === e.id ? 'Fechar tributação' : 'Tributação por operação'}
                  </button>
                )}
              </div>
              {categoriasAbertas === e.id && <Categorias empresaId={e.id} />}
              {perfisAbertos === e.id && <PerfisTributacao empresaId={e.id} />}
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
              <label className="text-sm">
                Como calcular os impostos?
                <select
                  className="input mt-1 w-full"
                  value={form.regime}
                  onChange={(ev) => setForm({ ...form, regime: ev.target.value as 'nota' | 'simples' })}
                >
                  <option value="nota">Pelas notas fiscais (Presumido/Real)</option>
                  <option value="simples">Simples Nacional (alíquota fixa sobre a receita)</option>
                </select>
              </label>
              {form.regime === 'nota' && (
                <label className="text-sm">
                  De onde vem o imposto do projeto?
                  <select
                    className="input mt-1 w-full"
                    value={form.fonte_imposto}
                    onChange={(ev) => setForm({ ...form, fonte_imposto: ev.target.value as 'nfe' | 'aliquota' })}
                  >
                    <option value="nfe">Das notas fiscais + os % abaixo (padrão)</option>
                    <option value="aliquota">Só pelos % abaixo, sobre a receita (igual à planilha)</option>
                  </select>
                  <span className="help mt-1 block">
                    {form.fonte_imposto === 'nfe'
                      ? 'O ICMS, PIS e COFINS saem das notas emitidas; abaixo você cadastra só o que não aparece na nota (IRPJ, CSLL…).'
                      : 'A nota fiscal não entra no cálculo — o imposto do projeto é a soma dos % abaixo sobre a receita.'}
                  </span>
                </label>
              )}

              <div className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{form.regime === 'simples' ? 'Alíquota do Simples sobre a receita' : 'Impostos sobre a receita'}</span>
                  {form.impostos.length > 0 && (
                    <span className="pill" style={{ '--pill': 'var(--serie-imposto)' } as React.CSSProperties}>
                      total {pct(somaImpostos(form.impostos))} da receita
                    </span>
                  )}
                </div>

                <div className="mt-1.5 grid gap-1.5">
                  {form.impostos.map((imp, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="input min-w-0 flex-1"
                        placeholder="ex.: ICMS"
                        aria-label={`Nome do imposto ${i + 1}`}
                        value={imp.nome}
                        onChange={(ev) => {
                          const impostos = [...form.impostos]
                          impostos[i] = { ...imp, nome: ev.target.value }
                          setForm({ ...form, impostos })
                        }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        className="input w-24"
                        aria-label={`Alíquota do imposto ${i + 1} em %`}
                        value={imp.aliquota}
                        onChange={(ev) => {
                          const impostos = [...form.impostos]
                          impostos[i] = { ...imp, aliquota: ev.target.value === '' ? 0 : Number(ev.target.value) }
                          setForm({ ...form, impostos })
                        }}
                      />
                      <span style={{ color: 'var(--text-muted)' }}>%</span>
                      <button
                        className="btn btn-perigo px-2.5 py-1"
                        title={`Remover ${imp.nome || 'imposto'}`}
                        onClick={() => setForm({ ...form, impostos: form.impostos.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => setForm({ ...form, impostos: [...form.impostos, { nome: '', aliquota: 0 }] })}
                  >
                    + Adicionar imposto
                  </button>
                  {form.regime === 'nota' && (
                    <button
                      className="btn btn-ghost text-xs"
                      title="Preenche a tabela e você ajusta o que for diferente"
                      onClick={() =>
                        setForm({
                          ...form,
                          impostos: form.fonte_imposto === 'aliquota' ? [...TABELA_PRESUMIDO] : [...FORA_DA_NOTA],
                        })
                      }
                    >
                      {form.fonte_imposto === 'aliquota'
                        ? 'Usar tabela do Presumido (19,05%)'
                        : 'Usar IRPJ/CSLL do Presumido (3,40%)'}
                    </button>
                  )}
                </div>

                <span className="help mt-1.5 block">
                  {form.regime === 'simples'
                    ? 'É esta alíquota que o app aplica sobre a receita dos projetos desta empresa (ex.: Simples Nacional 10,5). Sem ela, o imposto fica em R$ 0.'
                    : 'Uma linha por imposto, como na planilha da contabilidade. A soma é o que o app aplica sobre a receita dos projetos.'}
                </span>
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
            aria-label="Meta de margem em porcentagem"
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

// Dupla conferência: só quem escreve no custeio pode ser aprovador
const PAPEIS_APROVADOR = new Set(['admin', 'financeiro'])

/** Perfis de tributação por operação — os blocos da planilha, dentro do app.
 *
 * Venda padrão SP paga a tabela cheia (a do cadastro); fins de exportação
 * (CFOP 5502) não tem PIS/COFINS/ICMS, só CSLL/IRPJ. Cada perfil tem sua
 * tabela itemizada; no detalhe do projeto se escolhe qual perfil vale. */
function PerfisTributacao({ empresaId }: { empresaId: number }) {
  const queryClient = useQueryClient()
  const { data: salvos } = useQuery({
    queryKey: ['perfis', empresaId],
    queryFn: () => api.listarPerfis(empresaId),
  })
  const [rascunho, setRascunho] = useState<{ nome: string; impostos: ImpostoEmpresa[] }[] | null>(null)
  const perfis = rascunho ?? (salvos || []).map((p) => ({ nome: p.nome, impostos: p.impostos }))

  const salvar = useMutation({
    mutationFn: () => api.salvarPerfis(empresaId, perfis.filter((p) => p.nome.trim())),
    onSuccess: () => {
      setRascunho(null)
      queryClient.invalidateQueries({ queryKey: ['perfis', empresaId] })
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
      queryClient.invalidateQueries({ queryKey: ['detalhe'] })
    },
  })

  const editar = (novo: { nome: string; impostos: ImpostoEmpresa[] }[]) => setRascunho(novo)

  return (
    <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
      <p className="help mb-2">
        A tabela do cadastro é a operação <b>padrão</b>. Cadastre aqui as exceções — ex.: <b>Fins de exportação</b>{' '}
        (CFOP 5502), que não paga PIS/COFINS/ICMS — e escolha o perfil no detalhe de cada projeto.
      </p>
      <div className="grid gap-3">
        {perfis.map((p, pi) => (
          <div key={pi} className="rounded-lg p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input min-w-0 flex-1 font-semibold"
                placeholder="Nome do perfil (ex.: Fins de exportação)"
                aria-label={`Nome do perfil ${pi + 1}`}
                value={p.nome}
                onChange={(ev) => editar(perfis.map((x, i) => (i === pi ? { ...x, nome: ev.target.value } : x)))}
              />
              <span className="pill" style={{ '--pill': 'var(--serie-imposto)' } as React.CSSProperties}>
                total {pct(somaImpostos(p.impostos))}
              </span>
              <button
                className="btn btn-perigo px-2.5 py-1"
                title="Remover este perfil"
                onClick={() => editar(perfis.filter((_, i) => i !== pi))}
              >
                ×
              </button>
            </div>
            <div className="mt-2 grid gap-1.5">
              {p.impostos.map((imp, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className="input min-w-0 flex-1"
                    placeholder="ex.: CSLL"
                    aria-label={`Imposto ${i + 1} do perfil ${p.nome || pi + 1}`}
                    value={imp.nome}
                    onChange={(ev) =>
                      editar(perfis.map((x, xi) =>
                        xi === pi ? { ...x, impostos: x.impostos.map((y, yi) => (yi === i ? { ...y, nome: ev.target.value } : y)) } : x,
                      ))
                    }
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="input w-24"
                    aria-label={`Alíquota ${i + 1} do perfil ${p.nome || pi + 1} em %`}
                    value={imp.aliquota}
                    onChange={(ev) =>
                      editar(perfis.map((x, xi) =>
                        xi === pi
                          ? { ...x, impostos: x.impostos.map((y, yi) => (yi === i ? { ...y, aliquota: ev.target.value === '' ? 0 : Number(ev.target.value) } : y)) }
                          : x,
                      ))
                    }
                  />
                  <span style={{ color: 'var(--text-muted)' }}>%</span>
                  <button
                    className="btn btn-perigo px-2.5 py-1"
                    title={`Remover ${imp.nome || 'imposto'}`}
                    onClick={() => editar(perfis.map((x, xi) => (xi === pi ? { ...x, impostos: x.impostos.filter((_, yi) => yi !== i) } : x)))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="btn btn-ghost w-fit text-xs"
                onClick={() => editar(perfis.map((x, xi) => (xi === pi ? { ...x, impostos: [...x.impostos, { nome: '', aliquota: 0 }] } : x)))}
              >
                + imposto
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-ghost text-xs"
          onClick={() =>
            editar([
              ...perfis,
              // já nasce com CSLL/IRPJ/Add — o caso de exportação que motivou o recurso;
              // a pessoa ajusta os % conforme o contador
              { nome: '', impostos: [{ nome: 'CSLL', aliquota: 0 }, { nome: 'IRPJ', aliquota: 0 }, { nome: 'Add. IRPJ', aliquota: 0 }] },
            ])
          }
        >
          + Adicionar perfil
        </button>
        {rascunho && (
          <button className="btn btn-primary text-xs" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : 'Salvar perfis'}
          </button>
        )}
        {salvar.error && (
          <span className="text-sm font-semibold" style={{ color: 'var(--neg)' }}>
            {(salvar.error as Error).message}
          </span>
        )}
      </div>
    </div>
  )
}

/** Backup do trabalho humano: o que uma nova sincronização NÃO traz de volta.
 *
 * O banco free do Render expira em 30 dias. Este cartão baixa um JSON com
 * usuários, empresas, classificações, ajustes, os dois ok, orçamentos e
 * comentários — e devolve tudo num banco novo. Restaurar nunca sobrescreve. */
function Backup() {
  const [restaurando, setRestaurando] = useState(false)
  const [resultado, setResultado] = useState<string>('')
  const [erro, setErro] = useState('')

  async function restaurarArquivo(arquivo: File) {
    setRestaurando(true)
    setErro('')
    setResultado('')
    try {
      const dados = JSON.parse(await arquivo.text())
      const r = await api.restaurarBackup(dados)
      const soma = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0)
      const partes = [`${soma(r.criados)} registro(s) restaurados`, `${soma(r.pulados)} já existiam`]
      const pendentes = soma(r.pendentes)
      if (pendentes > 0)
        partes.push(`${pendentes} pendentes — sincronize a Omie e restaure o MESMO arquivo de novo para completá-los`)
      setResultado(partes.join(' · ') + (r.aviso_chave ? ` · ATENÇÃO: ${r.aviso_chave}` : ''))
    } catch (e) {
      setErro(e instanceof SyntaxError ? 'Este arquivo não é um JSON de backup válido' : (e as Error).message)
    } finally {
      setRestaurando(false)
    }
  }

  return (
    <div className="card mb-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="titulo-secao">Backup do trabalho da equipe</span>
          <p className="help mt-0.5 max-w-xl">
            Guarda o que a sincronização não traz de volta: contas, empresas, classificações de custo, ajustes,
            as conferências (os dois ok), orçamentos e comentários. Baixe um arquivo por semana e guarde fora do
            servidor. Restaurar nunca sobrescreve — só devolve o que faltar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoExportBackup />
          <label className={`btn btn-ghost text-xs ${restaurando ? 'opacity-50' : 'cursor-pointer'}`}>
            {restaurando ? 'Restaurando…' : 'Restaurar arquivo'}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={restaurando}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) restaurarArquivo(f)
                e.target.value = '' // permite escolher o mesmo arquivo de novo
              }}
            />
          </label>
        </div>
      </div>
      {resultado && (
        <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--status-good-text)' }}>
          ✓ {resultado}
        </p>
      )}
      {erro && (
        <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--neg)' }}>
          {erro}
        </p>
      )}
    </div>
  )
}

function BotaoExportBackup() {
  const [estado, setEstado] = useState<'pronto' | 'gerando' | 'erro'>('pronto')
  return (
    <button
      className="btn btn-primary text-xs"
      disabled={estado === 'gerando'}
      style={estado === 'erro' ? { background: 'var(--neg)' } : undefined}
      onClick={async () => {
        setEstado('gerando')
        try {
          await baixarArquivo('/api/backup', 'custeio_backup.json')
          setEstado('pronto')
        } catch {
          setEstado('erro')
        }
      }}
    >
      {estado === 'gerando' ? 'Gerando…' : estado === 'erro' ? 'Falhou — tentar de novo' : 'Baixar backup'}
    </button>
  )
}

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
    mutationFn: ({
      id,
      dados,
    }: {
      id: number
      dados: Partial<{ papel: string; ativo: boolean; senha: string; pode_aprovar: boolean }>
    }) => api.atualizarUsuario(id, dados),
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
              aria-label={`Tipo de acesso de ${u.nome}`}
              value={u.papel}
              disabled={u.id === eu?.id}
              onChange={(e) =>
                atualizar.mutate({
                  id: u.id,
                  // quem deixa de escrever no custeio deixa de ser aprovador junto,
                  // senão o servidor recusa a combinação
                  dados: PAPEIS_APROVADOR.has(e.target.value)
                    ? { papel: e.target.value }
                    : { papel: e.target.value, pode_aprovar: false },
                })
              }
            >
              {PAPEIS_OPCOES.map((p) => (
                <option key={p.valor} value={p.valor}>{p.label.split(' — ')[0]}</option>
              ))}
            </select>
            <label
              className="flex items-center gap-1.5 text-xs"
              title={
                PAPEIS_APROVADOR.has(u.papel)
                  ? 'Marque para esta pessoa poder dar o 2º ok (aprovação) da conferência dos projetos'
                  : 'Só admin ou financeiro podem aprovar — este acesso não escreve no custeio'
              }
              style={{ color: 'var(--text-muted)', opacity: PAPEIS_APROVADOR.has(u.papel) ? 1 : 0.45 }}
            >
              <input
                type="checkbox"
                checked={u.pode_aprovar}
                disabled={!PAPEIS_APROVADOR.has(u.papel)}
                onChange={(e) => atualizar.mutate({ id: u.id, dados: { pode_aprovar: e.target.checked } })}
              />
              aprova (2º ok)
            </label>
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
