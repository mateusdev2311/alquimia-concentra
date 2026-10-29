import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsDefined, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AcessoService } from '../acesso/acesso.service';
import { ErroApi } from '../comum/erros';
import { RascunhosService } from './rascunhos.service';

/** A automação monta o corpo com {{variáveis}}: número pode chegar como número, e variável vazia como "". */
const texto = ({ value }: { value: unknown }) => (value == null || value === '' ? undefined : String(value));

/** O que a automação "Ler receita" da Kentro manda depois do aiProcessFile. */
class LeituraDto {
  /** Obrigatório só sem rascunhoId: disparada pelo cartão, a automação pode não ter atendimento no contexto. */
  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  chatId?: string;

  /** Vem do cartão (omni.runAutomation); vazio na pré-montagem disparada pela mensagem recebida. */
  @Transform(texto)
  @IsOptional()
  @IsUUID()
  rascunhoId?: string;

  /** O resultado do aiProcessFile: objeto ou texto JSON. */
  @IsDefined()
  leitura!: unknown;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  arquivoId?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  arquivoNome?: string;

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimetype?: string;

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

  @Transform(texto)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  clienteId?: string;
}

/**
 * A automação da Kentro lê a receita com a IA da própria Kentro (aiProcessFile) e manda o JSON para cá
 * (token no caminho, porque o elemento de requisição é configurado por copiar e colar).
 */
@Controller('v1/kentro')
export class WebhookKentroController {
  constructor(
    private readonly acesso: AcessoService,
    private readonly rascunhos: RascunhosService,
  ) {}

  @Post('leitura/:token')
  @HttpCode(200)
  async leitura(@Param('token') token: string, @Body() dto: LeituraDto) {
    if (!(await this.acesso.tokenAutomacaoValido(token))) throw new ErroApi(401, 'TOKEN_INVALIDO', 'Token da automação inválido.');
    if (!dto.rascunhoId && !dto.chatId) throw new ErroApi(400, 'SEM_ATENDIMENTO', 'Informe chatId ou rascunhoId.');
    const r = await this.rascunhos.receberLeitura({
      rascunhoId: dto.rascunhoId,
      inicio: { chatId: dto.chatId ?? '', contatoId: dto.contatoId, telefone: dto.telefone, nomeContato: dto.nomeContato, clienteId: dto.clienteId },
      arquivo: { referencia: dto.arquivoId, nome: dto.arquivoNome, mimetype: dto.mimetype },
      leitura: dto.leitura,
    });
    return { id: r.id, status: r.status, erro: r.erro };
  }
}
