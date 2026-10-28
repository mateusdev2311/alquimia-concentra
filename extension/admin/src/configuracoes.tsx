import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Secao } from '../../comum/componentes';
import { haQuanto, inteiro } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';

interface TipoFormula {
  nome: string;
  codigo: string;
  categoria: 'manipulado' | 'acabado';
  apelidos: string[];
}

interface Config {
  modeloMensagem: string;
  modeloPadrao: string;
  tipos: TipoFormula[];
  tipoAcabadoPadrao: string;
  variaveis: { nome: string; descricao: string }[];
}

function useConfig(api: Api) {
  const [config, setConfig] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    api<Config>('/v1/admin/config').then(setConfig, (e) => setErro(mensagemDeErro(e)));
  }, [api]);
  const gravar = async (parcial: Partial<Config>) => {
    try {
      setConfig(await api<Config>('/v1/admin/config', { method: 'PUT', body: parcial }));
      avisar('Configuração salva.');
      return true;
    } catch (e) {
      avisar(mensagemDeErro(e), 'error');
      return false;
    }
  };
  return { config, erro, gravar };
}

/** Mesma regra do servidor (mensagem.ts): {{var}} e {{#var}}…{{/var}}. */
function previa(modelo: string, valores: Record<string, string>): string {
  return modelo
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, nome: string, miolo: string) => (valores[nome] ? miolo : ''))
    .replace(/\{\{(\w+)\}\}/g, (inteiro, nome: string) => (nome in valores ? valores[nome] : inteiro))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const EXEMPLO: Record<string, string> = {
  primeiro_nome: 'Maria',
  paciente: 'Maria Aparecida Souza',
  prescritor: 'Dr. João Lima',
  crm: '123456',
  numero: '0964601',
  formulas: '*1. Cápsulas — 60 caps*\n• Vitamina D3 2000 UI\n• Magnésio Quelato 200 mg\n_Tomar 1 cápsula ao dia_\n\n*2. Minoxidil A 5% 100ml* — 1 un.',
  quantidade_itens: '2',
  valor_liquido: 'R$ 142,90',
  valor_bruto: 'R$ 158,00',
  desconto: 'R$ 15,10',
  atendente: 'Thais',
  data: new Intl.DateTimeFormat('pt-BR').format(new Date()),
};

export function AbaMensagem({ api }: { api: Api }) {
  const { config, erro, gravar } = useConfig(api);
  const [modelo, setModelo] = useState<string | null>(null);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!config) return <Carregando />;
  const texto = modelo ?? config.modeloMensagem;
  const alterado = texto !== config.modeloMensagem;
  const inserir = (nome: string) => setModelo(`${texto}{{${nome}}}`);
  return (
    <div class="kt-graficos">
      <Secao icone="mensagem" titulo="Modelo da mensagem do orçamento" descricao="É o resumo que o atendente envia ao cliente depois de gravar o orçamento. Ele pode editar antes de enviar.">
        <label class="kt-campo">
          <span>Mensagem</span>
          <textarea rows={14} value={texto} onInput={(e) => setModelo((e.target as HTMLTextAreaElement).value)} />
          <small class="kt-campo-ajuda kt-muted">
            Use *negrito* e _itálico_ do WhatsApp. {'{{#numero}}'}…{'{{/numero}}'} só aparece quando o número do orçamento foi localizado.
          </small>
        </label>
        <div class="kt-linha-acoes">
          <button type="button" class="kt-botao" disabled={!alterado} onClick={async () => (await gravar({ modeloMensagem: texto })) && setModelo(null)}>
            Salvar
          </button>
          <button type="button" class="kt-botao kt-botao-fantasma" disabled={!alterado} onClick={() => setModelo(null)}>
            Desfazer
          </button>
          <button type="button" class="kt-botao kt-botao-fantasma" onClick={() => setModelo(config.modeloPadrao)}>
            Voltar ao padrão
          </button>
        </div>
        <p class="kt-subtitulo">Variáveis (clique para inserir)</p>
        <ul class="kt-lista-variaveis">
          {config.variaveis.map((v) => (
            <li key={v.nome}>
              <button type="button" class="kt-chip" onClick={() => inserir(v.nome)}>{`{{${v.nome}}}`}</button>
              <span class="kt-muted">{v.descricao}</span>
            </li>
          ))}
        </ul>
      </Secao>
      <Secao icone="olho" titulo="Prévia" descricao="Com dados de exemplo.">
        <pre class="kt-previa-whatsapp">{previa(texto, EXEMPLO)}</pre>
      </Secao>
    </div>
  );
}

