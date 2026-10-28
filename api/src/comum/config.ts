import * as path from 'node:path';

export const CONFIG_APP = Symbol('CONFIG_APP');

export interface ConfigApp {
  porta: number;
  databaseUrl: string;
  urlPublica: string;
  dirExtensao: string;
  concentra: {
    url: string;
    /** Só no servidor: nunca vai para a extensão, para log ou para o banco. */
    chave: string;
    /** Tempo limite das consultas comuns (ms). As cargas do cadastro inteiro usam um teto maior. */
    tempoLimite: number;
  };
  /** Chave da extensão do atendente e chave da extensão de admin (cada uma na sua instalação). */
  chaveAtendimento: string;
  chaveAdmin: string;
  /** null = leitura de receita desligada (a extensão mostra o aviso). */
  openai: { chave: string; modelo: string } | null;
  /** Token da URL do webhook que a automação da Kentro chama quando chega uma receita. null = desligado. */
  tokenWebhookKentro: string | null;
  /** Agenda de sincronização do cadastro neste processo. SINCRONIZACAO=desligada para desligar. */
  sincronizacaoAutomatica: boolean;
}

const OBRIGATORIAS = ['DATABASE_URL', 'URL_PUBLICA', 'CONCENTRA_API_URL', 'CONCENTRA_API_KEY', 'CHAVE_ATENDIMENTO', 'CHAVE_ADMIN'] as const;

export function lerConfig(env: NodeJS.ProcessEnv): ConfigApp {
  const ausentes = OBRIGATORIAS.filter((nome) => !env[nome]?.trim());
  if (ausentes.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${ausentes.join(', ')}.`);
  }
  const chaveAtendimento = env.CHAVE_ATENDIMENTO!.trim();
  const chaveAdmin = env.CHAVE_ADMIN!.trim();
  if (chaveAtendimento.length < 24 || chaveAdmin.length < 24) {
    throw new Error('CHAVE_ATENDIMENTO e CHAVE_ADMIN precisam ter pelo menos 24 caracteres (gere com: openssl rand -base64 32).');
  }
  if (chaveAtendimento === chaveAdmin) {
    throw new Error('CHAVE_ATENDIMENTO e CHAVE_ADMIN precisam ser diferentes: a de atendimento chega ao navegador de todos os atendentes.');
  }

  const openaiChave = env.OPENAI_API_KEY?.trim();
  // No build, este arquivo fica em dist/comum; extensao/ fica em dist/.
  const dist = path.join(__dirname, '..');
  return {
    // PORT é a "porta interna" que a VPS injeta; PORTA fica para uso local.
    porta: Number(env.PORTA || env.PORT || 3000),
    databaseUrl: env.DATABASE_URL!.trim(),
    urlPublica: env.URL_PUBLICA!.trim().replace(/\/+$/, ''),
    dirExtensao: env.DIR_EXTENSAO || path.join(dist, 'extensao'),
    concentra: {
      url: env.CONCENTRA_API_URL!.trim(),
      chave: env.CONCENTRA_API_KEY!.trim(),
      tempoLimite: Number(env.CONCENTRA_TEMPO_LIMITE_MS || 20_000),
    },
    chaveAtendimento,
    chaveAdmin,
    openai: openaiChave ? { chave: openaiChave, modelo: env.OPENAI_MODELO?.trim() || 'gpt-5.5' } : null,
    tokenWebhookKentro: env.TOKEN_WEBHOOK_KENTRO?.trim() || null,
    sincronizacaoAutomatica: env.SINCRONIZACAO?.trim().toLowerCase() !== 'desligada',
  };
}
