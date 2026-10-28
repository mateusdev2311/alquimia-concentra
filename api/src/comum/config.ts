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
  /** REDEFINIR_CHAVES=sim apaga as chaves na subida (para reativar se a chave de admin se perder). */
  redefinirChaves: boolean;
  /** Agenda de sincronização do cadastro neste processo. SINCRONIZACAO=desligada para desligar. */
  sincronizacaoAutomatica: boolean;
}

const OBRIGATORIAS = ['DATABASE_URL', 'URL_PUBLICA', 'CONCENTRA_API_URL', 'CONCENTRA_API_KEY'] as const;

export function lerConfig(env: NodeJS.ProcessEnv): ConfigApp {
  const ausentes = OBRIGATORIAS.filter((nome) => !env[nome]?.trim());
  if (ausentes.length > 0) {
    throw new Error(`Variáveis de ambiente obrigatórias ausentes: ${ausentes.join(', ')}.`);
  }
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
    redefinirChaves: env.REDEFINIR_CHAVES?.trim().toLowerCase() === 'sim',
    sincronizacaoAutomatica: env.SINCRONIZACAO?.trim().toLowerCase() !== 'desligada',
  };
}
