import { DynamicModule, Module } from '@nestjs/common';
import { AuditoriaService } from './acesso/auditoria.service';
import { AdminController } from './admin/admin.controller';
import { ExtensaoController } from './arquivos-extensao/extensao.controller';
import { CatalogoService } from './catalogo/catalogo.service';
import { SincronizacaoService } from './catalogo/sincronizacao.service';
import { ConfigApp, CONFIG_APP } from './comum/config';
import { ESPERAR, Esperar, esperarDeVerdade, Fetch, FETCH } from './comum/fetch';
import { PrismaService } from './comum/prisma.service';
import { ConcentraClient } from './concentra/concentra.client';
import { ConsultasController } from './consultas/consultas.controller';
import { OrcamentosService } from './consultas/orcamentos.service';
import { StatusService } from './consultas/status.service';
import { OpenAiClient } from './ia/openai.client';
import { ConfiguracoesService } from './orcamento/configuracoes.service';
import { RascunhosController } from './orcamento/rascunhos.controller';
import { RascunhosService } from './orcamento/rascunhos.service';
import { WebhookKentroController } from './orcamento/webhook-kentro.controller';
import { SaudeController } from './saude/saude.controller';

export interface OpcoesApp {
  /** Substitui o fetch de produção (os testes usam uma Concentra e uma OpenAI falsas). */
  fetch?: Fetch;
  /** Substitui as esperas entre tentativas (os testes não esperam). */
  esperar?: Esperar;
}

@Module({})
export class AppModule {
  static com(config: ConfigApp, opcoes: OpcoesApp = {}): DynamicModule {
    return {
      module: AppModule,
      providers: [
        { provide: CONFIG_APP, useValue: config },
        { provide: FETCH, useValue: opcoes.fetch ?? fetch },
        { provide: ESPERAR, useValue: opcoes.esperar ?? esperarDeVerdade },
        PrismaService,
        ConcentraClient,
        OpenAiClient,
        CatalogoService,
        SincronizacaoService,
        OrcamentosService,
        StatusService,
        AuditoriaService,
        ConfiguracoesService,
        RascunhosService,
      ],
      controllers: [SaudeController, ExtensaoController, ConsultasController, RascunhosController, WebhookKentroController, AdminController],
    };
  }
}
