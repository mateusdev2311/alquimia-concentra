import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AcessoService } from '../acesso/acesso.service';
import { AuditoriaService } from '../acesso/auditoria.service';
import { ChaveGuard, RequisicaoAutenticada, SoAdmin } from '../acesso/chave.guard';
import { Recurso, RECURSOS, SincronizacaoService } from '../catalogo/sincronizacao.service';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { ConcentraClient } from '../concentra/concentra.client';
import { instrucaoKentro } from '../ia/leitura';
import { StatusService } from '../consultas/status.service';
import { ConfiguracoesService, TipoFormula } from '../orcamento/configuracoes.service';
import { MODELO_PADRAO, VARIAVEIS } from '../orcamento/mensagem';

class ConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  modeloMensagem?: string;

  @IsOptional()
  @IsArray()
  tipos?: TipoFormula[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tipoAcabadoPadrao?: string;
}

class PeriodoDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}

class AuditoriaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  acao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  usuarioId?: string;
}

const FUSO = 'America/Sao_Paulo';

function validarTipos(tipos: TipoFormula[]): TipoFormula[] {
  return tipos.map((t) => {
    const nome = String(t?.nome ?? '').trim();
    const codigo = String(t?.codigo ?? '').trim();
    if (!nome) throw new ErroApi(400, 'TIPO_INVALIDO', 'Todo tipo precisa de um nome.');
    if (codigo && !/^[0-9A-Za-z]{1,10}$/.test(codigo)) throw new ErroApi(400, 'TIPO_INVALIDO', `Código inválido no tipo "${nome}".`);
    return {
      nome: nome.slice(0, 60),
      codigo,
      categoria: t.categoria === 'acabado' ? 'acabado' : 'manipulado',
      apelidos: Array.isArray(t.apelidos) ? t.apelidos.map((a) => String(a).trim().slice(0, 60)).filter(Boolean).slice(0, 20) : [],
    };
  });
}

