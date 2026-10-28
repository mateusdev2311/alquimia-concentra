import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { ESPERAR, Esperar, Fetch, FETCH } from '../comum/fetch';

/** Funções que só leem: podem ser repetidas quando a rede falha. `gerar_orcamento` NUNCA é repetida. */
const FUNCOES_LEITURA = [
  'retorna_imagem_receita',
  'retorna_dados_completos_receita',
  'listar_info_produtos_por_data',
  'listar_info_clientes_por_data',
  'listar_info_clientes_por_ultima_compra',
  'listar_info_clientes_por_nome',
  'listar_info_prescritores_por_data',
  'listar_produtos_por_descricao',
  'listar_orcamento_por_numero',
  'listar_formulas_F9_por_descricao',
] as const;
const SO_LEITURA = new Set<string>(FUNCOES_LEITURA);

export type FuncaoConcentra = 'gerar_orcamento' | (typeof FUNCOES_LEITURA)[number];

/** "Nenhum registro encontrado", "Produto não encontrado", "Fórmula: (X) não encontrada…": é lista vazia, não falha. */
const NAO_ENCONTRADO = /n[aã]o\s+encontrad|nenhum\s+registro/i;

export type TipoFalha = 'indisponivel' | 'chave' | 'recusado';

/** Falha ao falar com a Concentra, já com a mensagem para o atendente. */
export class FalhaConcentra extends ErroApi {
  constructor(
    readonly tipo: TipoFalha,
    mensagem: string,
    readonly detalhe?: string,
  ) {
    const status = tipo === 'recusado' ? 422 : 503;
    const codigo = tipo === 'indisponivel' ? 'CONCENTRA_FORA_DO_AR' : tipo === 'chave' ? 'CONCENTRA_CHAVE' : 'CONCENTRA_RECUSOU';
    super(status, codigo, mensagem, detalhe ? { detalhe } : {});
  }
}

export interface EstadoConexao {
  online: boolean | null;
  ultimoSucesso: Date | null;
  ultimaFalha: Date | null;
  ultimoErro: string | null;
  /** Tempo da última resposta (ms). */
  ultimoTempo: number | null;
}

export interface OpcoesChamada {
  /** Tempo limite desta chamada (ms). Padrão: CONCENTRA_TEMPO_LIMITE_MS. */
  tempoLimite?: number;
  /** "Não encontrado" vira lista vazia (padrão true nas leituras). */
  vazioSeNaoEncontrado?: boolean;
}

const INDISPONIVEL = 'O sistema da farmácia (Concentra) está fora do ar ou sem internet. Tente de novo em alguns minutos.';

@Injectable()
export class ConcentraClient {
  private readonly logger = new Logger('Concentra');
  readonly estado: EstadoConexao = { online: null, ultimoSucesso: null, ultimaFalha: null, ultimoErro: null, ultimoTempo: null };

  constructor(
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    @Inject(FETCH) private readonly fetch: Fetch,
    @Inject(ESPERAR) private readonly esperar: Esperar,
  ) {}

  /**
   * Uma chamada à apiconc. Devolve o JSON já sem o envelope de erro.
   * A Concentra responde erros com HTTP 200 e `[{"erro": "..."}]` (ou `{"erro": ...}`): os dois viram FalhaConcentra.
   */
  async chamar<T = unknown>(funcao: FuncaoConcentra, parametros: Record<string, unknown> = {}, opcoes: OpcoesChamada = {}): Promise<T> {
    const leitura = SO_LEITURA.has(funcao);
    const tentativas = leitura ? 2 : 1;
    let ultima: unknown;
    for (let i = 0; i < tentativas; i++) {
      try {
        return await this.umaVez<T>(funcao, parametros, opcoes, leitura);
      } catch (erro) {
        ultima = erro;
        // Só a rede (ou o servidor da farmácia reiniciando) justifica tentar de novo.
        if (!(erro instanceof FalhaConcentra) || erro.tipo !== 'indisponivel' || i === tentativas - 1) throw erro;
        await this.esperar(1500);
      }
    }
    throw ultima;
  }

