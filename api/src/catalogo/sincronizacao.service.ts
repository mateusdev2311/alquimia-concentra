import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { PrismaService } from '../comum/prisma.service';
import { dataBr } from '../comum/texto';
import { ConcentraClient, FalhaConcentra, comoLista } from '../concentra/concentra.client';
import { cliente, ClienteConcentra, prescritor, produtoCadastro } from '../concentra/formatos';
import { CatalogoService } from './catalogo.service';

export type Recurso = 'produtos' | 'prescritores' | 'clientes';
export const RECURSOS: Recurso[] = ['produtos', 'prescritores', 'clientes'];

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
/** Incremental: as alterações desde ontem (a Concentra recusa a data de hoje). */
const INTERVALO_INCREMENTAL = 30 * MINUTO;
/** Carga total: refaz o espelho inteiro (pega exclusões, que o incremental não vê). */
const INTERVALO_TOTAL: Record<Recurso, number> = { produtos: 20 * HORA, prescritores: 20 * HORA, clientes: 7 * 24 * HORA };
/** A carga total de clientes vai até 2 anos atrás de última compra (≈ 13 mil clientes). */
const MESES_CLIENTES = 24;
const LOTE = 1000;
/** Uma sincronização travada (processo morto no meio) libera depois disto. */
const TRAVA = 15 * MINUTO;
/** Teto para as cargas totais (≈ 10 MB de resposta). */
const TEMPO_LIMITE_CARGA = 180_000;

