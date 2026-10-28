import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditoriaService } from '../acesso/auditoria.service';
import { ChaveGuard, RequisicaoAutenticada } from '../acesso/chave.guard';
import { OpcoesBusca } from '../catalogo/busca';
import { CatalogoService } from '../catalogo/catalogo.service';
import { SincronizacaoService } from '../catalogo/sincronizacao.service';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { chaveTelefone, normalizar } from '../comum/texto';
import { ConcentraClient, comoLista } from '../concentra/concentra.client';
import { cliente, ClienteConcentra, formulaF9, numeroConselho, produtoDeDescricao } from '../concentra/formatos';
import { ConfiguracoesService } from '../orcamento/configuracoes.service';
import { OrcamentosService } from './orcamentos.service';
import { ClienteIndice, clienteDoIndice, StatusService } from './status.service';

const aparar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class ConsultaReceitaDto {
  @Transform(aparar)
  @IsString()
  @Length(6, 7, { message: 'O número da receita tem 6 ou 7 caracteres.' })
  receita!: string;

  @Matches(/^\d{4}$/, { message: 'Ano no formato AAAA.' })
  ano!: string;

  @Matches(/^(0[1-9]|1[0-2])$/, { message: 'Mês no formato MM (01 a 12).' })
  mes!: string;
}

class BuscaClienteDto {
  @Transform(aparar)
  @IsString()
  @MinLength(3, { message: 'Digite pelo menos 3 letras do nome.' })
  @MaxLength(80)
  nome!: string;
}

class PainelDto {
  @IsString()
  @MaxLength(40)
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  /** Cliente da Concentra já gravado no contato da Kentro (campo extra). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  clienteId?: string;
}

/** A Concentra manda a imagem em base64 sem dizer o tipo: o começo do base64 diz. */
function tipoDaImagem(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('JVBER')) return 'application/pdf';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('Qk')) return 'image/bmp';
  return 'image/jpeg';
}

/** Campos DBF: tira os espaços de todos os textos, em qualquer profundidade. */
function aparado(valor: unknown): unknown {
  if (typeof valor === 'string') return valor.trim();
  if (Array.isArray(valor)) return valor.map(aparado);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aparado(v)]));
  return valor;
}

@Controller('v1')
@UseGuards(ChaveGuard)
export class ConsultasController {
  constructor(
    private readonly concentra: ConcentraClient,
    private readonly catalogo: CatalogoService,
    private readonly orcamentos: OrcamentosService,
    private readonly sincronizacao: SincronizacaoService,
    private readonly status: StatusService,
    private readonly auditoria: AuditoriaService,
    private readonly prisma: PrismaService,
    private readonly configuracoes: ConfiguracoesService,
  ) {}

  @Get('status')
  async situacao() {
    return this.status.resumo();
  }

  /**
   * Tudo que o cartão lateral precisa ao abrir um atendimento, numa chamada só
   * (a Kentro limita a extensão a 30 chamadas por minuto por atendente).
   */
  @Post('painel')
  async painel(@Body() dto: PainelDto, @Req() req: RequisicaoAutenticada) {
    let clientes: ClienteIndice[] = [];
    let vinculado = false;
    if (dto.clienteId) {
      const c = await this.prisma.cliente.findUnique({ where: { id: dto.clienteId } });
      if (c) {
        clientes = [clienteDoIndice(c)];
        vinculado = true;
      }
    }
    if (!clientes.length && dto.telefone) {
      const chave = chaveTelefone(dto.telefone);
      if (chave) {
        const achados = await this.prisma.cliente.findMany({
          where: { chavesTelefone: { has: chave } },
          orderBy: { ultimaCompra: { sort: 'desc', nulls: 'last' } },
          take: 5,
        });
        clientes = achados.map(clienteDoIndice);
      }
    }
    const rascunhos = await this.prisma.rascunho.findMany({
      where: { chatId: dto.chatId, status: { in: ['lendo', 'pronto', 'erro'] } },
      orderBy: { criadoEm: 'desc' },
      take: 5,
      select: { id: true, status: true, origem: true, criadoEm: true, atualizadoEm: true, erro: true, arquivo: true },
    });
    let orcamentosRecentes: Awaited<ReturnType<OrcamentosService['doCliente']>> = [];
    let orcamentosErro: string | null = null;
    if (clientes.length === 1) {
      try {
        orcamentosRecentes = await this.orcamentos.doCliente(clientes[0].nome);
      } catch (erro) {
        orcamentosErro = erro instanceof ErroApi ? erro.mensagem : 'Não foi possível buscar os orçamentos.';
      }
      this.auditoria.registrar(req.usuario, 'cliente.identificar', clientes[0].id, { vinculado, chatId: dto.chatId });
    }
    return { status: this.status.resumoRapido(), clientes, vinculado, rascunhos, orcamentosRecentes, orcamentosErro };
  }