@Controller('v1/admin')
@UseGuards(ChaveGuard)
@SoAdmin()
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracoes: ConfiguracoesService,
    private readonly status: StatusService,
    private readonly sincronizacao: SincronizacaoService,
    private readonly concentra: ConcentraClient,
    private readonly auditoria: AuditoriaService,
    private readonly acesso: AcessoService,
    @Inject(CONFIG_APP) private readonly configApp: ConfigApp,
  ) {}

  /** Nova chave de atendimento (mostrada uma vez): a anterior para de funcionar na hora. */
  @Post('chaves/atendimento')
  async trocarChaveAtendimento(@Req() req: RequisicaoAutenticada) {
    const chave = await this.acesso.trocarChaveAtendimento();
    this.auditoria.registrar(req.usuario, 'admin.chave_atendimento');
    return { chaveAtendimento: chave };
  }

  /**
   * O que a automação "Ler receita" da Kentro precisa: a URL (com o token), a instrução do aiProcessFile
   * e o corpo da requisição, para copiar e colar.
   */
  @Get('leitura')
  async leitura() {
    const token = await this.acesso.tokenAutomacao();
    return {
      url: token ? `${this.configApp.urlPublica}/v1/kentro/leitura/${token}` : null,
      instrucao: instrucaoKentro(),
      corpo: {
        chatId: '{{chat_id}}',
        rascunhoId: '{{rascunho_id}}',
        leitura: '{{receita_lida}}',
        arquivoId: '{{arquivo_id}}',
        arquivoNome: '{{arquivo_nome}}',
        mimetype: '{{arquivo_tipo}}',
        telefone: '{{chat_client_number}}',
        nomeContato: '{{chat_client_name}}',
        contatoId: '{{chat_contact_id}}',
        clienteId: '{{cliente_id}}',
      },
    };
  }

  @Post('leitura/token')
  async trocarTokenLeitura(@Req() req: RequisicaoAutenticada) {
    await this.acesso.trocarTokenAutomacao();
    this.auditoria.registrar(req.usuario, 'admin.token_automacao');
    return this.leitura();
  }

  @Get('config')
  async config() {
    return { ...(await this.configuracoes.ler()), modeloPadrao: MODELO_PADRAO, variaveis: VARIAVEIS };
  }

  @Put('config')
  async gravarConfig(@Body() dto: ConfigDto, @Req() req: RequisicaoAutenticada) {
    const parcial = { ...dto, tipos: dto.tipos ? validarTipos(dto.tipos) : undefined };
    const salvo = await this.configuracoes.gravar(parcial);
    this.auditoria.registrar(req.usuario, 'admin.config', Object.keys(dto).join(','));
    return { ...salvo, modeloPadrao: MODELO_PADRAO, variaveis: VARIAVEIS };
  }

  @Get('status')
  async situacao() {
    return this.status.resumo();
  }

  /** Uma consulta leve (busca de produto) para ver se a API da farmácia responde. */
  @Post('testar-conexao')
  async testar() {
    const inicio = Date.now();
    try {
      await this.concentra.chamar('listar_produtos_por_descricao', { produto: 'CAPSULA' }, { tempoLimite: 15_000 });
      return { ok: true, ms: Date.now() - inicio };
    } catch (erro) {
      return { ok: false, ms: Date.now() - inicio, mensagem: erro instanceof ErroApi ? erro.mensagem : 'Falha desconhecida.' };
    }
  }

  @Post('sincronizar/:recurso')
  async sincronizar(@Param('recurso') recurso: string, @Req() req: RequisicaoAutenticada) {
    if (!RECURSOS.includes(recurso as Recurso)) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Recurso desconhecido.');
    this.auditoria.registrar(req.usuario, 'admin.sincronizar', recurso);
    try {
      const n = await this.sincronizacao.sincronizar(recurso as Recurso, 'total');
      return { ok: true, registros: n };
    } catch (erro) {
      return { ok: false, mensagem: erro instanceof ErroApi ? erro.mensagem : erro instanceof Error ? erro.message : 'Falha.' };
    }
  }

  @Get('auditoria')
  async listarAuditoria(@Query() dto: AuditoriaDto) {
    const porPagina = 50;
    const pagina = dto.pagina ?? 1;
    const where: Prisma.EventoWhereInput = {
      ...(dto.acao ? { acao: { startsWith: dto.acao } } : {}),
      ...(dto.usuarioId ? { usuarioId: dto.usuarioId } : {}),
    };
    const [total, eventos] = await Promise.all([
      this.prisma.evento.count({ where }),
      this.prisma.evento.findMany({ where, orderBy: { criadoEm: 'desc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
    ]);
    return {
      total,
      pagina,
      paginas: Math.max(1, Math.ceil(total / porPagina)),
      eventos: eventos.map((e) => ({ ...e, id: String(e.id), criadoEm: e.criadoEm.toISOString() })),
    };
  }

  /** Impacto da integração no período: orçamentos, valores, uso da IA e cada atendente. */
  @Get('painel')
  async painel(@Query() dto: PeriodoDto) {
    const dias = dto.dias ?? 30;
    const desde = new Date(Date.now() - dias * 24 * 3600_000);
    const anterior = new Date(desde.getTime() - dias * 24 * 3600_000);

    const resumo = async (de: Date, ate: Date) => {
      const [linha] = await this.prisma.$queryRaw<
        { n: bigint; valor: number | null; via_ia: bigint; componentes: bigint; corrigidos: bigint; comp_ia: bigint; tempo: number | null }[]
      >`
        SELECT count(*) AS n,
               sum(valor_liquido) AS valor,
               count(*) FILTER (WHERE origem <> 'manual') AS via_ia,
               coalesce(sum(componentes), 0) AS componentes,
               coalesce(sum(corrigidos) FILTER (WHERE origem <> 'manual'), 0) AS corrigidos,
               coalesce(sum(componentes) FILTER (WHERE origem <> 'manual'), 0) AS comp_ia,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos_montagem) AS tempo
        FROM orcamentos_enviados WHERE criado_em >= ${de} AND criado_em < ${ate}`;
      const n = Number(linha?.n ?? 0);
      return {
        orcamentos: n,
        valor: linha?.valor ?? 0,
        ticketMedio: n ? (linha?.valor ?? 0) / n : null,
        viaIa: Number(linha?.via_ia ?? 0),
        percentualIa: n ? (Number(linha?.via_ia ?? 0) / n) * 100 : null,
        taxaCorrecao: Number(linha?.comp_ia ?? 0) ? (Number(linha?.corrigidos ?? 0) / Number(linha?.comp_ia)) * 100 : null,
        minutosMontagem: linha?.tempo != null ? linha.tempo / 60 : null,
      };
    };

    const porDia = await this.prisma.$queryRaw<{ dia: Date; n: bigint; valor: number | null }[]>`
      SELECT date_trunc('day', criado_em AT TIME ZONE 'UTC' AT TIME ZONE ${FUSO})::date AS dia, count(*) AS n, sum(valor_liquido) AS valor
      FROM orcamentos_enviados WHERE criado_em >= ${desde} GROUP BY 1 ORDER BY 1`;

    const porAtendente = await this.prisma.$queryRaw<
      { usuario_id: string | null; usuario_nome: string | null; n: bigint; valor: number | null; via_ia: bigint; tempo: number | null }[]
    >`
      SELECT usuario_id, max(usuario_nome) AS usuario_nome, count(*) AS n, sum(valor_liquido) AS valor,
             count(*) FILTER (WHERE origem <> 'manual') AS via_ia,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY segundos_montagem) AS tempo
      FROM orcamentos_enviados WHERE criado_em >= ${desde}
      GROUP BY usuario_id ORDER BY count(*) DESC`;

    const usoPorAtendente = await this.prisma.$queryRaw<{ usuario_id: string | null; usuario_nome: string | null; acao: string; n: bigint }[]>`
      SELECT usuario_id, max(usuario_nome) AS usuario_nome, acao, count(*) AS n
      FROM eventos WHERE criado_em >= ${desde} GROUP BY usuario_id, acao`;

    const leituras = await this.prisma.$queryRaw<{ n: bigint; erros: bigint; segundos: number | null }[]>`
      SELECT count(*) AS n, count(*) FILTER (WHERE status = 'erro') AS erros, avg(segundos_leitura) AS segundos
      FROM rascunhos WHERE origem <> 'manual' AND criado_em >= ${desde}`;

    const usos = new Map<string, { id: string | null; nome: string | null; consultas: number; leituras: number }>();
    for (const u of usoPorAtendente) {
      const chave = u.usuario_id ?? '-';
      const atual = usos.get(chave) ?? { id: u.usuario_id, nome: u.usuario_nome, consultas: 0, leituras: 0 };
      if (u.acao === 'receita.ler') atual.leituras += Number(u.n);
      else if (/\.(buscar|consultar|imagem|identificar)$/.test(u.acao)) atual.consultas += Number(u.n);
      usos.set(chave, atual);
    }

    const atendentes = porAtendente.map((a) => {
      const uso = usos.get(a.usuario_id ?? '-');
      usos.delete(a.usuario_id ?? '-');
      const n = Number(a.n);
      return {
        id: a.usuario_id,
        nome: a.usuario_nome ?? (a.usuario_id ? `Usuário ${a.usuario_id}` : 'Automação'),
        orcamentos: n,
        valor: a.valor ?? 0,
        percentualIa: n ? (Number(a.via_ia) / n) * 100 : null,
        minutosMontagem: a.tempo != null ? a.tempo / 60 : null,
        consultas: uso?.consultas ?? 0,
        leituras: uso?.leituras ?? 0,
      };
    });
    // Quem só consultou (sem orçamento enviado) também aparece.
    for (const u of usos.values()) {
      if (!u.id) continue;
      atendentes.push({ id: u.id, nome: u.nome ?? `Usuário ${u.id}`, orcamentos: 0, valor: 0, percentualIa: null, minutosMontagem: null, consultas: u.consultas, leituras: u.leituras });
    }

    return {
      dias,
      atual: await resumo(desde, new Date()),
      anterior: await resumo(anterior, desde),
      porDia: porDia.map((d) => ({ dia: d.dia.toISOString().slice(0, 10), orcamentos: Number(d.n), valor: d.valor ?? 0 })),
      atendentes,
      leituras: {
        total: Number(leituras[0]?.n ?? 0),
        erros: Number(leituras[0]?.erros ?? 0),
        segundosMedios: leituras[0]?.segundos ?? null,
      },
    };
  }
}