  private async umaVez<T>(funcao: string, parametros: Record<string, unknown>, opcoes: OpcoesChamada, leitura: boolean): Promise<T> {
    const inicio = Date.now();
    let resposta: Response;
    try {
      resposta = await this.fetch(this.config.concentra.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.concentra.chave },
        body: JSON.stringify({ funcao, ...parametros }),
        signal: AbortSignal.timeout(opcoes.tempoLimite ?? this.config.concentra.tempoLimite),
      });
    } catch (erro) {
      throw this.falhou(funcao, inicio, new FalhaConcentra('indisponivel', INDISPONIVEL, motivoDeRede(erro)));
    }

    let texto: string;
    try {
      texto = await resposta.text();
    } catch {
      throw this.falhou(funcao, inicio, new FalhaConcentra('indisponivel', INDISPONIVEL, 'resposta interrompida'));
    }

    if (resposta.status === 401 || resposta.status === 403) {
      throw this.falhou(
        funcao,
        inicio,
        new FalhaConcentra('chave', 'A chave da API da Concentra foi recusada. Avise o administrador (variável CONCENTRA_API_KEY no Doca).'),
      );
    }
    if (resposta.status >= 500) {
      throw this.falhou(funcao, inicio, new FalhaConcentra('indisponivel', INDISPONIVEL, `HTTP ${resposta.status}`));
    }

    let corpo: unknown;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      throw this.falhou(funcao, inicio, new FalhaConcentra('indisponivel', 'A Concentra respondeu num formato inesperado. Tente de novo.', 'JSON inválido'));
    }

    const erro = mensagemDeErro(corpo);
    if (erro != null) {
      // A API respondeu: a conexão está boa, mesmo com o erro funcional.
      this.registrarSucesso(inicio);
      this.logger.log(`${funcao}: erro "${erro.slice(0, 120)}" (${Date.now() - inicio} ms)`);
      if (/acesso n[aã]o autorizado/i.test(erro)) {
        throw new FalhaConcentra('chave', 'A chave da API da Concentra foi recusada. Avise o administrador (variável CONCENTRA_API_KEY no Doca).');
      }
      if (leitura && opcoes.vazioSeNaoEncontrado !== false && NAO_ENCONTRADO.test(erro)) return [] as T;
      throw new FalhaConcentra('recusado', `A Concentra recusou: ${erro}`, erro);
    }
    if (resposta.status >= 400) {
      throw this.falhou(funcao, inicio, new FalhaConcentra('recusado', `A Concentra recusou a requisição (HTTP ${resposta.status}).`));
    }

    this.registrarSucesso(inicio);
    this.logger.log(`${funcao}: ok (${Date.now() - inicio} ms, ${texto.length} bytes)`);
    return corpo as T;
  }

  private registrarSucesso(inicio: number): void {
    this.estado.online = true;
    this.estado.ultimoSucesso = new Date();
    this.estado.ultimoTempo = Date.now() - inicio;
  }

  private falhou(funcao: string, inicio: number, erro: FalhaConcentra): FalhaConcentra {
    if (erro.tipo !== 'recusado') {
      this.estado.online = false;
      this.estado.ultimaFalha = new Date();
      this.estado.ultimoErro = erro.detalhe ?? erro.mensagem;
    }
    // Nunca loga parâmetros nem resposta: há dados de paciente.
    this.logger.warn(`${funcao}: ${erro.codigo} ${erro.detalhe ?? ''} (${Date.now() - inicio} ms)`);
    return erro;
  }
}

const MOTIVOS_DE_REDE: Record<string, string> = {
  ENOTFOUND: 'o endereço (DNS) não foi encontrado',
  EAI_AGAIN: 'o DNS não respondeu',
  ECONNREFUSED: 'conexão recusada na porta (servidor desligado ou porta fechada)',
  ECONNRESET: 'a conexão foi derrubada no meio',
  ETIMEDOUT: 'tempo esgotado ao conectar (firewall ou servidor fora do ar)',
  UND_ERR_CONNECT_TIMEOUT: 'tempo esgotado ao conectar (firewall ou servidor fora do ar)',
  UND_ERR_SOCKET: 'a conexão foi derrubada no meio',
  EHOSTUNREACH: 'sem rota até o servidor da farmácia',
  ENETUNREACH: 'sem rota até o servidor da farmácia',
};

/** O motivo real de uma falha de rede: o fetch do Node só diz "fetch failed" e guarda o código em `cause`. */
export function motivoDeRede(erro: unknown): string {
  const e = erro as { name?: string; code?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'tempo esgotado esperando a resposta';
  const codigo = e?.cause?.code ?? e?.code;
  if (codigo && MOTIVOS_DE_REDE[codigo]) return `${MOTIVOS_DE_REDE[codigo]} (${codigo})`;
  return codigo ? `sem conexão (${codigo})` : `sem conexão${e?.cause?.message ? ` (${e.cause.message})` : ''}`;
}

/** A mensagem de `{"erro": "..."}` ou `[{"erro": "..."}]`; null se a resposta não é um erro. */
export function mensagemDeErro(corpo: unknown): string | null {
  const unico = Array.isArray(corpo) && corpo.length === 1 ? corpo[0] : corpo;
  if (unico && typeof unico === 'object' && !Array.isArray(unico) && 'erro' in unico) {
    return String((unico as { erro: unknown }).erro ?? 'erro sem descrição');
  }
  return null;
}

/** Listagens: a resposta é uma lista de registros (um objeto solto vira lista de um). */
export function comoLista<T>(corpo: unknown): T[] {
  if (Array.isArray(corpo)) return corpo as T[];
  if (corpo && typeof corpo === 'object') return [corpo as T];
  return [];
}
