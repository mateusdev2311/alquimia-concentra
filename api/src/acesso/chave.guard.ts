import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErroApi } from '../comum/erros';
import { AcessoService, Papel } from './acesso.service';

export type { Papel } from './acesso.service';

const CHAVE_PAPEL = 'papelExigido';

/** Rotas do admin exigem a chave de admin. Sem o decorator, as duas chaves passam. */
export const SoAdmin = () => SetMetadata(CHAVE_PAPEL, 'admin');

export interface Usuario {
  id: string | null;
  nome: string | null;
}

export interface RequisicaoAutenticada extends Request {
  papel: Papel;
  usuario: Usuario;
}

/** Quem está usando a extensão, como a Kentro informou (ctx.user). Serve à auditoria e aos gráficos por atendente. */
function usuarioDe(req: Request): Usuario {
  const id = req.header('X-Kentro-Usuario-Id')?.trim().slice(0, 40) || null;
  let nome: string | null = null;
  try {
    nome = decodeURIComponent(req.header('X-Kentro-Usuario-Nome') ?? '').trim().slice(0, 120) || null;
  } catch {
    nome = null;
  }
  return { id, nome };
}

@Injectable()
export class ChaveGuard implements CanActivate {
  constructor(
    private readonly acesso: AcessoService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const chave = req.header('X-Alquimia-Chave')?.replace(/\s+/g, '') ?? '';
    const papel = await this.acesso.papelDa(chave);
    if (!papel) {
      if (!(await this.acesso.ativada())) {
        throw new ErroApi(401, 'NAO_ATIVADA', 'A integração ainda não foi ativada. Um administrador ativa pela extensão Alquimia × Concentra — Admin.');
      }
      throw new ErroApi(401, 'CHAVE_INVALIDA', 'Chave da integração inválida. Peça ao administrador para conferir a configuração da extensão.');
    }
    const exigido = this.reflector.getAllAndOverride<Papel | undefined>(CHAVE_PAPEL, [contexto.getHandler(), contexto.getClass()]);
    if (exigido === 'admin' && papel !== 'admin') {
      throw new ErroApi(403, 'SO_ADMIN', 'Esta tela é da extensão de administração (Alquimia × Concentra — Admin).');
    }
    req.papel = papel;
    req.usuario = usuarioDe(req);
    return true;
  }
}