  @Get('clientes')
  async buscarClientes(@Query() dto: BuscaClienteDto, @Req() req: RequisicaoAutenticada) {
    const corpo = await this.concentra.chamar('listar_info_clientes_por_nome', { nome: normalizar(dto.nome) });
    const lista = comoLista<Record<string, unknown>>(corpo)
      .map(cliente)
      .filter((c): c is ClienteConcentra => c != null);
    // Quem foi achado pelo nome passa a ser achado pelo telefone também.
    this.sincronizacao.gravarClientes(lista).catch(() => {});
    this.auditoria.registrar(req.usuario, 'cliente.buscar', null, { resultados: lista.length });
    return {
      clientes: lista
        .sort((a, b) => (b.ultimaCompra?.getTime() ?? 0) - (a.ultimaCompra?.getTime() ?? 0))
        .slice(0, 50)
        .map((c) => ({ ...c, ultimaCompra: c.ultimaCompra?.toISOString().slice(0, 10) ?? null, cadastro: c.cadastro?.toISOString().slice(0, 10) ?? null })),
    };
  }

  @Post('receitas/consultar')
  async receita(@Body() dto: ConsultaReceitaDto, @Req() req: RequisicaoAutenticada) {
    const corpo = await this.concentra.chamar('retorna_dados_completos_receita', { ...dto }, { vazioSeNaoEncontrado: false });
    const registro = comoLista<Record<string, unknown>>(corpo)[0];
    if (!registro) throw new ErroApi(404, 'RECEITA_NAO_ENCONTRADA', 'Receita não encontrada nesse ano/mês.');
    this.auditoria.registrar(req.usuario, 'receita.consultar', `${dto.receita} ${dto.mes}/${dto.ano}`);
    return { receita: aparado(registro) };
  }

  @Post('receitas/imagem')
  async imagem(@Body() dto: ConsultaReceitaDto, @Req() req: RequisicaoAutenticada) {
    const corpo = await this.concentra.chamar('retorna_imagem_receita', { ...dto }, { vazioSeNaoEncontrado: false, tempoLimite: 45_000 });
    const registro = comoLista<{ imagem?: string }>(corpo)[0];
    const base64 = registro?.imagem?.trim();
    if (!base64) throw new ErroApi(404, 'SEM_IMAGEM', 'Esta receita não tem imagem no sistema.');
    // O proxy da Kentro entrega no máximo 5 MB à extensão.
    if (base64.length > 4_800_000) throw new ErroApi(413, 'IMAGEM_GRANDE', 'A imagem desta receita é grande demais para abrir aqui. Abra no Concentra.');
    this.auditoria.registrar(req.usuario, 'receita.imagem', `${dto.receita} ${dto.mes}/${dto.ano}`);
    return { mimetype: tipoDaImagem(base64), base64 };
  }

