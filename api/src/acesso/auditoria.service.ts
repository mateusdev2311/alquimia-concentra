import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../comum/prisma.service';
import { Usuario } from './chave.guard';

/**
 * Auditoria (LGPD): quem consultou, criou ou enviou o quê. `alvo` é uma referência curta
 * (número da receita, do orçamento, id do cliente); nome, CPF e telefone nunca entram aqui.
 */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger('Auditoria');

  constructor(private readonly prisma: PrismaService) {}

  registrar(usuario: Usuario, acao: string, alvo?: string | null, detalhes?: Record<string, unknown>): void {
    // Não segura a resposta ao atendente: a auditoria grava em segundo plano.
    this.prisma.evento
      .create({
        data: {
          usuarioId: usuario.id,
          usuarioNome: usuario.nome,
          acao,
          alvo: alvo?.slice(0, 80) ?? null,
          detalhes: detalhes as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((erro: unknown) => this.logger.error(`Falha ao gravar a auditoria (${acao}): ${erro instanceof Error ? erro.message : erro}`));
  }
}