@Injectable()
export class SincronizacaoService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Sincronizacao');
  private relogio: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    private readonly prisma: PrismaService,
    private readonly concentra: ConcentraClient,
    private readonly catalogo: CatalogoService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.sincronizacaoAutomatica) return;
    // Primeira volta logo depois de subir; depois a cada 5 minutos decide o que está vencido.
    setTimeout(() => void this.ciclo(), 5_000).unref();
    this.relogio = setInterval(() => void this.ciclo(), 5 * MINUTO);
    this.relogio.unref();
  }

  onModuleDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
  }

  async ciclo(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    try {
      for (const recurso of RECURSOS) {
        const estado = await this.prisma.sincronizacao.findUnique({ where: { recurso } });
        const agora = Date.now();
        const total = !estado?.ultimaCargaTotal || agora - estado.ultimaCargaTotal.getTime() > INTERVALO_TOTAL[recurso];
        const incremental = !estado?.ultimoSucesso || agora - estado.ultimoSucesso.getTime() > INTERVALO_INCREMENTAL;
        if (total || incremental) await this.sincronizar(recurso, total ? 'total' : 'incremental').catch(() => {});
      }
      await this.verificarConexao();
      await this.limpar();
    } finally {
      this.rodando = false;
    }
  }

  /** Sincroniza um recurso agora (também usado pelo botão do admin). Devolve quantos registros vieram. */
  async sincronizar(recurso: Recurso, modo: 'total' | 'incremental'): Promise<number> {
    if (!(await this.travar(recurso))) throw new Error('Esta sincronização já está em andamento.');
    const inicio = Date.now();
    try {
      const n =
        recurso === 'produtos' ? await this.produtos(modo) : recurso === 'prescritores' ? await this.prescritores(modo) : await this.clientes(modo);
      const total = await this.contar(recurso);
      await this.prisma.sincronizacao.update({
        where: { recurso },
        data: {
          ultimoSucesso: new Date(),
          ...(modo === 'total' ? { ultimaCargaTotal: new Date() } : {}),
          registros: total,
          ultimoErro: null,
          emExecucaoAte: null,
        },
      });
      this.logger.log(`${recurso} (${modo}): ${n} recebidos, ${total} no espelho (${Date.now() - inicio} ms)`);
      return n;
    } catch (erro) {
      const mensagem =
        erro instanceof FalhaConcentra ? `${erro.mensagem}${erro.detalhe ? ` Motivo: ${erro.detalhe}.` : ''}` : erro instanceof Error ? erro.message : String(erro);
      await this.prisma.sincronizacao.update({ where: { recurso }, data: { ultimoErro: mensagem.slice(0, 500), emExecucaoAte: null } });
      this.logger.warn(`${recurso} (${modo}) falhou: ${mensagem}`);
      throw erro;
    }
  }

  private async travar(recurso: Recurso): Promise<boolean> {
    const agora = new Date();
    await this.prisma.sincronizacao.upsert({ where: { recurso }, create: { recurso }, update: {} });
    const { count } = await this.prisma.sincronizacao.updateMany({
      where: { recurso, OR: [{ emExecucaoAte: null }, { emExecucaoAte: { lt: agora } }] },
      data: { emExecucaoAte: new Date(agora.getTime() + TRAVA), ultimaTentativa: agora },
    });
    return count === 1;
  }

  private contar(recurso: Recurso): Promise<number> {
    if (recurso === 'produtos') return this.prisma.produto.count();
    if (recurso === 'prescritores') return this.prisma.prescritor.count();
    return this.prisma.cliente.count();
  }

  private ontem(): string {
    return dataBr(new Date(Date.now() - 24 * HORA));
  }

  private async produtos(modo: 'total' | 'incremental'): Promise<number> {
    const parametros = modo === 'total' ? { dt_inclusao: 'TOTAL' } : { dt_alteracao: this.ontem() };
    const corpo = await this.concentra.chamar('listar_info_produtos_por_data', parametros, { tempoLimite: TEMPO_LIMITE_CARGA });
    const produtos = comoLista<Record<string, unknown>>(corpo)
      .map(produtoCadastro)
      .filter((p): p is NonNullable<typeof p> => p != null);
    // Uma carga total vazia seria um erro da API, não um cadastro vazio: não apaga o espelho.
    if (modo === 'total' && produtos.length === 0) throw new Error('A carga total de produtos veio vazia.');
    await this.gravar(
      modo,
      produtos,
      (lote) => this.prisma.produto.createMany({ data: lote }),
      (codigos) => this.prisma.produto.deleteMany(codigos ? { where: { codigo: { in: codigos } } } : undefined),
      (p) => p.codigo,
    );
    await this.catalogo.recarregar();
    return produtos.length;
  }

  private async prescritores(modo: 'total' | 'incremental'): Promise<number> {
    const parametros = modo === 'total' ? { dt_inclusao: 'TOTAL' } : { dt_alteracao: this.ontem() };
    const corpo = await this.concentra.chamar('listar_info_prescritores_por_data', parametros, { tempoLimite: TEMPO_LIMITE_CARGA });
    const vistos = new Map<string, NonNullable<ReturnType<typeof prescritor>>>();
    for (const r of comoLista<Record<string, unknown>>(corpo)) {
      const p = prescritor(r);
      if (p) vistos.set(p.chave, p);
    }
    const lista = [...vistos.values()];
    if (modo === 'total' && lista.length === 0) throw new Error('A carga total de prescritores veio vazia.');
    await this.gravar(
      modo,
      lista,
      (lote) => this.prisma.prescritor.createMany({ data: lote }),
      (chaves) => this.prisma.prescritor.deleteMany(chaves ? { where: { chave: { in: chaves } } } : undefined),
      (p) => p.chave,
    );
    return lista.length;
  }

  private async clientes(modo: 'total' | 'incremental'): Promise<number> {
    const desde = new Date();
    if (modo === 'total') desde.setMonth(desde.getMonth() - MESES_CLIENTES);
    else desde.setTime(desde.getTime() - 24 * HORA);
    const corpo = await this.concentra.chamar('listar_info_clientes_por_ultima_compra', { dt_ult_co: dataBr(desde) }, { tempoLimite: TEMPO_LIMITE_CARGA });
    const lista = comoLista<Record<string, unknown>>(corpo)
      .map(cliente)
      .filter((c): c is ClienteConcentra => c != null);
    // Clientes nunca são apagados na carga: quem comprou há mais de 2 anos continua achável pelo telefone.
    await this.gravarClientes(lista);
    return lista.length;
  }

  /** Clientes vindos da busca por nome também entram no índice (fica achável pelo telefone depois). */
  async gravarClientes(lista: ClienteConcentra[]): Promise<void> {
    const unicos = [...new Map(lista.map((c) => [c.id, c])).values()];
    for (let i = 0; i < unicos.length; i += LOTE) {
      const lote = unicos.slice(i, i + LOTE);
      await this.prisma.$transaction([
        this.prisma.cliente.deleteMany({ where: { id: { in: lote.map((c) => c.id) } } }),
        this.prisma.cliente.createMany({
          data: lote.map((c) => ({
            id: c.id,
            nome: c.nome,
            chavesTelefone: c.chavesTelefone,
            telefones: c.telefones,
            cpf: c.cpf,
            email: c.email,
            endereco: c.endereco as Prisma.InputJsonValue,
            nascimento: c.nascimento,
            sexo: c.sexo,
            ultimaCompra: c.ultimaCompra,
          })),
        }),
      ]);
    }
  }

  /** Total: troca o espelho inteiro numa transação. Incremental: troca só os registros que vieram. */
  private async gravar<T>(
    modo: 'total' | 'incremental',
    lista: T[],
    criar: (lote: T[]) => Prisma.PrismaPromise<unknown>,
    apagar: (chaves: string[] | null) => Prisma.PrismaPromise<unknown>,
    chave: (item: T) => string,
  ): Promise<void> {
    if (modo === 'total') {
      const operacoes: Prisma.PrismaPromise<unknown>[] = [apagar(null)];
      for (let i = 0; i < lista.length; i += LOTE) operacoes.push(criar(lista.slice(i, i + LOTE)));
      await this.prisma.$transaction(operacoes);
      return;
    }
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      await this.prisma.$transaction([apagar(lote.map(chave)), criar(lote)]);
    }
  }

  /** Sem nenhuma resposta da Concentra nos últimos 5 minutos, uma consulta leve mostra se ela está no ar. */
  private async verificarConexao(): Promise<void> {
    const ultima = this.concentra.estado.ultimoSucesso?.getTime() ?? 0;
    if (Date.now() - ultima < 5 * MINUTO) return;
    await this.concentra.chamar('listar_produtos_por_descricao', { produto: 'CAPSULA' }, { tempoLimite: 15_000 }).catch(() => {});
  }

  /** Retenção (LGPD): auditoria 12 meses, rascunhos 30 dias. */
  private async limpar(): Promise<void> {
    const dia = 24 * HORA;
    await this.prisma.evento.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - 365 * dia) } } });
    await this.prisma.rascunho.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - 30 * dia) } } });
  }
}
