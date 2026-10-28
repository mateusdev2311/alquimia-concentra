import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ErroApi } from '../comum/erros';
import { Fetch, FETCH } from '../comum/fetch';
import { Arquivo, corpoOpenAi, ReceitaLida, textoDaResposta } from './leitura';

const URL_OPENAI = 'https://api.openai.com/v1/responses';

@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger('OpenAI');

  constructor(
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    @Inject(FETCH) private readonly fetch: Fetch,
  ) {}

  get ligada(): boolean {
    return this.config.openai != null;
  }

  async lerReceita(arquivo: Arquivo): Promise<ReceitaLida> {
    const openai = this.config.openai;
    if (!openai) throw new ErroApi(503, 'IA_DESLIGADA', 'A leitura de receita está desligada (falta OPENAI_API_KEY no Doca).');
    const inicio = Date.now();
    let resposta: Response;
    try {
      resposta = await this.fetch(URL_OPENAI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai.chave}` },
        body: JSON.stringify(corpoOpenAi(openai.modelo, arquivo)),
        signal: AbortSignal.timeout(150_000),
      });
    } catch {
      throw new ErroApi(504, 'IA_SEM_RESPOSTA', 'A IA demorou demais para ler a receita. Tente de novo.');
    }
    const texto = await resposta.text();
    if (!resposta.ok) {
      let motivo = '';
      try {
        motivo = String(JSON.parse(texto)?.error?.message ?? '');
      } catch {
        // corpo sem JSON
      }
      this.logger.warn(`HTTP ${resposta.status}: ${motivo.slice(0, 200)}`);
      if (resposta.status === 401) throw new ErroApi(502, 'IA_CHAVE', 'A chave da OpenAI foi recusada (OPENAI_API_KEY no Doca).');
      if (resposta.status === 429) throw new ErroApi(502, 'IA_LIMITE', 'A OpenAI recusou por limite de uso ou falta de créditos. Tente em alguns minutos ou avise o administrador.');
      throw new ErroApi(502, 'IA_RECUSOU', `A IA não conseguiu ler este arquivo${motivo ? `: ${motivo.slice(0, 160)}` : '.'}`);
    }
    const json = textoDaResposta(JSON.parse(texto));
    if (!json) throw new ErroApi(502, 'IA_SEM_TEXTO', 'A IA não devolveu a leitura. Tente de novo.');
    this.logger.log(`receita lida em ${Date.now() - inicio} ms (${openai.modelo})`);
    return JSON.parse(json) as ReceitaLida;
  }
}