  @Get('orcamentos')
  async buscarOrcamentos(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutenticada) {
    const termo = String(busca ?? '').trim();
    if (termo.length < 3) throw new ErroApi(400, 'BUSCA_CURTA', 'Digite o número do orçamento ou pelo menos 3 letras do nome do cliente.');
    const orcamentos = await this.orcamentos.buscar(normalizar(termo));
    this.auditoria.registrar(req.usuario, 'orcamento.buscar', /^\d+$/.test(termo) ? termo : null, { resultados: orcamentos.length });
    return { orcamentos: orcamentos.slice(0, 30) };
  }

  /** Busca no espelho local (tolerante a erro); sem espelho ainda, cai na busca da Concentra. */
  @Get('produtos')
  async produtos(@Query('q') q: string | undefined, @Query('tipo') tipo: string | undefined) {
    const termo = String(q ?? '').trim();
    if (termo.length < 2) throw new ErroApi(400, 'BUSCA_CURTA', 'Digite pelo menos 2 letras.');
    if (!this.catalogo.carregado) {
      const corpo = await this.concentra.chamar('listar_produtos_por_descricao', { produto: normalizar(termo) });
      return {
        origem: 'concentra',
        produtos: comoLista<{ descricao?: string }>(corpo)
          .map((r) => produtoDeDescricao(String(r.descricao ?? '')))
          .filter((p) => p != null)
          .slice(0, 30),
      };
    }
    const opcoes: OpcoesBusca = { limite: 30 };
    if (tipo === 'materia-prima') opcoes.familias = ['00'];
    if (tipo === 'acabado') opcoes.apenasFamilias = ['10', '15'];
    if (tipo === 'excipiente') opcoes.apenasFamilias = ['00'];
    return {
      origem: 'espelho',
      produtos: this.catalogo.buscar(termo, opcoes).map((a) => ({
        codigo: a.item.codigo,
        descricao: a.item.descricao,
        unidade: a.item.unidade || null,
        preco: a.item.preco,
        familia: a.item.familia,
        controlado: a.item.controlado,
        portarias: a.item.portarias,
        viaSinonimo: a.viaSinonimo,
        pontuacao: Math.round(a.pontuacao * 100) / 100,
      })),
    };
  }

  /** Tipos de fórmula (Cápsulas, Creme…) para o seletor do orçamento. */
  @Get('tipos')
  async tipos() {
    const { tipos, tipoAcabadoPadrao } = await this.configuracoes.ler();
    return { tipos: tipos.map(({ nome, codigo, categoria }) => ({ nome, codigo, categoria })), tipoAcabadoPadrao };
  }

  @Get('formulas-f9')
  async formulasF9(@Query('q') q: string | undefined) {
    const termo = String(q ?? '').trim();
    if (termo.length < 2) throw new ErroApi(400, 'BUSCA_CURTA', 'Digite pelo menos 2 letras.');
    const corpo = await this.concentra.chamar('listar_formulas_F9_por_descricao', { formulaF9: normalizar(termo) });
    return {
      formulas: comoLista<{ descricao?: string }>(corpo)
        .map((r) => formulaF9(String(r.descricao ?? '')))
        .filter((f) => f != null)
        .slice(0, 50),
    };
  }

  @Get('prescritores')
  async prescritores(@Query('crm') crm: string | undefined, @Query('nome') nome: string | undefined) {
    const numero = numeroConselho(crm);
    if (numero) {
      return { prescritores: await this.prisma.prescritor.findMany({ where: { numero }, take: 10 }) };
    }
    const termo = normalizar(nome);
    if (termo.length < 3) throw new ErroApi(400, 'BUSCA_CURTA', 'Informe o CRM ou pelo menos 3 letras do nome.');
    return {
      prescritores: await this.prisma.prescritor.findMany({ where: { nome: { contains: termo, mode: 'insensitive' } }, orderBy: { nome: 'asc' }, take: 20 }),
    };
  }
}
