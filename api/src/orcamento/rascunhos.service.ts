import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OrigemRascunho, Prisma, Rascunho } from '@prisma/client';
import { AuditoriaService } from '../acesso/auditoria.service';
import { Usuario } from '../acesso/chave.guard';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ErroApi } from '../comum/erros';
import { Fetch, FETCH } from '../comum/fetch';
import { PrismaService } from '../comum/prisma.service';
import { digitos, normalizar } from '../comum/texto';
import { ConcentraClient, FalhaConcentra, comoLista } from '../concentra/concentra.client';
import { numeroConselho, valorMonetario } from '../concentra/formatos';
import { OrcamentosService } from '../consultas/orcamentos.service';
import { Casamento } from '../ia/casamento';
import { Arquivo, ReceitaLida } from '../ia/leitura';
import { OpenAiClient } from '../ia/openai.client';
import { ConfiguracoesService } from './configuracoes.service';
import { renderizar, valoresDaMensagem } from './mensagem';
import { contarCorrigidos, corpoGerarOrcamento, DadosOrcamento, ResultadoEnvio, validar } from './modelo';

export interface ArquivoEntrada {
  /** URL temporária do arquivo (omni.chats.getFile ou variável da automação). */
  url?: string;
  /** Ou o próprio arquivo, quando a URL não é acessível pelo servidor. */
  base64?: string;
  mimetype?: string;
  nome?: string;
  /** Referência do arquivo na Kentro (fileRef), para não ler a mesma receita duas vezes. */
  referencia?: string;
}

export interface Inicio {
  chatId: string;
  contatoId?: string | null;
  clienteId?: string | null;
  /** Telefone do contato no atendimento (WhatsApp). */
  telefone?: string | null;
  nomeContato?: string | null;
}

const TIPOS_ACEITOS = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/;
const TAMANHO_MAXIMO = 20 * 1024 * 1024;

/** Rascunho como a extensão recebe. */
export function vistaDoRascunho(r: Rascunho) {
  return {
    id: r.id,
    chatId: r.chatId,
    status: r.status,
    origem: r.origem,
    arquivo: r.arquivo,
    dados: r.dados as unknown as DadosOrcamento,
    leitura: r.leitura,
    erro: r.erro,
    criadoEm: r.criadoEm.toISOString(),
    atualizadoEm: r.atualizadoEm.toISOString(),
  };
}

