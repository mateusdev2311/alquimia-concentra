import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ConfigApp, CONFIG_APP } from '../comum/config';
import { compararSeguro } from '../comum/cripto';
import { ErroApi } from '../comum/erros';

export type Papel = 'atendimento' | 'admin';

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
    @Inject(CONFIG_APP) private readonly config: ConfigApp,
    private readonly reflector: Reflector,
  ) {}

  canActivate(contexto: ExecutionContext): boolean {
    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const chave = req.header('X-Alquimia-Chave')?.replace(/\s+/g, '') ?? '';
    const papel: Papel | null = !chave
      ? null
      : compararSeguro(chave, this.config.chaveAdmin)
        ? 'admin'
        : compararSeguro(chave, this.config.chaveAtendimento)
          ? 'atendimento'
          : null;
    if (!papel) {
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