export function AbaTipos({ api }: { api: Api }) {
  const { config, erro, gravar } = useConfig(api);
  const [tipos, setTipos] = useState<TipoFormula[] | null>(null);
  const [acabadoPadrao, setAcabadoPadrao] = useState<string | null>(null);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!config) return <Carregando />;
  const lista = tipos ?? config.tipos;
  const padrao = acabadoPadrao ?? config.tipoAcabadoPadrao;
  const mudar = (i: number, parcial: Partial<TipoFormula>) => setTipos(lista.map((t, j) => (j === i ? { ...t, ...parcial } : t)));
  const semCodigo = lista.filter((t) => !t.codigo).length;
  return (
    <Secao
      icone="lista"
      titulo="Tipos de fórmula"
      descricao="O código de cada tipo vai no campo “tipo” do orçamento gravado no Concentra (ex.: Cápsulas = 010100). Os códigos vêm da Concentra."
      acoes={
        <button type="button" class="kt-botao" disabled={!tipos && !acabadoPadrao} onClick={async () => (await gravar({ tipos: lista, tipoAcabadoPadrao: padrao })) && (setTipos(null), setAcabadoPadrao(null))}>
          Salvar
        </button>
      }
    >
      {semCodigo > 0 && (
        <Aviso>
          {semCodigo} {semCodigo === 1 ? 'tipo está' : 'tipos estão'} sem código. Sem o código, o orçamento vai ao Concentra sem o campo “tipo” (a Concentra usa o padrão
          dela). Peça a tabela de códigos à Concentra.
        </Aviso>
      )}
      <label class="kt-campo" style={{ maxWidth: '360px' }}>
        <span>Tipo usado para produto acabado</span>
        <select value={padrao} onChange={(e) => setAcabadoPadrao((e.target as HTMLSelectElement).value)}>
          {lista
            .filter((t) => t.categoria === 'acabado')
            .map((t) => (
              <option key={t.nome} value={t.nome}>
                {t.nome}
              </option>
            ))}
        </select>
      </label>
      <div class="kt-tabela-rolagem">
        <table class="kt-tabela">
          <thead>
            <tr>
              <th>Nome no Concentra</th>
              <th>Código</th>
              <th>Categoria</th>
              <th>Como a IA chama (separe por vírgula)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((t, i) => (
              <tr key={i}>
                <td>
                  <input class="kt-entrada-tabela" value={t.nome} onInput={(e) => mudar(i, { nome: (e.target as HTMLInputElement).value })} />
                </td>
                <td>
                  <input class="kt-entrada-tabela kt-codigo" value={t.codigo} placeholder="—" onInput={(e) => mudar(i, { codigo: (e.target as HTMLInputElement).value.trim() })} />
                </td>
                <td>
                  <select class="kt-entrada-tabela" value={t.categoria} onChange={(e) => mudar(i, { categoria: (e.target as HTMLSelectElement).value as TipoFormula['categoria'] })}>
                    <option value="manipulado">Manipulado</option>
                    <option value="acabado">Produto acabado</option>
                  </select>
                </td>
                <td class="kt-celula-quebra">
                  <input
                    class="kt-entrada-tabela"
                    value={t.apelidos.join(', ')}
                    onInput={(e) => mudar(i, { apelidos: (e.target as HTMLInputElement).value.split(',').map((a) => a.trim()).filter(Boolean) })}
                  />
                </td>
                <td>
                  <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" title="Remover" onClick={() => setTipos(lista.filter((_, j) => j !== i))}>
                    <Icone nome="lixeira" tamanho={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="kt-linha-acoes" style={{ marginTop: '10px' }}>
        <button type="button" class="kt-botao kt-botao-secundario kt-botao-pequeno" onClick={() => setTipos([...lista, { nome: '', codigo: '', categoria: 'manipulado', apelidos: [] }])}>
          <Icone nome="mais" tamanho={13} />
          Incluir tipo
        </button>
      </div>
    </Secao>
  );
}

interface Status {
  concentra: { online: boolean | null; ultimoSucesso: string | null; ultimaFalha: string | null; ultimoErro: string | null; ultimoTempoMs: number | null };
  produtosNaBusca: number;
  iaLigada: boolean;
  modeloIa: string | null;
  webhookKentroLigado: boolean;
  sincronizacoes: { recurso: string; ultimoSucesso: string | null; ultimaCargaTotal: string | null; registros: number; ultimoErro: string | null; emExecucao: boolean }[];
}

const NOMES: Record<string, string> = { produtos: 'Produtos', prescritores: 'Prescritores', clientes: 'Clientes (2 anos de compras)' };

export function AbaConexao({ api }: { api: Api }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<{ ok: boolean; ms: number; mensagem?: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const carregar = () => api<Status>('/v1/admin/status').then(setStatus, (e) => setErro(mensagemDeErro(e)));
  useEffect(() => {
    carregar();
  }, [api]);

  const testar = async () => {
    setOcupado('teste');
    try {
      setTeste(await api('/v1/admin/testar-conexao', { method: 'POST' }));
      carregar();
    } finally {
      setOcupado(null);
    }
  };
  const sincronizar = async (recurso: string) => {
    setOcupado(recurso);
    try {
      const r = await api<{ ok: boolean; registros?: number; mensagem?: string }>(`/v1/admin/sincronizar/${recurso}`, { method: 'POST', timeout: 120000 });
      avisar(r.ok ? `${NOMES[recurso]}: ${inteiro(r.registros ?? 0)} registros.` : r.mensagem ?? 'Falhou.', r.ok ? 'success' : 'error');
      carregar();
    } catch (e) {
      avisar(mensagemDeErro(e), 'error');
    } finally {
      setOcupado(null);
    }
  };

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!status) return <Carregando />;
  const c = status.concentra;
  return (
    <>
      <Secao
        icone="tomada"
        titulo="Conexão com o Concentra"
        descricao="A API fica no servidor da farmácia: se ele desligar ou perder a internet, as consultas param e o cartão do atendente avisa."
        acoes={
          <button type="button" class="kt-botao kt-botao-secundario" disabled={ocupado != null} onClick={testar}>
            {ocupado === 'teste' ? 'Testando…' : 'Testar conexão'}
          </button>
        }
      >
        {c.online === false ? (
          <Aviso tipo="erro">
            <strong>Fora do ar</strong> desde {haQuanto(c.ultimaFalha)}. {c.ultimoErro ? `Motivo: ${c.ultimoErro}.` : ''}
          </Aviso>
        ) : (
          <Aviso tipo="ok">
            <strong>{c.online ? 'No ar' : 'Ainda sem consulta desde que o serviço subiu'}</strong>
            {c.ultimoSucesso ? ` · última resposta ${haQuanto(c.ultimoSucesso)}${c.ultimoTempoMs != null ? ` em ${c.ultimoTempoMs} ms` : ''}` : ''}
          </Aviso>
        )}
        {teste && (
          <Aviso tipo={teste.ok ? 'ok' : 'erro'}>{teste.ok ? `Teste ok: respondeu em ${teste.ms} ms.` : `Teste falhou: ${teste.mensagem}`}</Aviso>
        )}
        <p class="kt-muted">O endereço e a chave da API ficam só nas variáveis do serviço no Doca (CONCENTRA_API_URL e CONCENTRA_API_KEY).</p>
      </Secao>

      <Secao icone="atualizar" titulo="Cópia local do cadastro" descricao="Atualizada a cada 30 minutos (alterações) e refeita todo dia (produtos e prescritores) e toda semana (clientes).">
        <div class="kt-tabela-rolagem">
          <table class="kt-tabela">
            <thead>
              <tr>
                <th>Cadastro</th>
                <th class="kt-num">Registros</th>
                <th>Última atualização</th>
                <th>Última carga completa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {status.sincronizacoes.map((s) => (
                <tr key={s.recurso}>
                  <td>
                    {NOMES[s.recurso] ?? s.recurso}
                    {s.ultimoErro && <div class="kt-muted" style={{ color: 'var(--ext-color-error)' }}>{s.ultimoErro}</div>}
                  </td>
                  <td class="kt-num">{inteiro(s.registros)}</td>
                  <td>{haQuanto(s.ultimoSucesso)}</td>
                  <td>{haQuanto(s.ultimaCargaTotal)}</td>
                  <td>
                    <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={ocupado != null || s.emExecucao} onClick={() => sincronizar(s.recurso)}>
                      {ocupado === s.recurso || s.emExecucao ? 'Atualizando…' : 'Atualizar agora'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao icone="ia" titulo="Leitura de receita (IA)">
        {status.iaLigada ? (
          <Aviso tipo="ok">
            Ligada · modelo <code>{status.modeloIa}</code>. O token da OpenAI fica na variável OPENAI_API_KEY do Doca.
          </Aviso>
        ) : (
          <Aviso tipo="erro">Desligada: defina OPENAI_API_KEY nas variáveis do serviço no Doca.</Aviso>
        )}
        <p class="kt-muted">
          Pré-montagem automática (a automação da Kentro avisa quando chega uma receita): {status.webhookKentroLigado ? 'ligada' : 'desligada (defina TOKEN_WEBHOOK_KENTRO no Doca)'}.
        </p>
      </Secao>
    </>
  );
}

interface Evento {
  id: string;
  usuarioId: string | null;
  usuarioNome: string | null;
  acao: string;
  alvo: string | null;
  criadoEm: string;
}

const ACOES: Record<string, string> = {
  'cliente.identificar': 'Abriu atendimento com cliente identificado',
  'cliente.buscar': 'Buscou cliente pelo nome',
  'receita.consultar': 'Consultou receita',
  'receita.imagem': 'Viu a imagem de receita',
  'receita.ler': 'Leu receita com IA',
  'orcamento.buscar': 'Buscou orçamento',
  'orcamento.iniciar': 'Começou orçamento manual',
  'orcamento.enviar': 'Gravou orçamento no Concentra',
  'orcamento.envio_incerto': 'Envio sem resposta (conferir)',
  'orcamento.descartar': 'Descartou orçamento',
  'orcamento.mensagem': 'Enviou resumo no chat',
  'admin.config': 'Alterou configuração',
  'admin.sincronizar': 'Atualizou o cadastro',
};

export function AbaAuditoria({ api }: { api: Api }) {
  const [pagina, setPagina] = useState(1);
  const [acao, setAcao] = useState('');
  const [dados, setDados] = useState<{ total: number; paginas: number; eventos: Evento[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    api<{ total: number; paginas: number; eventos: Evento[] }>(`/v1/admin/auditoria?pagina=${pagina}${acao ? `&acao=${acao}` : ''}`).then(setDados, (e) => setErro(mensagemDeErro(e)));
  }, [api, pagina, acao]);
  return (
    <Secao icone="historico" titulo="Auditoria" descricao="Quem consultou, leu receita ou gravou orçamento, e quando. Guardada por 12 meses (LGPD).">
      <div class="kt-filtros">
        <label class="kt-select">
          <Icone nome="funil" />
          <select
            value={acao}
            onChange={(e) => {
              setAcao((e.target as HTMLSelectElement).value);
              setPagina(1);
            }}
          >
            <option value="">Todas as ações</option>
            <option value="cliente">Clientes</option>
            <option value="receita">Receitas</option>
            <option value="orcamento">Orçamentos</option>
            <option value="admin">Administração</option>
          </select>
        </label>
        {dados && <span class="kt-filtros-estado">{inteiro(dados.total)} registros</span>}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && !erro && <Carregando />}
      {dados && (
        <>
          <div class="kt-tabela-rolagem">
            <table class="kt-tabela">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O quê</th>
                  <th>Referência</th>
                </tr>
              </thead>
              <tbody>
                {dados.eventos.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.criadoEm).toLocaleString('pt-BR')}</td>
                    <td>{e.usuarioNome ?? (e.usuarioId ? `Usuário ${e.usuarioId}` : 'Automação')}</td>
                    <td>{ACOES[e.acao] ?? e.acao}</td>
                    <td>
                      <code>{e.alvo ?? ''}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="kt-paginacao">
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
              Anterior
            </button>
            <span class="kt-muted">
              Página {pagina} de {dados.paginas}
            </span>
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={pagina >= dados.paginas} onClick={() => setPagina(pagina + 1)}>
              Próxima
            </button>
          </div>
        </>
      )}
    </Secao>
  );
}
