import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { FiltroDeErros } from './erros';

export function configurarApp(app: NestExpressApplication): void {
  // A VPS fica atrás de um proxy: o IP real do cliente vem no X-Forwarded-For.
  app.set('trust proxy', 1);
  // A foto ou o PDF da receita chega em base64 (o proxy da Kentro aceita até ~5 MB).
  app.useBodyParser('json', { limit: '12mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new FiltroDeErros());
}