@Injectable()
export class RascunhosService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Rascunhos');
  private readonly casamento: Casamento;
  /** Envios em andamento neste processo: dois cliques não geram dois orçamentos. */
  private readonly enviando = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly concentra: ConcentraClient,
    private readonly orcamentos: OrcamentosService,
    private readonly configuracoes: ConfiguracoesService,
    private readonly openai: OpenAiClient,
    private readonly auditoria: AuditoriaService,
    @Inject(FETCH) private readonly fetch: Fetch,
    catalogo: CatalogoService,
  ) {
    this.casamento = new Casamento(catalogo, configuracoes);
  }

  /** Leitura interrompida por um reinício do processo não termina sozinha. */
  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.rascunho.updateMany({
      where: { status: 'lendo', atualizadoEm: { lt: new Date(Date.now() - 5 * 60_000) } },
      data: { status: 'erro', erro: 'A leitura foi interrompida. Tente ler a receita de novo.' },
    });
  }

  async obter(id: string): Promise<Rascunho> {
    const r = await this.prisma.rascunho.findUnique({ where: { id } }).catch(() => null);
    if (!r) throw new ErroApi(404, 'RASCUNHO_NAO_ENCONTRADO', 'Orçamento em montagem não encontrado (rascunhos somem depois de 30 dias).');
    return r;
  }

  /** Dados iniciais: o cliente identificado no atendimento manda no nome; o telefone é o do WhatsApp. */
  private async base(inicio: Inicio): Promise<DadosOrcamento> {
    const cliente = inicio.clienteId ? await this.prisma.cliente.findUnique({ where: { id: inicio.clienteId } }) : null;
    const fone = digitos(inicio.telefone).replace(/^55(?=\d{10,11}$)/, '') || cliente?.telefones[0] || '';
    return {
      clienteId: cliente?.id ?? null,
      paciente: cliente?.nome ?? normalizar(inicio.nomeContato),
      fone,
      prescritor: '',
      crm: '',
      formulas: [],
    };
  }

  async criarManual(usuario: Usuario, inicio: Inicio): Promise<Rascunho> {
    const r = await this.prisma.rascunho.create({
      data: {
        chatId: inicio.chatId,
        contatoId: inicio.contatoId ?? null,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        origem: 'manual',
        status: 'pronto',
        dados: (await this.base(inicio)) as unknown as Prisma.InputJsonValue,
      },
    });
    this.auditoria.registrar(usuario, 'orcamento.iniciar', r.id, { origem: 'manual', chatId: inicio.chatId });
    return r;
  }

  /** Cria o rascunho em "lendo" e lê em segundo plano: a extensão acompanha pelo status. */
  async iniciarLeitura(usuario: Usuario, inicio: Inicio, arquivo: ArquivoEntrada, origem: OrigemRascunho): Promise<Rascunho> {
    if (!this.openai.ligada) throw new ErroApi(503, 'IA_DESLIGADA', 'A leitura de receita está desligada (falta OPENAI_API_KEY no Doca).');
    if (!arquivo.url && !arquivo.base64) throw new ErroApi(400, 'SEM_ARQUIVO', 'Envie a foto ou o PDF da receita.');
    if (arquivo.referencia) {
      const ja = await this.prisma.rascunho.findFirst({
        where: { chatId: inicio.chatId, status: { in: ['lendo', 'pronto'] }, arquivo: { path: ['referencia'], equals: arquivo.referencia } },
      });
      if (ja) return ja;
    }
    // Baixa antes de criar: se a URL não abre no servidor, a extensão manda o próprio arquivo (ARQUIVO_INACESSIVEL).
    const baixado = await this.baixar(arquivo);
    const r = await this.prisma.rascunho.create({
      data: {
        chatId: inicio.chatId,
        contatoId: inicio.contatoId ?? null,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        origem,
        status: 'lendo',
        arquivo: { nome: arquivo.nome ?? null, mimetype: arquivo.mimetype ?? null, referencia: arquivo.referencia ?? null },
        dados: (await this.base(inicio)) as unknown as Prisma.InputJsonValue,
      },
    });
    this.auditoria.registrar(usuario, 'receita.ler', r.id, { origem, chatId: inicio.chatId });
    void this.processar(r.id, baixado);
    return r;
  }

  private async baixar(entrada: ArquivoEntrada): Promise<Arquivo> {
    if (entrada.base64) {
      const base64 = entrada.base64.replace(/^data:[^,]*,/, '');
      const mimetype = (entrada.mimetype ?? 'image/jpeg').toLowerCase();
      if (!TIPOS_ACEITOS.test(mimetype)) throw new ErroApi(415, 'TIPO_NAO_ACEITO', 'Envie a receita como foto (JPG/PNG) ou PDF.');
      return { base64, mimetype, nome: entrada.nome ?? 'receita' };
    }
    let resposta: Response;
    try {
      resposta = await this.fetch(entrada.url!, { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new ErroApi(422, 'ARQUIVO_INACESSIVEL', 'Não consegui baixar o arquivo da receita.');
    }
    if (!resposta.ok) throw new ErroApi(422, 'ARQUIVO_INACESSIVEL', `Não consegui baixar o arquivo da receita (HTTP ${resposta.status}).`);
    const corpo = Buffer.from(await resposta.arrayBuffer());
    if (corpo.length > TAMANHO_MAXIMO) throw new ErroApi(413, 'ARQUIVO_GRANDE', 'O arquivo da receita passa de 20 MB.');
    const doCabecalho = resposta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const mimetype = (entrada.mimetype || doCabecalho || 'image/jpeg').toLowerCase();
    if (!TIPOS_ACEITOS.test(mimetype)) throw new ErroApi(415, 'TIPO_NAO_ACEITO', 'Envie a receita como foto (JPG/PNG) ou PDF.');
    return { base64: corpo.toString('base64'), mimetype, nome: entrada.nome ?? 'receita' };
  }

  private async processar(id: string, arquivo: Arquivo): Promise<void> {
    const inicio = Date.now();
    try {
      const lida = await this.openai.lerReceita(arquivo);
      const r = await this.obter(id);
      const dados = await this.montar(r.dados as unknown as DadosOrcamento, lida);
      await this.prisma.rascunho.update({
        where: { id },
        data: {
          status: 'pronto',
          leitura: lida as unknown as Prisma.InputJsonValue,
          dados: dados as unknown as Prisma.InputJsonValue,
          segundosLeitura: (Date.now() - inicio) / 1000,
          erro: !lida.eh_receita ? 'A IA achou que este arquivo não é uma receita. Confira.' : !lida.legivel ? 'Receita com partes ilegíveis: confira cada item.' : null,
        },
      });
    } catch (erro) {
      const mensagem = erro instanceof ErroApi ? erro.mensagem : 'Não foi possível ler a receita. Tente de novo.';
      if (!(erro instanceof ErroApi)) this.logger.error(erro instanceof Error ? erro.stack ?? erro.message : String(erro));
      await this.prisma.rascunho.update({ where: { id }, data: { status: 'erro', erro: mensagem, segundosLeitura: (Date.now() - inicio) / 1000 } }).catch(() => {});
    }
  }

  private async montar(base: DadosOrcamento, lida: ReceitaLida): Promise<DadosOrcamento> {
    const formulas = [];
    for (const item of lida.itens ?? []) formulas.push(await this.casamento.formula(item));

    let prescritor = lida.prescritor ? normalizar(lida.prescritor) : '';
    let crm = numeroConselho(lida.numero_conselho);
    const observacoes: string[] = [];
    if (crm) {
      const achados = await this.prisma.prescritor.findMany({ where: { numero: crm }, take: 5 });
      const uf = lida.uf_conselho?.trim().toUpperCase();
      const certo = achados.find((p) => !uf || p.uf === uf) ?? achados[0];
      if (certo) prescritor = certo.nome;
      else observacoes.push('Prescritor não cadastrado no Concentra: confira nome e CRM.');
    } else if (prescritor) {
      observacoes.push('CRM não lido: confira.');
    }

    const pacienteLido = lida.paciente ? normalizar(lida.paciente) : null;
    const dados: DadosOrcamento = {
      ...base,
      // Sem cliente identificado, o nome da receita é o melhor palpite.
      paciente: base.clienteId ? base.paciente : pacienteLido || base.paciente,
      pacienteLido: pacienteLido && pacienteLido !== normalizar(base.paciente) ? pacienteLido : null,
      prescritor,
      crm,
      prescritorLido: lida.prescritor,
      crmLido: lida.numero_conselho,
      controleEspecial: lida.controle_especial || formulas.some((f) => f.componentes.some((c) => c.controlado)),
      observacoes: [lida.observacoes, ...observacoes].filter(Boolean).join(' ') || null,
      formulas,
    };
    return dados;
  }

  async atualizar(id: string, usuario: Usuario, dados: DadosOrcamento): Promise<Rascunho> {
    const r = await this.obter(id);
    if (r.status === 'enviado' || r.status === 'descartado' || r.status === 'lendo') {
      throw new ErroApi(409, 'RASCUNHO_FECHADO', r.status === 'lendo' ? 'Espere a leitura da receita terminar.' : 'Este orçamento já foi enviado ou descartado.');
    }
    const atual = r.dados as unknown as DadosOrcamento;
    // O que não é do atendente (resultado, envio incerto) não pode ser sobrescrito pela tela.
    const novo: DadosOrcamento = { ...dados, envioIncerto: atual.envioIncerto, resultado: atual.resultado ?? null };
    novo.formulas = (novo.formulas ?? []).map((f) => ({ ...f, id: f.id || randomUUID(), componentes: (f.componentes ?? []).map((c) => ({ ...c, id: c.id || randomUUID() })) }));
    return this.prisma.rascunho.update({
      where: { id },
      data: { dados: novo as unknown as Prisma.InputJsonValue, status: 'pronto', usuarioId: usuario.id ?? r.usuarioId, usuarioNome: usuario.nome ?? r.usuarioNome },
    });
  }

  async descartar(id: string, usuario: Usuario): Promise<Rascunho> {
    const r = await this.obter(id);
    if (r.status === 'enviado') throw new ErroApi(409, 'RASCUNHO_FECHADO', 'Este orçamento já foi enviado ao Concentra.');
    this.auditoria.registrar(usuario, 'orcamento.descartar', id);
    return this.prisma.rascunho.update({ where: { id }, data: { status: 'descartado' } });
  }

  /**
   * Grava no ERP (gerar_orcamento): nunca é repetido automaticamente. Se a resposta não chega,
   * o rascunho fica marcado como "envio incerto" e só sai de novo com `forcar`.
   */
  async enviar(id: string, usuario: Usuario, forcar: boolean): Promise<{ rascunho: Rascunho; resultado: ResultadoEnvio }> {
    if (this.enviando.has(id)) throw new ErroApi(409, 'ENVIO_EM_ANDAMENTO', 'Este orçamento já está sendo enviado. Aguarde.');
    this.enviando.add(id);
    try {
      const r = await this.obter(id);
      if (r.status === 'enviado') throw new ErroApi(409, 'JA_ENVIADO', 'Este orçamento já foi enviado ao Concentra.');
      if (r.status === 'lendo' || r.status === 'descartado') throw new ErroApi(409, 'RASCUNHO_FECHADO', 'Este orçamento não pode ser enviado agora.');
      const dados = r.dados as unknown as DadosOrcamento;
      if (dados.envioIncerto && !forcar) {
        throw new ErroApi(
          409,
          'ENVIO_INCERTO',
          'O envio anterior não teve resposta e pode ter sido gravado. Confira no Concentra antes de enviar de novo (isso pode duplicar o orçamento).',
        );
      }
      const erros = validar(dados);
      if (erros.length) throw new ErroApi(422, 'ORCAMENTO_INCOMPLETO', erros[0], { erros });

      const corpo = corpoGerarOrcamento(dados);
      let resposta: unknown;
      try {
        resposta = await this.concentra.chamar('gerar_orcamento', corpo, { tempoLimite: 90_000 });
      } catch (erro) {
        if (erro instanceof FalhaConcentra && erro.tipo === 'indisponivel') {
          // Pode ter gravado: não arrisca duplicar num clique seguinte.
          await this.prisma.rascunho.update({ where: { id }, data: { dados: { ...dados, envioIncerto: true } as unknown as Prisma.InputJsonValue } });
          this.auditoria.registrar(usuario, 'orcamento.envio_incerto', id);
          throw new ErroApi(
            503,
            'ENVIO_INCERTO',
            'A Concentra não respondeu. O orçamento PODE ter sido gravado: confira no Concentra antes de tentar de novo.',
          );
        }
        throw erro;
      }

      const registro = comoLista<Record<string, unknown>>(resposta)[0] ?? {};
      const valorLiquido = valorMonetario(registro.valor_liquido);
      const valorBruto = valorMonetario(registro.valor_bruto);
      const numero = (await this.procurarNumero(dados.paciente, valorLiquido, valorBruto)) ?? (registro.numero ? String(registro.numero) : null);

      const { modeloMensagem } = await this.configuracoes.ler();
      const mensagem = renderizar(modeloMensagem, valoresDaMensagem({ dados, numero, valorLiquido, valorBruto, atendente: usuario.nome }));
      const resultado: ResultadoEnvio = { numero, valorLiquido, valorBruto, enviadoEm: new Date().toISOString(), mensagem };

      const atualizado = await this.prisma.rascunho.update({
        where: { id },
        data: {
          status: 'enviado',
          usuarioId: usuario.id ?? r.usuarioId,
          usuarioNome: usuario.nome ?? r.usuarioNome,
          dados: { ...dados, envioIncerto: false, resultado } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.prisma.orcamentoEnviado.create({
        data: {
          rascunhoId: id,
          numero,
          usuarioId: usuario.id ?? r.usuarioId,
          usuarioNome: usuario.nome ?? r.usuarioNome,
          origem: r.origem,
          formulas: dados.formulas.length,
          componentes: dados.formulas.reduce((n, f) => n + f.componentes.length, 0),
          corrigidos: contarCorrigidos(dados),
          valorLiquido,
          valorBruto,
          segundosMontagem: (Date.now() - r.criadoEm.getTime()) / 1000,
        },
      });
      this.auditoria.registrar(usuario, 'orcamento.enviar', numero ?? id, { rascunho: id, origem: r.origem, valorLiquido });
      return { rascunho: atualizado, resultado };
    } finally {
      this.enviando.delete(id);
    }
  }

  /** O gerar_orcamento não devolve o número: procura o orçamento mais novo do paciente com o mesmo valor. */
  private async procurarNumero(paciente: string, valorLiquido: number | null, valorBruto: number | null): Promise<string | null> {
    try {
      const alvo = normalizar(paciente);
      const recentes = await this.orcamentos.recentes(true);
      const doPaciente = recentes.filter((o) => normalizar(o.cliente) === alvo);
      const mesmoValor = doPaciente.filter(
        (o) => o.valor != null && [valorLiquido, valorBruto].some((v) => v != null && Math.abs(o.valor! - v) < 0.011),
      );
      return (mesmoValor[0] ?? doPaciente[0])?.numero ?? null;
    } catch {
      return null;
    }
  }

  /** Mensagem de novo (o atendente pode reenviar o resumo no chat). */
  async mensagem(id: string): Promise<string> {
    const r = await this.obter(id);
    const dados = r.dados as unknown as DadosOrcamento;
    const { modeloMensagem } = await this.configuracoes.ler();
    const res = dados.resultado;
    return renderizar(
      modeloMensagem,
      valoresDaMensagem({ dados, numero: res?.numero ?? null, valorLiquido: res?.valorLiquido ?? null, valorBruto: res?.valorBruto ?? null, atendente: r.usuarioNome }),
    );
  }

  async registrarMensagemEnviada(id: string, usuario: Usuario): Promise<void> {
    this.auditoria.registrar(usuario, 'orcamento.mensagem', id);
  }
}
