import { Injectable } from '@nestjs/common';
import { normalizar } from '../comum/texto';
import { ConcentraClient, comoLista } from '../concentra/concentra.client';
import { orcamento, Orcamento } from '../concentra/formatos';

/** A listagem geral (últimos 11 dias, ≈ 1.400 orçamentos) é reaproveitada por este tempo. */
const VALIDADE_LISTAGEM = 2 * 60_000;

@Injectable()
export class OrcamentosService {
  private listagem: { em: number; itens: Orcamento[] } | null = null;
  private emAndamento: Promise<Orcamento[]> | null = null;

  constructor(private readonly concentra: ConcentraClient) {}

  /** Últimos 11 dias. `fresca` ignora o cache (logo depois de gerar um orçamento). */
  async recentes(fresca = false): Promise<Orcamento[]> {
    if (!fresca && this.listagem && Date.now() - this.listagem.em < VALIDADE_LISTAGEM) return this.listagem.itens;
    if (!fresca && this.emAndamento) return this.emAndamento;
    // A documentação fala em "TUDO", mas só o campo vazio lista (testado em 28/10/2026).
    const pedido = this.concentra
      .chamar('listar_orcamento_por_numero', { orcamento: '' }, { tempoLimite: 60_000 })
      .then((corpo) => {
        const itens = comoLista<Record<string, unknown>>(corpo)
          .map(orcamento)
          .filter((o): o is Orcamento => o != null)
          .sort((a, b) => b.numero.localeCompare(a.numero));
        this.listagem = { em: Date.now(), itens };
        return itens;
      })
      .finally(() => {
        this.emAndamento = null;
      });
    this.emAndamento = pedido;
    return pedido;
  }

  /** Número (≥ 5 dígitos) busca pelo número; texto busca pelo nome do cliente. */
  async buscar(termo: string): Promise<Orcamento[]> {
    const t = termo.trim();
    const corpo = await this.concentra.chamar('listar_orcamento_por_numero', { orcamento: t });
    const achados = comoLista<Record<string, unknown>>(corpo)
      .map(orcamento)
      .filter((o): o is Orcamento => o != null);
    // A busca por número só acha orçamentos recentes em aberto: completa com a listagem dos 11 dias.
    if (!achados.length && /^\d{5,}$/.test(t)) {
      const alvo = t.replace(/^0+/, '');
      return (await this.recentes()).filter((o) => o.numero.replace(/^0+/, '') === alvo);
    }
    return achados;
  }

  /** Orçamentos recentes de um cliente, pelo nome (a listagem não traz o id do cliente). */
  async doCliente(nome: string, limite = 5): Promise<Orcamento[]> {
    const alvo = normalizar(nome);
    if (!alvo) return [];
    return (await this.recentes()).filter((o) => normalizar(o.cliente) === alvo).slice(0, limite);
  }
}
