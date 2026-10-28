// O orçamento em montagem (Rascunho.dados) e a conversão para o corpo do gerar_orcamento.
import { digitos } from '../comum/texto';

export interface Alternativa {
  codigo: string;
  descricao: string;
  unidade: string | null;
  pontuacao: number;
}

export interface Componente {
  id: string;
  /** Como a IA leu na receita (null quando o atendente incluiu à mão). */
  lido: string | null;
  codigo: string | null;
  nome: string | null;
  dosagem: number | null;
  unidade: string | null;
  controlado?: boolean;
  portarias?: string[];
  /** 0 a 1: quão certa está a leitura + o casamento com o cadastro. */
  confianca?: number | null;
  alternativas?: Alternativa[];
  alerta?: string | null;
  /** Código que a IA sugeriu (para medir quanto o atendente corrigiu). */
  sugerido?: string | null;
}

export interface Excipiente {
  codigo: string;
  nome: string | null;
  dosagem: number | null;
  unidade: string | null;
}

export interface Formula {
  id: string;
  tipoItem: 'manipulado' | 'acabado';
  /** Nome do tipo no Concentra (Cápsulas, Creme, Produto balcão…). */
  forma: string | null;
  /** Código do tipo (tabela do admin). */
  tipo: string | null;
  qsp: number | null;
  /** "caps", "g", "ml"… só para mostrar. */
  unidadeQsp: string | null;
  dose: number | null;
  posologia: string | null;
  repete: number | null;
  componentes: Componente[];
  excipiente: Excipiente | null;
  /** Produto acabado: quantas unidades. */
  quantidade?: number | null;
  alertas?: string[];
  confianca?: number | null;
}

export interface DadosOrcamento {
  clienteId: string | null;
  paciente: string;
  fone: string;
  prescritor: string;
  crm: string;
  /** Nome lido na receita, quando diferente do cliente do atendimento (ex.: a mãe manda a receita do filho). */
  pacienteLido?: string | null;
  prescritorLido?: string | null;
  crmLido?: string | null;
  controleEspecial?: boolean;
  observacoes?: string | null;
  formulas: Formula[];
  /** A resposta do gerar_orcamento não chegou: pode ter sido gravado. Reenviar exige confirmação. */
  envioIncerto?: boolean;
  resultado?: ResultadoEnvio | null;
}

export interface ResultadoEnvio {
  numero: string | null;
  valorLiquido: number | null;
  valorBruto: number | null;
  enviadoEm: string;
  mensagem: string;
}

export const UNIDADES = ['MG', 'MCG', 'G', 'UI', '%', 'ML', 'UN', 'BIL', 'UTR', 'MEQ', 'GTS', 'UFC'] as const;

const SINONIMOS_UNIDADE: Record<string, string> = {
  MILIGRAMA: 'MG',
  MILIGRAMAS: 'MG',
  MICROGRAMA: 'MCG',
  MICROGRAMAS: 'MCG',
  UG: 'MCG',
  'µG': 'MCG',
  ΜG: 'MCG',
  GRAMA: 'G',
  GRAMAS: 'G',
  GR: 'G',
  UNIDADE: 'UN',
  UNIDADES: 'UN',
  U: 'UN',
  'U.I.': 'UI',
  'U.I': 'UI',
  BILHOES: 'BIL',
  BILHÕES: 'BIL',
  BI: 'BIL',
  GOTAS: 'GTS',
  GOTA: 'GTS',
  MILILITRO: 'ML',
  MILILITROS: 'ML',
};

export function unidadeNormalizada(unidade: string | null | undefined): string | null {
  const u = String(unidade ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!u) return null;
  return SINONIMOS_UNIDADE[u] ?? u;
}

