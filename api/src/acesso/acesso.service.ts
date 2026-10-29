import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { compararSeguro } from '../comum/cripto';
import { PrismaService } from '../comum/prisma.service';

/** As chaves só existem como hash; o token da automação fica legível porque o admin precisa copiá-lo depois. */
interface Acesso {
  adminHash: string;
  atendimentoHash: string;
  tokenAutomacao: string;
  ativadoEm: string;
}

const CHAVE_CONFIG = 'acesso';

export type Papel = 'atendimento' | 'admin';

export interface ChavesNovas {
  chaveAdmin: string;
  chaveAtendimento: string;
}

const hash = (segredo: string) => createHash('sha256').update(segredo.trim()).digest('hex');
const gerar = (prefixo: string) => prefixo + randomBytes(32).toString('base64url');

/**
 * Chaves da integração, geradas na ativação pela extensão de admin (não há chave para cadastrar no Doca).
 * A ativação só funciona uma vez: depois, só quem tem a chave de admin troca as chaves.
 * REDEFINIR_CHAVES=sim no Doca apaga as chaves na subida (para reativar se a chave de admin se perder).
 */
@Injectable()
export class AcessoService implements OnModuleInit {
  private readonly logger = new Logger('Acesso');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.redefinirChaves) {
      await this.prisma.configuracao.deleteMany({ where: { chave: CHAVE_CONFIG } });
      this.logger.warn('REDEFINIR_CHAVES: chaves apagadas. Ative de novo pela extensão de admin e depois tire a variável do Doca.');
    } else if (process.env.REDEFINIR_CHAVES) {
      this.logger.warn(`REDEFINIR_CHAVES está definida mas com valor não reconhecido; use "sim". Nada foi apagado.`);
    }
  }

  /** Sem cache: uma linha pela chave primária, e a troca de chave vale na hora (inclusive com dois processos). */
  private async ler(): Promise<Acesso | null> {
    const linha = await this.prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } });
    return (linha?.valor as unknown as Acesso) ?? null;
  }

  private async gravar(acesso: Acesso): Promise<void> {
    const valor = acesso as unknown as Prisma.InputJsonValue;
    await this.prisma.configuracao.upsert({ where: { chave: CHAVE_CONFIG }, create: { chave: CHAVE_CONFIG, valor }, update: { valor } });
  }

  async ativada(): Promise<boolean> {
    return (await this.ler()) != null;
  }

  /** Primeira ativação: gera as duas chaves e o token da automação. Devolve null se já estava ativada. */
  async ativar(): Promise<ChavesNovas | null> {
    if (await this.ativada()) return null;
    const chaveAdmin = gerar('aca_');
    const chaveAtendimento = gerar('acc_');
    const valor = {
      adminHash: hash(chaveAdmin),
      atendimentoHash: hash(chaveAtendimento),
      tokenAutomacao: randomBytes(24).toString('hex'),
      ativadoEm: new Date().toISOString(),
    };
    // createMany com skipDuplicates: duas ativações ao mesmo tempo, só uma vence.
    const { count } = await this.prisma.configuracao.createMany({
      data: [{ chave: CHAVE_CONFIG, valor: valor as unknown as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (count !== 1) return null;
    this.logger.log('Integração ativada.');
    return { chaveAdmin, chaveAtendimento };
  }

  async papelDa(chave: string): Promise<Papel | null> {
    const acesso = await this.ler();
    if (!acesso || !chave) return null;
    const h = hash(chave);
    if (compararSeguro(h, acesso.adminHash)) return 'admin';
    if (compararSeguro(h, acesso.atendimentoHash)) return 'atendimento';
    return null;
  }

  async trocarChaveAtendimento(): Promise<string> {
    const acesso = await this.ler();
    if (!acesso) throw new Error('Integração não ativada.');
    const chave = gerar('acc_');
    await this.gravar({ ...acesso, atendimentoHash: hash(chave) });
    return chave;
  }

  async tokenAutomacao(): Promise<string | null> {
    return (await this.ler())?.tokenAutomacao ?? null;
  }

  async trocarTokenAutomacao(): Promise<string> {
    const acesso = await this.ler();
    if (!acesso) throw new Error('Integração não ativada.');
    const tokenAutomacao = randomBytes(24).toString('hex');
    await this.gravar({ ...acesso, tokenAutomacao });
    return tokenAutomacao;
  }

  async tokenAutomacaoValido(token: string): Promise<boolean> {
    const atual = await this.tokenAutomacao();
    return atual != null && compararSeguro(token, atual);
  }
}
