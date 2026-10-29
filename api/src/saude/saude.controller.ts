import { Controller, Get } from '@nestjs/common';

const INICIADO_EM = new Date().toISOString();

@Controller()
export class SaudeController {
  /** iniciadoEm mostra se o Doca reiniciou mesmo o processo (ex.: depois de mudar uma variável). */
  @Get()
  verificar(): { ok: true; iniciadoEm: string } {
    return { ok: true, iniciadoEm: INICIADO_EM };
  }
}