/** Problemas que impedem o envio. Vazio = pode enviar. */
export function validar(dados: DadosOrcamento): string[] {
  const erros: string[] = [];
  if (!dados.paciente?.trim()) erros.push('Informe o nome do paciente.');
  if (digitos(dados.fone).length < 10) erros.push('Informe o telefone com DDD.');
  if (!dados.prescritor?.trim()) erros.push('Informe o prescritor.');
  if (!digitos(dados.crm)) erros.push('Informe o CRM (ou registro do conselho) do prescritor.');
  if (!dados.formulas?.length) erros.push('Inclua pelo menos uma fórmula ou produto.');
  dados.formulas?.forEach((f, i) => {
    const n = `Item ${i + 1}`;
    if (f.tipoItem === 'acabado') {
      const c = f.componentes[0];
      if (!c?.codigo) erros.push(`${n}: escolha o produto no cadastro.`);
      if (!f.quantidade || f.quantidade <= 0) erros.push(`${n}: informe a quantidade.`);
      return;
    }
    if (!f.qsp || f.qsp <= 0) erros.push(`${n}: informe o QSP (quantidade total).`);
    if (!f.componentes.length) erros.push(`${n}: inclua pelo menos um componente.`);
    f.componentes.forEach((c, j) => {
      const nc = `${n}, componente ${j + 1}${c.nome ? ` (${c.nome})` : c.lido ? ` (${c.lido})` : ''}`;
      if (!c.codigo) erros.push(`${nc}: escolha o produto no cadastro.`);
      if (c.dosagem == null || !(c.dosagem > 0)) erros.push(`${nc}: informe a dosagem.`);
      if (!c.unidade) erros.push(`${nc}: informe a unidade.`);
    });
    if (f.excipiente && !f.excipiente.codigo) erros.push(`${n}: o excipiente precisa de um produto do cadastro.`);
  });
  return erros;
}

/** Corpo do gerar_orcamento. Convênio fica vazio (a Concentra aplica o padrão dela). */
export function corpoGerarOrcamento(dados: DadosOrcamento): Record<string, unknown> {
  return {
    paciente: dados.paciente.trim().toUpperCase(),
    fone: digitos(dados.fone).replace(/^55(?=\d{10,11}$)/, ''),
    prescritor: dados.prescritor.trim().toUpperCase(),
    crm: digitos(dados.crm).replace(/^0+/, ''),
    formulas: dados.formulas.map((f) => {
      if (f.tipoItem === 'acabado') {
        const c = f.componentes[0];
        // Produto acabado vai como uma "fórmula" de um componente: quantidade em UN.
        return {
          qsp: f.quantidade,
          ...(f.tipo ? { tipo: f.tipo } : {}),
          dose: 0,
          posologia: (f.posologia ?? '').trim().toUpperCase() || 'USO CONFORME PRESCRIÇÃO',
          repete: 1,
          componentes: [{ nome: c.nome ?? undefined, codigo: c.codigo, dosagem: f.quantidade, unidade: 'UN' }],
        };
      }
      return {
        qsp: f.qsp,
        ...(f.tipo ? { tipo: f.tipo } : {}),
        dose: f.dose ?? 0,
        posologia: (f.posologia ?? '').trim().toUpperCase() || 'USO CONFORME PRESCRIÇÃO',
        repete: f.repete && f.repete > 0 ? f.repete : 1,
        componentes: f.componentes.map((c) => ({ nome: c.nome ?? undefined, codigo: c.codigo, dosagem: c.dosagem, unidade: c.unidade })),
        ...(f.excipiente?.codigo
          ? {
              excipiente: {
                codigo: f.excipiente.codigo,
                nome: f.excipiente.nome ?? undefined,
                dosagem: f.excipiente.dosagem ?? f.qsp,
                unidade: f.excipiente.unidade ?? 'UN',
                descricao: f.excipiente.nome ?? undefined,
              },
            }
          : {}),
      };
    }),
  };
}

/** Quantos componentes o atendente trocou em relação ao que a IA sugeriu. */
export function contarCorrigidos(dados: DadosOrcamento): number {
  let n = 0;
  for (const f of dados.formulas) for (const c of f.componentes) if (c.lido != null && c.sugerido !== undefined && c.sugerido !== c.codigo) n++;
  return n;
}
