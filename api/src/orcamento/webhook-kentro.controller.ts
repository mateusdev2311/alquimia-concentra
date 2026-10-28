import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { compararSeguro } from '../comum/cripto';
import { ErroApi } from '../comum/erros';
import { PrismaService } from '../comum/prisma.service';
import { chaveTelefone } from '../comum/texto';
import { RascunhosService } from './rascunhos.service';

/** A automação monta o corpo com {{variáveis}}: número pode chegar como número, e variável vazia como "". */
const texto = ({ value }: { value: unknown }) => (value == null || value === '' ? undefined : String(value));

/** O que a automação da Kentro manda quando o cliente envia foto/PDF no atendimento. */
class ReceitaRecebidaDto {
  @Transform(texto)
  @IsString()
  @MaxLength(40)
  chatId!: string;

  @Transform(texto)
  @IsString()
  @MaxLength(4000)
  arquivoUrl!: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimetype?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeContato?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contatoId?: string;
}

/**
 * Pré-montagem: a automação da Kentro chama esta URL (token no caminho, porque o elemento de
 * requisição é configurado por copiar e colar) e o orçamento fica pronto antes de o atendente abrir o cartão.
 */
@Controller('v1/kentro')
export class WebhookKentroController {
  constructor(
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    private readonly rascunhos: RascunhosService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('receita/:token')
  @HttpCode(202)
  async receita(@Param('token') token: string, @Body() dto: ReceitaRecebidaDto) {
    const esperado = this.config.tokenWebhookKentro;
    if (!esperado || !compararSeguro(token, esperado)) throw new ErroApi(401, 'TOKEN_INVALIDO', 'Token do webhook inválido.');
    // Uma leitura por arquivo: a automação pode disparar de novo para a mesma mensagem.
    const referencia = dto.arquivoUrl.split('?')[0].slice(-100);
    const chave = chaveTelefone(dto.telefone);
    const cliente = chave
      ? await this.prisma.cliente.findFirst({ where: { chavesTelefone: { has: chave } }, orderBy: { ultimaCompra: { sort: 'desc', nulls: 'last' } } })
      : null;
    const r = await this.rascunhos.iniciarLeitura(
      { id: null, nome: 'Automação Kentro' },
      { chatId: dto.chatId, contatoId: dto.contatoId, telefone: dto.telefone, nomeContato: dto.nomeContato, clienteId: cliente?.id ?? null },
      { url: dto.arquivoUrl, mimetype: dto.mimetype, nome: dto.nome, referencia },
      'automacao',
    );
    return { id: r.id, status: r.status };
  }
}
