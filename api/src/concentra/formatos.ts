// Conversão das respostas da Concentra (campos DBF com espaços, textos "a@b@c") para objetos limpos.
import { chaveTelefone, dataAaaammdd, digitos, limpo } from '../comum/texto';

export interface ProdutoBusca {
  codigo: string;
  descricao: string;
  preco: number | null;
  unidade: string | null;
  /** Preço zero e sem unidade: costuma ser cadastro inativo. */
  suspeito: boolean;
}

/** "00000637@PARACETAMOL@0.6831270803@G" */
export function produtoDeDescricao(texto: string): ProdutoBusca | null {
  const [codigo, descricao, preco, unidade] = String(texto ?? '').split('@');
  if (!limpo(codigo) || !limpo(descricao)) return null;
  const valor = Number(preco);
  const un = limpo(unidade);
  return {
    codigo: codigo.trim(),
    descricao: descricao.trim(),
    preco: Number.isFinite(valor) ? valor : null,
    unidade: un,
    suspeito: (!Number.isFinite(valor) || valor === 0) && !un,
  };
}

export interface FormulaF9 {
  nome: string;
  preco: number | null;
}

/** "CAPSULA ANTIOXIDANTE@0.00" */
export function formulaF9(texto: string): FormulaF9 | null {
  const i = String(texto ?? '').lastIndexOf('@');
  const nome = limpo(i >= 0 ? texto.slice(0, i) : texto);
  if (!nome) return null;
  const valor = Number(i >= 0 ? texto.slice(i + 1) : NaN);
  return { nome, preco: Number.isFinite(valor) ? valor : null };
}

export interface ItemOrcamento {
  texto: string;
  nome: string;
  quantidade: number | null;
  unidade: string | null;
}

export interface Orcamento {
  numero: string;
  tipo: string | null;
  cliente: string | null;
  valor: number | null;
  vendedor: string | null;
  cpf: string | null;
  itens: ItemOrcamento[];
}

/** "MAGNESIO GLICINA 500.0000 MG" → nome, quantidade e unidade. */
export function itemOrcamento(texto: string): ItemOrcamento {
  const t = String(texto ?? '').trim();
  const m = t.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)\s*(\S+)?$/);
  if (!m) return { texto: t, nome: t, quantidade: null, unidade: null };
  return { texto: t, nome: m[1].trim(), quantidade: Number(m[2]), unidade: m[3] ?? null };
}

/** "R$ 1.234,50" ou "63.50" → número. */
export function valorMonetario(texto: unknown): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  let t = String(texto ?? '').replace(/[^\d,.-]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Orçamento da listagem (campos soltos + descricao) ou da busca (só descricao
 * "numero@tipo@cliente@valor@vendedor@cpf" e itens).
 */
export function orcamento(registro: Record<string, unknown>): Orcamento | null {
  const partes = String(registro.descricao ?? '').split('@');
  const numero = limpo(registro.numero) ?? limpo(partes[0]);
  if (!numero) return null;
  const itens = Array.isArray(registro.itens) ? registro.itens.map((i) => itemOrcamento(String(i))) : [];
  return {
    numero,
    tipo: limpo(registro.tipo) ?? limpo(partes[1]),
    cliente: limpo(registro.cliente) ?? limpo(partes[2]),
    valor: valorMonetario(registro.valor ?? partes[3]),
    vendedor: limpo(registro.vendedor) ?? limpo(partes[4]),
    cpf: limpo(registro.cpf) ?? limpo(partes[5]),
    itens,
  };
}

export interface ClienteConcentra {
  id: string;
  nome: string;
  telefones: string[];
  chavesTelefone: string[];
  cpf: string | null;
  email: string | null;
  endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };
  nascimento: string | null;
  sexo: string | null;
  ultimaCompra: Date | null;
  cadastro: Date | null;
}

/** Registro de listar_info_clientes_por_nome / _por_ultima_compra. */
export function cliente(r: Record<string, unknown>): ClienteConcentra | null {
  const id = limpo(r.id);
  const nome = limpo(r.nome);
  if (!id || !nome) return null;
  const ddd = digitos(String(r.ddd ?? '')).replace(/^0+/, '').slice(-2);
  const telefones: string[] = [];
  const chaves = new Set<string>();
  for (const campo of [r.cel, r.tel]) {
    const numero = digitos(String(campo ?? ''));
    if (numero.length < 8) continue;
    const completo = numero.length <= 9 && ddd ? ddd + numero : numero;
    telefones.push(completo);
    const chave = chaveTelefone(numero, ddd);
    if (chave) chaves.add(chave);
  }
  return {
    id,
    nome,
    telefones,
    chavesTelefone: [...chaves],
    cpf: limpo(r.cpf),
    email: limpo(r.mail),
    endereco: {
      logradouro: limpo(r.end),
      numero: limpo(r.num),
      complemento: limpo(r.compl),
      bairro: limpo(r.bai),
      cidade: limpo(r.cid),
      uf: limpo(r.uf),
      cep: limpo(r.cep),
    },
    nascimento: limpo(r.nasc),
    sexo: limpo(r.sexo),
    ultimaCompra: dataAaaammdd(r.ultco),
    cadastro: dataAaaammdd(r.dtinc),
  };
}

export interface PrescritorConcentra {
  chave: string;
  conselho: string;
  uf: string;
  numero: string;
  nome: string;
  especialidade: string | null;
}

/** Número do conselho sem zeros à esquerda: "0000134501" → "134501". */
export function numeroConselho(texto: unknown): string {
  return digitos(String(texto ?? '')).replace(/^0+/, '');
}

export function prescritor(r: Record<string, unknown>): PrescritorConcentra | null {
  const numero = numeroConselho(r.crm);
  const nome = limpo(r.descricao);
  if (!numero || !nome) return null;
  const conselho = limpo(r.conselho) ?? 'CRM';
  const uf = limpo(r.uf_conselho) ?? limpo(r.uf) ?? '';
  return { chave: `${conselho}-${uf}-${numero}`, conselho, uf, numero, nome, especialidade: limpo(r.especialidade) };
}

export interface ProdutoCadastro {
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

/** Registro de listar_info_produtos_por_data. */
export function produtoCadastro(r: Record<string, unknown>): ProdutoCadastro | null {
  const codigo = limpo(r.codigo);
  const descricao = limpo(r.descricao);
  if (!codigo || !descricao) return null;
  const portarias = r.portarias && typeof r.portarias === 'object' ? Object.entries(r.portarias).filter(([, v]) => v === true).map(([k]) => k) : [];
  const custo = Number(r.custo);
  const fator = Number(r.fator_de_preco);
  return {
    codigo,
    descricao,
    familia: limpo(r.familia) ?? '',
    unidade: limpo(r.unidade) ?? '',
    preco: Number.isFinite(custo) && Number.isFinite(fator) ? custo * fator : 0,
    controlado: r.controlado === true || portarias.length > 0,
    portarias,
    excluido: r.excluido === true,
    sinonimo: r.sinonimo === true,
    principal: limpo(r.prod_principal_sin),
  };
}
