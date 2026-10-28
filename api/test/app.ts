import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule, OpcoesApp } from '../src/app.module';
import { ConfigApp } from '../src/comum/config';
import { configurarApp } from '../src/comum/configurar-app';

export const CHAVE_ATENDIMENTO = 'atendimento-de-teste-0123456789abcdef';
export const CHAVE_ADMIN = 'admin-de-teste-0123456789abcdef-xyz';
export const URL_CONCENTRA = 'http://concentra.teste/apiconc';

export function configDeTeste(sobrescrever: Partial<ConfigApp> = {}): ConfigApp {
  return {
    porta: 0,
    databaseUrl: process.env.DATABASE_URL ?? '',
    urlPublica: 'https://concentra.kentro.teste',
    dirExtensao: path.join(__dirname, '..', '..', 'extension'),
    concentra: { url: URL_CONCENTRA, chave: 'chave-concentra-teste', tempoLimite: 2000 },
    chaveAtendimento: CHAVE_ATENDIMENTO,
    chaveAdmin: CHAVE_ADMIN,
    openai: { chave: 'sk-teste', modelo: 'modelo-teste' },
    tokenWebhookKentro: 'token-webhook-teste',
    sincronizacaoAutomatica: false,
    ...sobrescrever,
  };
}

export async function criarAppDeTeste(sobrescrever: Partial<ConfigApp> = {}, opcoes: OpcoesApp = {}): Promise<INestApplication> {
  const config = configDeTeste(sobrescrever);
  const modulo = await Test.createTestingModule({ imports: [AppModule.com(config, { esperar: async () => {}, ...opcoes })] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configurarApp(app);
  await app.init();
  return app;
}

/** A auditoria grava em segundo plano: um INSERT do teste anterior pode disputar a trava com o TRUNCATE. */
export async function limparBanco(prisma: PrismaClient): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      await prisma.$executeRawUnsafe(
        'TRUNCATE produtos, prescritores, clientes, rascunhos, orcamentos_enviados, eventos, configuracoes, sincronizacoes',
      );
      return;
    } catch (erro) {
      if (tentativa >= 5) throw erro;
      await new Promise((r) => setTimeout(r, 100 * tentativa));
    }
  }
}

export interface ChamadaFalsa {
  url: string;
  corpo: Record<string, unknown>;
}

/**
 * fetch falso: `concentra` responde as chamadas à apiconc pela `funcao`; `openai` responde a leitura.
 * Uma resposta `'cair'` simula a farmácia sem internet (o fetch rejeita).
 */
export function fetchFalso(rotas: {
  concentra?: (funcao: string, corpo: Record<string, unknown>) => unknown;
  openai?: (corpo: Record<string, unknown>) => unknown;
  arquivo?: () => { status: number; corpo: Buffer; tipo?: string };
}) {
  const chamadas: ChamadaFalsa[] = [];
  const fn = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const corpo = init?.body ? JSON.parse(String(init.body)) : {};
    chamadas.push({ url, corpo });
    if (url === URL_CONCENTRA) {
      const r = rotas.concentra?.(corpo.funcao, corpo);
      if (r === 'cair') throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
      return new Response(JSON.stringify(r ?? [{ erro: 'Nenhum registro encontrado' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.openai.com/')) {
      return new Response(JSON.stringify(rotas.openai?.(corpo) ?? {}), { status: 200 });
    }
    const a = rotas.arquivo?.();
    if (a) return new Response(new Uint8Array(a.corpo), { status: a.status, headers: { 'Content-Type': a.tipo ?? 'image/jpeg' } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetch: fn, chamadas };
}
