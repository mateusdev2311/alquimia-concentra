// Busca tolerante a erro no cadastro de produtos, em memória (≈ 11 mil registros cabem folgados).
// Serve ao atendente (digitação parcial) e à IA (nome lido na receita, com abreviações e erros).
import { normalizar } from '../comum/texto';

export interface ItemCatalogo {
  codigo: string;
  descricao: string;
  familia: string;
  unidade: string;
  preco: number;
  controlado: boolean;
  portarias: string[];
  excluido: boolean;
  sinonimo: boolean;
  principal: string | null;
}

export interface Achado {
  item: ItemCatalogo;
  /** 0 a 1. */
  pontuacao: number;
  /** Achado por um sinônimo: o código do item já é o do produto principal. */
  viaSinonimo: string | null;
}

/** Abreviações do cadastro e de receitas: os dois lados são expandidos antes de comparar. */
const ABREVIACOES: Record<string, string> = {
  VIT: 'VITAMINA',
  AC: 'ACIDO',
  CAP: 'CAPSULA',
  CAPS: 'CAPSULA',
  CPS: 'CAPSULA',
  EXT: 'EXTRATO',
  SOL: 'SOLUCAO',
  SUSP: 'SUSPENSAO',
  COMP: 'COMPRIMIDO',
  CP: 'COMPRIMIDO',
  PADRON: 'PADRONIZADO',
  HCL: 'CLORIDRATO',
  CLOR: 'CLORIDRATO',
};

/** Palavras que não ajudam a distinguir produtos. "A" e "E" ficam: são vitaminas. */
const VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'P', 'PARA', 'USO']);

export function tokens(texto: string): string[] {
  return normalizar(texto)
    .replace(/[^A-Z0-9%.]+/g, ' ')
    // "D 3", "B-12", "Q 10" → "D3", "B12", "Q10" (o cadastro escreve junto)
    .replace(/\b([A-Z])\s+(\d{1,2})\b/g, '$1$2')
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !VAZIAS.has(t))
    .map((t) => ABREVIACOES[t] ?? t);
}

/** Marcações que a farmácia escreve na descrição para orientar quem lança a fórmula. */
const PREFERIR = /USAR ESSE|P\/ ?RECEITA|P\/ ?FORMULA|P\/ ?CAPS/;
const EVITAR = /NAO USAR|NAO TEMOS|P\/ ?NOTA FISCAL|COMPRAR/;

/** Peso das palavras entre parênteses: são observação ("P/ ACIDO GLICOLICO"), não o nome do produto. */
const PESO_PARENTESES = 0.6;

function trigramas(t: string): Set<string> {
  const s = `  ${t} `;
  const r = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) r.add(s.slice(i, i + 3));
  return r;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum++;
  return (2 * comum) / (a.size + b.size);
}

interface Indexado {
  item: ItemCatalogo;
  norm: string;
  toks: string[];
  pesos: number[];
  tris: Set<string>[];
  ajuste: number;
}

export interface OpcoesBusca {
  limite?: number;
  /** Famílias preferidas (ex.: ["00"] para matéria-prima, ["10","15"] para produto acabado). */
  familias?: string[];
  /** Só estas famílias (filtro, não preferência). */
  apenasFamilias?: string[];
  incluirExcluidos?: boolean;
}

export class IndiceCatalogo {
  private itens: Indexado[] = [];
  private porCodigo = new Map<string, ItemCatalogo>();

  get tamanho(): number {
    return this.itens.length;
  }

  carregar(lista: ItemCatalogo[]): void {
    this.porCodigo = new Map(lista.map((i) => [i.codigo, i]));
    this.itens = lista.map((item) => {
      const norm = normalizar(item.descricao);
      const principal = tokens(norm.replace(/\([^)]*\)?/g, ' '));
      const observacao = tokens((norm.match(/\(([^)]*)\)?/g) ?? []).join(' '));
      const toks = [...principal, ...observacao];
      const pesos = [...principal.map(() => 1), ...observacao.map(() => PESO_PARENTESES)];
      const ajuste = (PREFERIR.test(norm) ? 0.05 : 0) - (EVITAR.test(norm) ? 0.15 : 0);
      return { item, norm, toks, pesos, tris: toks.map(trigramas), ajuste };
    });
  }

  porCodigoDe(codigo: string): ItemCatalogo | undefined {
    return this.porCodigo.get(codigo);
  }

  buscar(consulta: string, opcoes: OpcoesBusca = {}): Achado[] {
    const limite = opcoes.limite ?? 20;
    const q = tokens(consulta);
    if (!q.length) return [];
    const qNorm = normalizar(consulta);
    const qTris = q.map(trigramas);
    const candidatos: Achado[] = [];

    for (const e of this.itens) {
      if (!opcoes.incluirExcluidos && e.item.excluido) continue;
      if (opcoes.apenasFamilias && !opcoes.apenasFamilias.includes(e.item.familia)) continue;
      let soma = 0;
      for (let i = 0; i < q.length; i++) {
        const t = q[i];
        let melhor = 0;
        for (let j = 0; j < e.toks.length; j++) {
          const et = e.toks[j];
          let s: number;
          if (et === t) s = 1;
          else if (t.length >= 3 && et.startsWith(t)) s = 0.92;
          else if (/^\d/.test(t) || /^\d/.test(et)) s = 0; // dosagens/números: só vale igual
          else s = dice(qTris[i], e.tris[j]);
          s *= e.pesos[j];
          if (s > melhor) melhor = s;
          if (melhor === 1) break;
        }
        soma += melhor < 0.45 ? 0 : melhor;
      }
      let pontuacao = soma / q.length;
      if (pontuacao < 0.4) continue;
      // Desempates: começa igual à consulta, descrição curta (menos palavras sobrando), família preferida.
      if (e.norm.startsWith(qNorm)) pontuacao += 0.06;
      const sobra = Math.max(0, e.toks.length - q.length);
      pontuacao -= Math.min(0.08, sobra * 0.015);
      if (opcoes.familias?.includes(e.item.familia)) pontuacao += 0.05;
      pontuacao += e.ajuste;
      candidatos.push({ item: e.item, pontuacao, viaSinonimo: null });
    }

    // Ordena pela pontuação crua (acima de 1 desempata); só depois limita a 0–1 para mostrar.
    candidatos.sort((a, b) => b.pontuacao - a.pontuacao || a.item.descricao.length - b.item.descricao.length);
    return this.resolverSinonimos(candidatos)
      .slice(0, limite)
      .map((a) => ({ ...a, pontuacao: Math.max(0, Math.min(1, a.pontuacao)) }));
  }

  /** Sinônimo aponta para o produto principal: é ele que entra na fórmula. Sem repetir o mesmo código. */
  private resolverSinonimos(lista: Achado[]): Achado[] {
    const vistos = new Set<string>();
    const saida: Achado[] = [];
    for (const a of lista) {
      let achado = a;
      if (a.item.sinonimo && a.item.principal) {
        const principal = this.porCodigo.get(a.item.principal);
        if (principal && !principal.excluido) achado = { item: principal, pontuacao: a.pontuacao, viaSinonimo: a.item.descricao };
      }
      if (vistos.has(achado.item.codigo)) continue;
      vistos.add(achado.item.codigo);
      saida.push(achado);
    }
    return saida;
  }
}
