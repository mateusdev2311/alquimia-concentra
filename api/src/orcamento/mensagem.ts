// Modelo da mensagem de resumo enviada ao cliente, editável no admin.
import { DadosOrcamento, Formula } from './modelo';

export const MODELO_PADRAO = `Olá, {{primeiro_nome}}! 💚

Segue o seu orçamento{{#numero}} nº {{numero}}{{/numero}}:

{{formulas}}

*Valor total: {{valor_liquido}}*

Posso confirmar o seu pedido?`;

export const VARIAVEIS: { nome: string; descricao: string }[] = [
  { nome: 'primeiro_nome', descricao: 'Primeiro nome do paciente' },
  { nome: 'paciente', descricao: 'Nome completo do paciente' },
  { nome: 'prescritor', descricao: 'Nome do prescritor' },
  { nome: 'crm', descricao: 'CRM do prescritor' },
  { nome: 'numero', descricao: 'Número do orçamento no Concentra (pode ficar vazio)' },
  { nome: 'formulas', descricao: 'Lista das fórmulas e produtos, com componentes e dosagens' },
  { nome: 'quantidade_itens', descricao: 'Quantas fórmulas/produtos tem o orçamento' },
  { nome: 'valor_liquido', descricao: 'Valor final (com desconto), em R$' },
  { nome: 'valor_bruto', descricao: 'Valor sem desconto, em R$' },
  { nome: 'desconto', descricao: 'Diferença entre o bruto e o líquido, em R$ (vazio se não houver)' },
  { nome: 'atendente', descricao: 'Nome de quem enviou o orçamento' },
  { nome: 'data', descricao: 'Data de hoje (DD/MM/AAAA)' },
];

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function numero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function titulo(texto: string): string {
  return texto.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espaco: string, letra: string) => espaco + letra.toUpperCase());
}

function linhaFormula(f: Formula, i: number): string {
  if (f.tipoItem === 'acabado') {
    const c = f.componentes[0];
    return `*${i + 1}. ${titulo(c?.nome ?? c?.lido ?? 'Produto')}* — ${numero(f.quantidade)} un.`;
  }
  const cabeca = `*${i + 1}. ${f.forma ? titulo(f.forma) : 'Fórmula manipulada'}${f.qsp ? ` — ${numero(f.qsp)}${f.unidadeQsp ? ` ${f.unidadeQsp}` : ''}` : ''}*`;
  const componentes = f.componentes.map((c) => `• ${titulo(c.nome ?? c.lido ?? '')} ${numero(c.dosagem)}${c.unidade ? ` ${c.unidade.toLowerCase() === 'ui' ? 'UI' : c.unidade.toLowerCase()}` : ''}`);
  const posologia = f.posologia ? [`_${f.posologia}_`] : [];
  return [cabeca, ...componentes, ...posologia].join('\n');
}

export interface ContextoMensagem {
  dados: DadosOrcamento;
  numero: string | null;
  valorLiquido: number | null;
  valorBruto: number | null;
  atendente: string | null;
  agora?: Date;
}

export function valoresDaMensagem(ctx: ContextoMensagem): Record<string, string> {
  const { dados } = ctx;
  const desconto = ctx.valorBruto != null && ctx.valorLiquido != null && ctx.valorBruto - ctx.valorLiquido >= 0.01 ? ctx.valorBruto - ctx.valorLiquido : null;
  return {
    primeiro_nome: titulo(dados.paciente.trim().split(/\s+/)[0] ?? ''),
    paciente: titulo(dados.paciente.trim()),
    prescritor: titulo(dados.prescritor.trim()),
    crm: dados.crm,
    numero: ctx.numero ?? '',
    formulas: dados.formulas.map(linhaFormula).join('\n\n'),
    quantidade_itens: String(dados.formulas.length),
    valor_liquido: ctx.valorLiquido != null ? moeda.format(ctx.valorLiquido) : '',
    valor_bruto: ctx.valorBruto != null ? moeda.format(ctx.valorBruto) : '',
    desconto: desconto != null ? moeda.format(desconto) : '',
    atendente: ctx.atendente ?? '',
    data: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(ctx.agora ?? new Date()),
  };
}

/**
 * {{variavel}} troca pelo valor; {{#variavel}}…{{/variavel}} só aparece se a variável tiver valor.
 * Variável desconhecida fica como está (o admin vê o erro de digitação na prévia).
 */
export function renderizar(modelo: string, valores: Record<string, string>): string {
  const comSecoes = modelo.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, nome: string, miolo: string) => (valores[nome] ? miolo : ''));
  return comSecoes
    .replace(/\{\{(\w+)\}\}/g, (inteiro, nome: string) => (nome in valores ? valores[nome] : inteiro))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
