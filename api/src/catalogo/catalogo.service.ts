import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../comum/prisma.service';
import { Achado, IndiceCatalogo, ItemCatalogo, OpcoesBusca } from './busca';

/** O cadastro de produtos em memória (carregado do espelho no Postgres) e a busca sobre ele. */
@Injectable()
export class CatalogoService implements OnModuleInit {
  private readonly logger = new Logger('Catalogo');
  private readonly indice = new IndiceCatalogo();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.recarregar();
  }

  get carregado(): boolean {
    return this.indice.tamanho > 0;
  }

  get tamanho(): number {
    return this.indice.tamanho;
  }

  async recarregar(): Promise<void> {
    const produtos = await this.prisma.produto.findMany();
    this.indice.carregar(produtos as ItemCatalogo[]);
    this.logger.log(`${produtos.length} produtos na busca`);
  }

  buscar(consulta: string, opcoes?: OpcoesBusca): Achado[] {
    return this.indice.buscar(consulta, opcoes);
  }

  produto(codigo: string): ItemCatalogo | undefined {
    return this.indice.porCodigoDe(codigo);
  }
}
