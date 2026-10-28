import { Controller, Get, Post } from '@nestjs/common';
import { ErroApi } from '../comum/erros';
import { AcessoService } from './acesso.service';

/**
 * Ativação pela extensão de admin, sem chave cadastrada no Doca: a primeira chamada gera as chaves
 * (mostradas uma vez só). Depois de ativada, esta rota não faz mais nada — trocar chave exige a de admin.
 */
@Controller('v1/ativacao')
export class AtivacaoController {
  constructor(private readonly acesso: AcessoService) {}

  @Get()
  async situacao() {
    return { ativada: await this.acesso.ativada() };
  }

  @Post()
  async ativar() {
    const chaves = await this.acesso.ativar();
    if (!chaves) {
      throw new ErroApi(
        409,
        'JA_ATIVADA',
        'A integração já foi ativada. Use a chave de admin gerada na ativação; se ela se perdeu, defina REDEFINIR_CHAVES=sim no Doca, reinicie e ative de novo.',
      );
    }
    return chaves;
  }
}
