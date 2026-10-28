import { Injectable } from '@nestjs/common';
import { Cliente } from '@prisma/client';
import { CatalogoService } from '../catalogo/catalogo.service';
import { PrismaService } from '../comum/prisma.service';
import { ConcentraClient } from '../concentra/concentra.client';

export interface ClienteIndice {
  id: string;
  nome: string;
  telefones: string[];
  cpf: string | null;
  email: string | null;
  endereco: unknown;
  nascimento: string | null;
  sexo: string | null;
  ultimaCompra: string | null;
}

export function clienteDoIndice(c: Cliente): ClienteIndice {
  return {
    id: c.id,
    nome: c.nome,
    telefones: c.telefones,
    cpf: c.cpf,
    email: c.email,
    endereco: c.endereco,
    nascimento: c.nascimento,
    sexo: c.sexo,
    ultimaCompra: c.ultimaCompra?.toISOString().slice(0, 10) ?? null,
  };
}

@Injectable()
export class StatusService {
  constructor(
    private readonly concentra: ConcentraClient,
    private readonly catalogo: CatalogoService,
    private readonly prisma: PrismaService,
  ) {}

  /** O que o cartão precisa para avisar "sistema fora do ar" sem chamar a Concentra de novo. */
  resumoRapido() {
    const e = this.concentra.estado;
    return {
      concentraOnline: e.online,
      concentraVerificadaEm: (e.online ? e.ultimoSucesso : e.ultimaFalha)?.toISOString() ?? null,
      catalogoCarregado: this.catalogo.carregado,
    };
  }

  async resumo() {
    const sincronizacoes = await this.prisma.sincronizacao.findMany({ orderBy: { recurso: 'asc' } });
    const e = this.concentra.estado;
    return {
      ...this.resumoRapido(),
      concentra: {
        online: e.online,
        ultimoSucesso: e.ultimoSucesso?.toISOString() ?? null,
        ultimaFalha: e.ultimaFalha?.toISOString() ?? null,
        ultimoErro: e.ultimoErro,
        ultimoTempoMs: e.ultimoTempo,
      },
      produtosNaBusca: this.catalogo.tamanho,
      sincronizacoes: sincronizacoes.map((s) => ({
        recurso: s.recurso,
        ultimaTentativa: s.ultimaTentativa?.toISOString() ?? null,
        ultimoSucesso: s.ultimoSucesso?.toISOString() ?? null,
        ultimaCargaTotal: s.ultimaCargaTotal?.toISOString() ?? null,
        registros: s.registros,
        ultimoErro: s.ultimoErro,
        emExecucao: s.emExecucaoAte != null && s.emExecucaoAte > new Date(),
      })),
    };
  }
}
