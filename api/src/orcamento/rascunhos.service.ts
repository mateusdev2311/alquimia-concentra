import { randomUUID } from 'node:crypto';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma, Rascunho } from '@prisma/client';
import { AuditoriaService } from '../acesso/auditoria.service';
import { Usuario } from '../acesso/chave.guard';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { chaveTelefone, digitos, normalizar } from '../comum/texto';
import { ConcentraClient, FalhaConcentra, comoLista } from '../concentra/concentra.client';
import { numeroConselho, valorMonetario } from '../concentra/formatos';
import { OrcamentosService } from '../consultas/orcamentos.service';
import { Casamento } from '../ia/casamento';
import { interpretarLeitura, ReceitaLida } from '../ia/leitura';
import { ConfiguracoesService } from './configuracoes.service';
import { renderizar, valoresDaMensagem } from './mensagem';
import { contarCorrigidos, corpoGerarOrcamento, DadosOrcamento, ResultadoEnvio, validar } from './modelo';

/** O arquivo da receita na Kentro. A imagem nunca passa por aqui: quem lê é a IA da Kentro. */
export interface ArquivoReceita {
  /** Id do arquivo na Kentro (fileRef da mensagem / file_id da automação): evita ler a mesma receita duas vezes. */
  referencia?: string | null;
  nome?: string | null;
  mimetype?: string | null;
}

export interface Inicio {
  chatId: string;
  contatoId?: string | null;
  clienteId?: string | null;
  /** Telefone do contato no atendimento (WhatsApp). */
  telefone?: string | null;
  nomeContato?: string | null;
}

/** A automação da Kentro tem este tempo para devolver a leitura; depois o rascunho vira erro. */
const PRAZO_LEITURA = 3 * 60_000;

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
  private readonly casamento: Casamento;
  /** Envios em andamento neste processo: dois cliques não geram dois orçamentos. */
  private readonly enviando = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly concentra: ConcentraClient,
    private readonly orcamentos: OrcamentosService,
    private readonly configuracoes: ConfiguracoesService,
    private readonly auditoria: AuditoriaService,
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
    // A automação não devolveu a leitura a tempo (falhou ou a IA não respondeu).
    if (r.status === 'lendo' && Date.now() - r.criadoEm.getTime() > PRAZO_LEITURA) {
      return this.prisma.rascunho.update({
        where: { id },
        data: { status: 'erro', erro: 'A leitura da receita não voltou. Tente de novo ou monte o orçamento manualmente.' },
      });
    }
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

  /** Rascunho já lendo (ou pronto) para o mesmo arquivo neste atendimento: não lê de novo. */
  private async jaLido(chatId: string, referencia?: string | null): Promise<Rascunho | null> {
    if (!referencia) return null;
    return this.prisma.rascunho.findFirst({
      where: { chatId, status: { in: ['lendo', 'pronto'] }, arquivo: { path: ['referencia'], equals: referencia } },
      orderBy: { criadoEm: 'desc' },
    });
  }

  /**
   * O atendente escolheu a receita no cartão: o rascunho nasce "lendo" e a extensão dispara a automação
   * da Kentro (omni.runAutomation), que lê com a IA da Kentro e devolve em receberLeitura.
   */
  async aguardarLeitura(usuario: Usuario, inicio: Inicio, arquivo: ArquivoReceita): Promise<{ rascunho: Rascunho; novo: boolean }> {
    const ja = await this.jaLido(inicio.chatId, arquivo.referencia);
    if (ja) return { rascunho: ja, novo: false };
    const r = await this.prisma.rascunho.create({
      data: {
        chatId: inicio.chatId,
        contatoId: inicio.contatoId ?? null,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
        origem: 'ia',
        status: 'lendo',
        arquivo: { nome: arquivo.nome ?? null, mimetype: arquivo.mimetype ?? null, referencia: arquivo.referencia ?? null },
        dados: (await this.base(inicio)) as unknown as Prisma.InputJsonValue,
      },
    });
    this.auditoria.registrar(usuario, 'receita.ler', r.id, { origem: 'ia', chatId: inicio.chatId });
    return { rascunho: r, novo: true };
  }

  /** A extensão não conseguiu disparar a automação: o rascunho não fica "lendo" para sempre. */
  async falhouLeitura(id: string, motivo: string): Promise<Rascunho> {
    const r = await this.obter(id);
    if (r.status !== 'lendo') return r;
    return this.prisma.rascunho.update({ where: { id }, data: { status: 'erro', erro: motivo.slice(0, 300) } });
  }

  /**
   * A leitura chegou da automação da Kentro. Com rascunhoId (disparo pelo cartão), completa aquele rascunho;
   * sem (pré-montagem, disparada pela mensagem recebida), cria um novo, já pronto para revisar.
   */
  async receberLeitura(entrada: { rascunhoId?: string | null; inicio: Inicio; arquivo: ArquivoReceita; leitura: unknown }): Promise<Rascunho> {
    let r: Rascunho | null;
    if (entrada.rascunhoId) {
      r = await this.prisma.rascunho.findUnique({ where: { id: entrada.rascunhoId } }).catch(() => null);
      if (!r) throw new ErroApi(404, 'RASCUNHO_NAO_ENCONTRADO', 'Rascunho da leitura não encontrado.');
      if (r.status !== 'lendo' && r.status !== 'erro') return r;
    } else {
      r = await this.jaLido(entrada.inicio.chatId, entrada.arquivo.referencia);
      if (r && r.status === 'pronto') return r;
      if (!r) {
        const clienteId = entrada.inicio.clienteId ?? (await this.clientePorTelefone(entrada.inicio.telefone));
        r = await this.prisma.rascunho.create({
          data: {
            chatId: entrada.inicio.chatId,
            contatoId: entrada.inicio.contatoId ?? null,
            usuarioNome: 'Automação Kentro',
            origem: 'automacao',
            status: 'lendo',
            arquivo: { nome: entrada.arquivo.nome ?? null, mimetype: entrada.arquivo.mimetype ?? null, referencia: entrada.arquivo.referencia ?? null },
            dados: (await this.base({ ...entrada.inicio, clienteId })) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    const lida = interpretarLeitura(entrada.leitura);
    const segundos = (Date.now() - r.criadoEm.getTime()) / 1000;
    if (!lida) {
      return this.prisma.rascunho.update({
        where: { id: r.id },
        data: { status: 'erro', erro: 'A IA não devolveu uma leitura válida. Tente de novo ou monte manualmente.', segundosLeitura: segundos },
      });
    }
    const dados = await this.montar(r.dados as unknown as DadosOrcamento, lida);
    return this.prisma.rascunho.update({
      where: { id: r.id },
      data: {
        status: 'pronto',
        leitura: lida as unknown as Prisma.InputJsonValue,
        dados: dados as unknown as Prisma.InputJsonValue,
        segundosLeitura: segundos,
        erro: !lida.eh_receita ? 'A IA achou que este arquivo não é uma receita. Confira.' : !lida.legivel ? 'Receita com partes ilegíveis: confira cada item.' : null,
      },
    });
  }

  private async clientePorTelefone(telefone?: string | null): Promise<string | null> {
    const chave = chaveTelefone(telefone);
    if (!chave) return null;
    const c = await this.prisma.cliente.findFirst({ where: { chavesTelefone: { has: chave } }, orderBy: { ultimaCompra: { sort: 'desc', nulls: 'last' } } });
    return c?.id ?? null;
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
