// Formatos que a API da integração devolve ao cartão do atendimento.

export interface Status {
  concentraOnline: boolean | null;
  concentraVerificadaEm: string | null;
  catalogoCarregado: boolean;
}

export interface Endereco {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface Cliente {
  id: string;
  nome: string;
  telefones: string[];
  cpf: string | null;
  email: string | null;
  endereco: Endereco | null;
  nascimento: string | null;
  sexo: string | null;
  ultimaCompra: string | null;
}

export interface ItemOrcamento {
  texto: string;
}

export interface Orcamento {
  numero: string;
  tipo: string | null;
  cliente: string | null;
  valor: number | null;
  vendedor: string | null;
  itens: ItemOrcamento[];
}

export interface RascunhoResumo {
  id: string;
  status: 'lendo' | 'pronto' | 'erro' | 'enviado' | 'descartado';
  origem: 'manual' | 'ia' | 'automacao';
  criadoEm: string;
  atualizadoEm: string;
  erro: string | null;
  arquivo: { nome?: string | null; mimetype?: string | null } | null;
}

export interface Painel {
  status: Status;
  clientes: Cliente[];
  vinculado: boolean;
  rascunhos: RascunhoResumo[];
  orcamentosRecentes: Orcamento[];
  orcamentosErro: string | null;
}

export interface Alternativa {
  codigo: string;
  descricao: string;
  unidade: string | null;
  pontuacao: number;
}

export interface Componente {
  id: string;
  lido: string | null;
  codigo: string | null;
  nome: string | null;
  dosagem: number | null;
  unidade: string | null;
  controlado?: boolean;
  portarias?: string[];
  confianca?: number | null;
  alternativas?: Alternativa[];
  alerta?: string | null;
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
  forma: string | null;
  tipo: string | null;
  qsp: number | null;
  unidadeQsp: string | null;
  dose: number | null;
  posologia: string | null;
  repete: number | null;
  componentes: Componente[];
  excipiente: Excipiente | null;
  quantidade?: number | null;
  alertas?: string[];
  confianca?: number | null;
}

export interface ResultadoEnvio {
  numero: string | null;
  valorLiquido: number | null;
  valorBruto: number | null;
  enviadoEm: string;
  mensagem: string;
}

export interface DadosOrcamento {
  clienteId: string | null;
  paciente: string;
  fone: string;
  prescritor: string;
  crm: string;
  pacienteLido?: string | null;
  prescritorLido?: string | null;
  crmLido?: string | null;
  controleEspecial?: boolean;
  observacoes?: string | null;
  formulas: Formula[];
  envioIncerto?: boolean;
  resultado?: ResultadoEnvio | null;
}

export interface Rascunho extends RascunhoResumo {
  chatId: string;
  dados: DadosOrcamento;
}

export interface ProdutoAchado {
  codigo: string;
  descricao: string;
  unidade: string | null;
  preco: number | null;
  familia?: string;
  controlado?: boolean;
  portarias?: string[];
  viaSinonimo?: string | null;
  pontuacao?: number;
}

export interface TipoFormula {
  nome: string;
  codigo: string;
  categoria: 'manipulado' | 'acabado';
}

export const UNIDADES = ['MG', 'MCG', 'G', 'UI', '%', 'ML', 'UN', 'BIL', 'UTR', 'MEQ', 'GTS', 'UFC'];
