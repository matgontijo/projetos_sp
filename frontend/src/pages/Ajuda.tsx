import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Layout'

/* ============================================================
   Guia de uso escrito para quem nunca viu o sistema.
   Regras do texto: frase curta, zero jargão, e sempre dizendo
   ONDE clicar. Dá para imprimir (o CSS de impressão esconde o
   menu e transforma os cards em folha branca).
   ============================================================ */

function Secao({ id, titulo, resumo, children }: { id: string; titulo: string; resumo?: string; children: ReactNode }) {
  return (
    <section id={id} className="card mt-4 scroll-mt-6">
      <div className="card-head">
        <div>
          <div className="titulo">{titulo}</div>
          {resumo && <div className="sub">{resumo}</div>}
        </div>
      </div>
      <div className="card-corpo grid gap-3 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

/** Passo numerado — o número fica num selo, para a sequência ficar óbvia. */
function Passo({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black"
        style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0">
        <b>{titulo}</b>
        <div style={{ color: 'var(--text-secondary)' }}>{children}</div>
      </div>
    </div>
  )
}

/** Uma tela do app: nome, para que serve e o que dá para fazer nela. */
function Tela({ nome, para, quem, children }: { nome: string; para: string; quem?: string; children?: ReactNode }) {
  return (
    <div className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--gridline)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <b>{nome}</b>
        {quem && (
          <span className="pill" style={{ '--pill': 'var(--text-muted)' } as React.CSSProperties}>
            {quem}
          </span>
        )}
      </div>
      <p className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>
        {para}
      </p>
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

function Palavra({ termo, children }: { termo: string; children: ReactNode }) {
  return (
    <p>
      <b>{termo}</b> — <span style={{ color: 'var(--text-secondary)' }}>{children}</span>
    </p>
  )
}

const INDICE = [
  ['o-que-e', 'O que este app faz'],
  ['palavras', 'As palavras que aparecem o tempo todo'],
  ['rotina', 'A rotina do mês, em 5 passos'],
  ['telas', 'Tela por tela'],
  ['conferencia', 'Os dois "ok" de cada projeto'],
  ['tributacao', 'Quando a venda paga imposto diferente'],
  ['atalhos', 'Atalhos que economizam tempo'],
  ['numero-estranho', 'Quando o número parecer errado'],
  ['duvidas', 'Perguntas que sempre aparecem'],
]

export default function Ajuda() {
  return (
    <div className="guia">
      <PageHeader
        titulo="Como usar o app"
        subtitulo="Guia completo, do zero — feito para quem nunca mexeu no sistema"
        acoes={
          <button className="btn btn-ghost nao-imprimir" onClick={() => window.print()}>
            Imprimir este guia
          </button>
        }
      />

      {/* resumo para quem não vai ler tudo */}
      <div className="card px-5 py-4">
        <div className="titulo-secao">O essencial em um minuto</div>
        <p className="mt-2 text-sm leading-relaxed">
          Este app <b>lê</b> as informações que já existem na Omie e monta, sozinho, a conta de cada projeto:
          quanto entrou, quanto saiu, quanto foi de imposto e quanto sobrou. Ele <b>nunca altera nada na Omie</b>.
          Para usar no dia a dia bastam três telas: <b>Visão geral</b> (como está o negócio),
          <b> Projetos</b> (a lista, projeto por projeto) e <b>Buscar dados</b> (trazer o que é novo da Omie).
          E dois atalhos poupam muito tempo: <b>Ctrl+K</b> acha qualquer projeto pelo número ou pelo cliente, e o{' '}
          <b>sino</b> no canto avisa o que precisa de atenção sem você procurar.
        </p>
      </div>

      {/* índice */}
      <nav className="card mt-4 px-5 py-4 nao-imprimir">
        <div className="titulo-secao">Índice</div>
        <ol className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
          {INDICE.map(([id, titulo], i) => (
            <li key={id}>
              <a href={`#${id}`} className="underline-offset-2 hover:underline" style={{ color: 'var(--accent)' }}>
                {i + 1}. {titulo}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Secao id="o-que-e" titulo="1. O que este app faz" resumo="De onde vêm os números e por que confiar neles">
        <p>
          Vocês vendem por duas empresas (dois CNPJ, duas contas na Omie). Um mesmo projeto pode ter sido
          faturado por uma e pago pela outra. Na Omie, cada conta mostra só a metade que é dela — e por isso
          ninguém enxergava o resultado inteiro do projeto.
        </p>
        <p>
          O app resolve isso: ele copia para si os lançamentos das duas contas e junta tudo{' '}
          <b>pelo número do projeto</b> (BR25_400, BR26_055…). Com isso ele calcula, para cada projeto:
        </p>
        <p style={{ color: 'var(--text-secondary)' }}>
          <b>o que entrou</b> (contas a receber) <b>− o que saiu</b> (contas a pagar, separadas por tipo de custo){' '}
          <b>− os impostos</b> = <b>o que sobrou</b>.
        </p>
        <p>
          Três coisas importantes: o app <b>só lê</b> da Omie (nunca escreve lá); ele considera{' '}
          <b>apenas projetos de venda</b>, que são os que começam com <b>BR</b> (centros de custo internos, como
          Administrativo ou Estoque, ficam de fora); e nada é calculado por adivinhação — quando um número
          depende de uma escolha de vocês (o imposto da empresa, por exemplo), essa escolha fica registrada no
          cadastro.
        </p>
      </Secao>

      <Secao id="palavras" titulo="2. As palavras que aparecem o tempo todo" resumo="Se entender estas seis, entendeu o app inteiro">
        <Palavra termo="Receita">
          Tudo o que o cliente pagou (ou vai pagar) por aquele projeto. Sai das contas a receber da Omie.
        </Palavra>
        <Palavra termo="Custos">
          O que vocês gastaram no projeto, separado em <b>Produção</b>, <b>Frete</b>, <b>Comissão</b> e{' '}
          <b>Outros</b>. Essa separação vem da classificação que vocês fizeram das categorias (veja a tela
          Empresas).
        </Palavra>
        <Palavra termo="Impostos">
          O que o governo leva daquela venda. No Simples, é a alíquota que está no cadastro da empresa. No Lucro
          Presumido, vem dos impostos destacados nas notas fiscais mais os que vocês cadastrarem (IRPJ, CSLL…) —
          ou só da tabela cadastrada, se preferirem calcular como na planilha da contabilidade.
        </Palavra>
        <Palavra termo="Resultado">
          O que sobrou: receita menos custos menos impostos. É o lucro do projeto. Quando fica negativo, aparece
          em vermelho — o projeto deu prejuízo.
        </Palavra>
        <Palavra termo="Margem">
          O resultado em porcentagem da receita. Vender R$ 100 e sobrar R$ 25 é margem de 25%. É por ela que se
          compara projeto grande com projeto pequeno.
        </Palavra>
        <Palavra termo="Meta de margem">
          A margem que vocês consideram boa (vem configurada em 20%, e muda em Empresas → Preferências). É ela
          que pinta os projetos de verde, amarelo ou vermelho.
        </Palavra>
      </Secao>

      <Secao id="rotina" titulo="3. A rotina do mês, em 5 passos" resumo="Se você fizer só isto, o app já está cumprindo o papel dele">
        <Passo n={1} titulo="Traga o que é novo da Omie">
          Em <Link to="/sincronizar" className="underline">Buscar dados</Link>, escolha o período e clique em{' '}
          <b>Buscar dados</b>. Pode rodar quantas vezes quiser: o app só atualiza o que mudou, nunca duplica.
          Se a busca automática estiver ligada, isso já acontece sozinho todo dia.
        </Passo>
        <Passo n={2} titulo="Classifique o que ainda não foi classificado">
          Em <Link to="/empresas" className="underline">Empresas → Classificar custos</Link>, diga o que cada
          categoria de conta a pagar representa (produção, frete, comissão…). Categoria sem classificação cai em
          "Outros" e a Visão geral avisa quanto ficou assim.
        </Passo>
        <Passo n={3} titulo="Olhe a Visão geral">
          Em <Link to="/dashboard" className="underline">Visão geral</Link> você vê o resultado do período inteiro
          e a faixa <b>Precisa de atenção</b> — projetos no prejuízo ou abaixo da meta. Clique em qualquer um
          para abrir e entender o motivo.
        </Passo>
        <Passo n={4} titulo="Confira e aprove os projetos">
          Na lista de <Link to="/projetos" className="underline">Projetos</Link>, cada projeto precisa de{' '}
          <b>dois ok</b> de pessoas diferentes para ser considerado fechado. Dá para dar os ok um a um ou vários
          de uma vez (explicado mais abaixo).
        </Passo>
        <Passo n={5} titulo="Exporte o fechamento">
          Ainda em Projetos, os botões <b>Exportar PDF</b> (relatório pronto para apresentar), <b>Excel</b>{' '}
          (planilha para trabalhar em cima) e <b>CSV</b> geram o arquivo do período filtrado.
        </Passo>
      </Secao>

      <Secao id="telas" titulo="4. Tela por tela" resumo="O que cada item do menu faz — na ordem em que aparecem">
        <p className="help">
          O menu fica na faixa escura à esquerda (no celular, no botão de três risquinhos no alto). Embaixo dele
          há três botõezinhos para escolher o tema: <b>claro</b>, <b>seguir o computador</b> ou <b>escuro</b>.
        </p>

        <div className="mt-1 grid gap-3">
          <Tela nome="Visão geral" para="O retrato do período: quanto sobrou no total, o que precisa de atenção e como foi mês a mês.">
            <ul className="ml-4 list-disc" style={{ color: 'var(--text-secondary)' }}>
              <li>
                No alto, os filtros: escolha as <b>empresas</b> e o <b>período</b>. Eles valem para as telas de
                fechamento inteiras e continuam valendo quando você navega.
              </li>
              <li>
                No gráfico <b>Evolução mensal</b> dá para <b>arrastar</b> em cima dos meses para ampliar um pedaço,
                usar a <b>rodinha do mouse</b> para aproximar, e clicar em <b>Usar como filtro</b> para a página
                inteira passar a mostrar só aqueles meses. Dois cliques voltam ao normal.
              </li>
              <li>
                <b>Para onde foi cada real</b> mostra quanto da receita cada tipo de custo consumiu.{' '}
                <b>Margem dos 15 maiores</b> ordena os projetos grandes do melhor para o pior.
              </li>
            </ul>
          </Tela>

          <Tela nome="Projetos" para="A lista completa, um projeto por linha, com receita, custos, impostos, resultado e margem.">
            <ul className="ml-4 list-disc" style={{ color: 'var(--text-secondary)' }}>
              <li>Clique no cabeçalho de uma coluna para ordenar por ela (a segunda vez inverte).</li>
              <li>A caixa de busca acha por número de projeto, cliente ou empresa.</li>
              <li>
                A coluna <b>Conf.</b> mostra quantos ok o projeto já tem (0/2, 1/2, 2/2). Clicando nela você dá o
                próximo ok.
              </li>
              <li>
                Para conferir vários: marque as caixinhas (segurando <b>Shift</b> marca do primeiro ao último de
                uma vez) e use o botão de dar ok em lote.
              </li>
              <li>Clique na linha para abrir o detalhe do projeto.</li>
            </ul>
          </Tela>

          <Tela nome="Detalhe do projeto" para="Tudo o que compõe aquele projeto — e onde se corrige o que veio errado da Omie.">
            <ul className="ml-4 list-disc" style={{ color: 'var(--text-secondary)' }}>
              <li>
                No alto: o resultado, a margem e a conta aberta (receita − produção − frete − comissão − impostos
                − outros).
              </li>
              <li>
                <b>Resultado projetado × realizado</b>: informe o lucro que a proposta prometia; o app compara com
                o que realmente aconteceu e avisa quando render menos.
              </li>
              <li>
                As abas <b>Recebimentos</b>, <b>Pagamentos</b> e <b>Notas fiscais</b> listam os lançamentos, com o{' '}
                <b>total no rodapé</b>. Em cada linha dá para <b>Mover</b> para outro projeto, <b>Excluir</b> do
                fechamento (reversível), <b>Reclassificar</b> o tipo de custo ou <b>Corrigir imposto</b> da nota.
              </li>
              <li>
                Toda correção fica registrada com o seu nome na aba <b>Ajustes</b> — nada se perde. E há uma aba de{' '}
                <b>Comentários</b> para escrever a história do projeto ("cliente aprovou reposição sem custo").
              </li>
            </ul>
          </Tela>

          <Tela nome="Análises" para="Três olhares sobre o mesmo período: Clientes, Vendedores e Caixa.">
            <span style={{ color: 'var(--text-secondary)' }}>
              <b>Clientes</b> ordena quem mais sustenta o faturamento (classe A são os que somam 80% da receita).{' '}
              <b>Vendedores</b> mostra quanto cada um vendeu e com que margem. <b>Caixa</b> mostra o que está em
              aberto e o que está atrasado, para receber e para pagar.
            </span>
          </Tela>

          <Tela nome="Compras" para="Os pedidos de compra da Omie: o dinheiro já comprometido que ainda não virou conta a pagar.">
            <span style={{ color: 'var(--text-secondary)' }}>
              É a saída que não aparece em nenhum outro lugar. Mostra o comprometido dos próximos 30 dias, o que
              já venceu e o crédito de impostos das compras.
            </span>
          </Tela>

          <Tela nome="Simulador" para="Antes de fechar um pedido: qual o preço mínimo para dar a margem que você quer, e por qual empresa vale mais faturar.">
            <span style={{ color: 'var(--text-secondary)' }}>
              Informe o custo estimado, a margem desejada e (se houver) a comissão. O app calcula o preço mínimo em
              cada empresa usando o imposto real de cada uma.
            </span>
          </Tela>

          <Tela nome="Precificação" quem="comercial" para="Monta o orçamento de um pedido e diz o preço certo, já com imposto, margem e comissão embutidos.">
            <span style={{ color: 'var(--text-secondary)' }}>
              Escolha a empresa que vai faturar, o produto, a quantidade e o acabamento; acrescente custos extras
              se precisar. O preço à vista e a prazo saem prontos, e o botão salva o orçamento no histórico.
            </span>
          </Tela>

          <Tela nome="Orçamentos" quem="comercial" para="O histórico das propostas, com o cálculo congelado de cada uma.">
            <span style={{ color: 'var(--text-secondary)' }}>
              Cada orçamento nasce <b>rascunho</b>, vira <b>enviado</b> e depois <b>aprovado</b> — e nunca volta
              atrás, para a auditoria ficar honesta. Dá para gerar o PDF da proposta e exportar a lista.
            </span>
          </Tela>

          <Tela nome="Cadastros" quem="administradora e financeiro" para="As tabelas que alimentam a Precificação: produtos, custos, alíquotas e parâmetros.">
            <span style={{ color: 'var(--text-secondary)' }}>
              Mexa aqui quando um custo mudar de verdade — todo orçamento novo passa a usar o valor atualizado.
            </span>
          </Tela>

          <Tela nome="Buscar dados" para="É aqui que o app vai à Omie buscar notas, contas a receber e contas a pagar.">
            <span style={{ color: 'var(--text-secondary)' }}>
              Escolha as empresas (nenhuma marcada = todas), o período de emissão e clique em Buscar dados. A
              tabela de baixo mostra o andamento: <b>executando</b> pisca, <b>concluído</b> fica verde e{' '}
              <b>erro</b> explica o que houve. Pode rodar de novo sem medo — nada duplica.
            </span>
          </Tela>

          <Tela nome="Empresas" para="O cadastro que faz o resto funcionar: conexão com a Omie, impostos, classificação de custos, equipe e preferências.">
            <ul className="ml-4 list-disc" style={{ color: 'var(--text-secondary)' }}>
              <li>
                <b>Conectar empresa</b>: as chaves (App Key e App Secret) vêm do Portal do Desenvolvedor da Omie e
                ficam criptografadas aqui. Cada CNPJ tem a sua.
              </li>
              <li>
                <b>Impostos</b>: uma linha por imposto, como na planilha da contabilidade. No Presumido você
                escolhe se o imposto vem das notas fiscais mais esses percentuais, ou só da tabela cadastrada.
              </li>
              <li>
                <b>Classificar custos</b>: dizer o que cada categoria da Omie representa. É o que separa produção
                de frete e de comissão.
              </li>
              <li>
                <b>Equipe</b> (só administradora): cadastra as pessoas, define o que cada uma pode fazer e marca
                quem pode dar o 2º ok.
              </li>
              <li>
                <b>Preferências</b>: a meta de margem e a busca automática diária.
              </li>
            </ul>
          </Tela>
        </div>
      </Secao>

      <Secao id="conferencia" titulo='5. Os dois "ok" de cada projeto' resumo="Ninguém fecha um projeto sozinho">
        <p>
          Todo projeto precisa de <b>duas conferências, de pessoas diferentes</b>. É o mesmo princípio de assinar
          um cheque a quatro mãos: reduz erro e dá rastro de quem viu o quê.
        </p>
        <Passo n={1} titulo="1º ok — conferência">
          Qualquer pessoa que possa mexer no custeio confere os números e dá o primeiro ok.
        </Passo>
        <Passo n={2} titulo="2º ok — aprovação">
          Só quem estiver marcado como <b>aprovador</b> em Empresas → Equipe, e <b>nunca a mesma pessoa</b> que
          deu o primeiro. Com os dois ok, o projeto conta como fechado.
        </Passo>
        <p>
          Cada ok <b>congela os números daquele momento</b>. Se depois disso alguém corrigir um lançamento ou uma
          nova busca trouxer dados novos, o projeto passa a mostrar <b>"mudou depois do ok"</b> — o ok continua
          valendo, mas fica o aviso de que vale a pena olhar de novo. Na lista de Projetos existe um filtro só
          para esses casos. Desfazer um ok é coisa de administradora, e mesmo assim o registro antigo não é
          apagado.
        </p>
      </Secao>

      <Secao
        id="tributacao"
        titulo="6. Quando a venda paga imposto diferente"
        resumo="Exportação não paga PIS/COFINS/ICMS — o app precisa saber disso"
      >
        <p>
          A tabela de impostos que está no cadastro da empresa vale para a <b>venda normal</b>. Mas nem toda venda
          paga o mesmo: uma venda para <b>fins de exportação</b>, por exemplo, não tem PIS, COFINS nem ICMS — só
          CSLL e IRPJ. Se o app aplicasse a tabela cheia nesses projetos, o imposto sairia bem maior que o real e o
          lucro apareceria menor do que é.
        </p>
        <p>
          Por isso existem os <b>perfis de tributação</b>: você cadastra uma vez cada tipo de venda que foge do
          padrão e, depois, marca em cada projeto qual deles vale.
        </p>
        <Passo n={1} titulo="Cadastre o tipo de venda (uma vez só)">
          Vá em <Link to="/empresas" className="underline">Empresas</Link>, no cartão da empresa, e clique em{' '}
          <b>Tributação por operação</b>. Clique em <b>+ Adicionar perfil</b>, dê um nome (ex.:{' '}
          <b>Fins de exportação</b>) e preencha os percentuais que essa operação paga. O app mostra o total somado
          ao lado. Clique em <b>Salvar perfis</b>.
        </Passo>
        <Passo n={2} titulo="Marque o projeto">
          Abra o projeto e procure o cartão <b>Tributação</b>. Troque de <b>Padrão da empresa</b> para o perfil que
          você criou. O imposto, o resultado e a margem se recalculam na hora, e fica registrado quem escolheu.
        </Passo>
        <p className="help">
          Projeto sem escolha continua usando a tabela padrão da empresa — ou seja, quem não usa exportação não
          precisa mexer em nada. Empresa no Simples ignora perfis, porque lá a alíquota é o DAS e não muda com o
          tipo de operação.
        </p>
      </Secao>

      <Secao id="atalhos" titulo="7. Atalhos que economizam tempo" resumo="Três recursos que a maioria descobre tarde demais">
        <Palavra termo="Ctrl+K — achar qualquer coisa">
          Aperte <b>Ctrl+K</b> (ou só a tecla <b>/</b>) em qualquer tela e digite o número do projeto ou o nome do
          cliente. Com centenas de projetos, é a diferença entre 2 segundos e rolar a lista inteira. As setas
          navegam, <b>Enter</b> abre. Ele também lembra os últimos que você abriu.
        </Palavra>
        <Palavra termo="O sino — o app te procura">
          No canto da tela há um sino com um número vermelho: é o que precisa de atenção — projeto no prejuízo,
          margem abaixo da meta, custo sem classificação, projetos esperando ok. Clicar numa notificação abre
          direto o lugar certo. Marcar como lida vale <b>só para você</b>: não some para o resto da equipe.
        </Palavra>
        <Palavra termo="Dar ok em vários de uma vez">
          Na lista de Projetos, filtre por <b>Pendentes</b>, marque a caixinha do cabeçalho (seleciona todos) e use
          o botão que aparece embaixo. Também dá para marcar um, segurar <b>Shift</b> e clicar em outro para
          selecionar tudo que está entre eles.
        </Palavra>
        <Palavra termo="Recolher o menu">
          A setinha no alto do menu escuro encolhe ele para só os ícones, liberando espaço para as tabelas. O app
          lembra da sua escolha.
        </Palavra>
      </Secao>

      <Secao id="numero-estranho" titulo="8. Quando o número parecer errado" resumo="A ordem em que vale a pena investigar">
        <Passo n={1} titulo="O período e as empresas estão certos?">
          Quase todo susto vem daí. Confira os filtros no alto da tela — inclusive se algum recorte antigo ficou
          aplicado.
        </Passo>
        <Passo n={2} titulo="Falta buscar dados?">
          Se o lançamento entrou na Omie hoje e a última busca foi ontem, ele ainda não está aqui. Rode a busca do
          período.
        </Passo>
        <Passo n={3} titulo="O custo caiu em 'Outros'?">
          Isso quase sempre significa categoria sem classificação. Vá em Empresas → Classificar custos.
        </Passo>
        <Passo n={4} titulo="O lançamento está no projeto certo?">
          Se alguém digitou o projeto errado na Omie, abra o detalhe do projeto e use <b>Mover</b> para levar o
          lançamento ao projeto correto — ou <b>Excluir</b> para tirá-lo do fechamento.
        </Passo>
        <Passo n={5} titulo="O imposto está diferente do esperado?">
          Confira a tabela de impostos da empresa em Empresas → Editar. É de lá que sai a conta — o app não usa
          nenhum percentual inventado. Se a venda for de um tipo que paga imposto diferente (exportação, por
          exemplo), veja a seção <a href="#tributacao" className="underline">Quando a venda paga imposto diferente</a>.
        </Passo>
      </Secao>

      <Secao id="duvidas" titulo="9. Perguntas que sempre aparecem" resumo="As dúvidas mais comuns de quem está começando">
        <p>
          <b>Mexer aqui muda alguma coisa na Omie?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Não. O app só lê. Correções feitas aqui valem para o fechamento e ficam registradas em Ajustes.
          </span>
        </p>
        <p>
          <b>Posso rodar a busca de dados várias vezes?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Pode. Ela atualiza o que mudou e ignora o resto — nada duplica.
          </span>
        </p>
        <p>
          <b>Dei os dois ok e agora não consigo mais editar. É problema?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Não, é proteção. Projeto com os dois ok fica travado: os botões viram um cadeado e nem ajuste nem troca
            de tributação passam. Para editar, uma administradora desfaz o 2º ok no detalhe do projeto — o
            histórico de quem deu e quem desfez fica guardado.
          </span>
        </p>
        <p>
          <b>Como faço uma cópia de segurança?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Em Empresas (área da administradora) há o cartão <b>Backup do trabalho da equipe</b>. Ele baixa um
            arquivo com o que a Omie não devolve: contas, classificações, ajustes, os ok da conferência e
            orçamentos. Vale baixar um por semana e guardar fora do servidor.
          </span>
        </p>
        <p>
          <b>Por que um projeto não aparece na lista?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Ou o número não começa com BR (então não é projeto de venda), ou os lançamentos estão fora do período
            filtrado, ou ainda não foram buscados da Omie.
          </span>
        </p>
        <p>
          <b>Errei um ajuste. E agora?</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Nada se perde: exclusões são reversíveis pelo botão Restaurar, e todo ajuste aparece na aba Ajustes com
            autor e motivo.
          </span>
        </p>
        <p>
          <b>Esqueci minha senha.</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            Peça a uma administradora para redefinir em Empresas → Equipe.
          </span>
        </p>
        <p>
          <b>O app demorou para responder.</b>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            No plano gratuito o servidor "dorme" quando ninguém usa e leva até um minuto para acordar na primeira
            vez do dia. Depois disso fica rápido.
          </span>
        </p>
      </Secao>

      <p className="mt-4 text-center text-xs nao-imprimir" style={{ color: 'var(--text-muted)' }}>
        Ficou alguma dúvida que este guia não respondeu? Anote na aba Comentários do projeto — assim ela vira
        assunto da próxima melhoria.
      </p>
    </div>
  )
}
