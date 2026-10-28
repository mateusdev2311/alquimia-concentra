import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ChaveGuard, RequisicaoAutenticada } from '../acesso/chave.guard';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { DadosOrcamento } from './modelo';
import { RascunhosService, vistaDoRascunho } from './rascunhos.service';

class InicioDto {
  @IsString()
  @MaxLength(40)
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contatoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  clienteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeContato?: string;
}

class ArquivoDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  url?: string;

  /** Até ~5 MB de arquivo (o proxy da Kentro limita o corpo). */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000)
  base64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimetype?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencia?: string;
}

class LerReceitaDto extends InicioDto {
  @IsObject()
  arquivo!: ArquivoDto;
}

class AtualizarDto {
  @IsObject()
  dados!: DadosOrcamento;
}

class EnviarDto {
  /** O atendente revisou e confirmou na tela. Sem isto, nada vai ao ERP. */
  @IsBoolean()
  confirmado!: boolean;

  /** Reenviar depois de um "envio incerto" (pode duplicar). */
  @IsOptional()
  @IsBoolean()
  forcar?: boolean;
}

class ListarDto {
  @IsString()
  @MaxLength(40)
  chatId!: string;

  @IsOptional()
  @IsIn(['abertos', 'todos'])
  quais?: 'abertos' | 'todos';
}

@Controller('v1/rascunhos')
@UseGuards(ChaveGuard)
export class RascunhosController {
  constructor(
    private readonly rascunhos: RascunhosService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async listar(@Query() dto: ListarDto) {
    const lista = await this.prisma.rascunho.findMany({
      where: { chatId: dto.chatId, ...(dto.quais === 'todos' ? {} : { status: { in: ['lendo', 'pronto', 'erro'] } }) },
      orderBy: { criadoEm: 'desc' },
      take: 10,
    });
    return { rascunhos: lista.map(vistaDoRascunho) };
  }

  @Post()
  async criar(@Body() dto: InicioDto, @Req() req: RequisicaoAutenticada) {
    return vistaDoRascunho(await this.rascunhos.criarManual(req.usuario, dto));
  }

  @Post('ler-receita')
  async lerReceita(@Body() dto: LerReceitaDto, @Req() req: RequisicaoAutenticada) {
    const { arquivo, ...inicio } = dto;
    return vistaDoRascunho(await this.rascunhos.iniciarLeitura(req.usuario, inicio, arquivo, 'ia'));
  }

  @Get(':id')
  async obter(@Param('id', ParseUUIDPipe) id: string) {
    return vistaDoRascunho(await this.rascunhos.obter(id));
  }

  @Put(':id')
  async atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarDto, @Req() req: RequisicaoAutenticada) {
    return vistaDoRascunho(await this.rascunhos.atualizar(id, req.usuario, dto.dados));
  }

  @Post(':id/descartar')
  async descartar(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequisicaoAutenticada) {
    return vistaDoRascunho(await this.rascunhos.descartar(id, req.usuario));
  }

  @Post(':id/enviar')
  async enviar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnviarDto, @Req() req: RequisicaoAutenticada) {
    if (!dto.confirmado) throw new ErroApi(400, 'SEM_CONFIRMACAO', 'Revise e confirme o orçamento antes de enviar.');
    const { rascunho, resultado } = await this.rascunhos.enviar(id, req.usuario, dto.forcar === true);
    return { rascunho: vistaDoRascunho(rascunho), resultado };
  }

  @Get(':id/mensagem')
  async mensagem(@Param('id', ParseUUIDPipe) id: string) {
    return { mensagem: await this.rascunhos.mensagem(id) };
  }

  /** A extensão avisa que mandou o resumo no chat (só auditoria). */
  @Post(':id/mensagem-enviada')
  async mensagemEnviada(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequisicaoAutenticada) {
    await this.rascunhos.registrarMensagemEnviada(id, req.usuario);
    return { ok: true };
  }
}
