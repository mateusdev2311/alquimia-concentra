// Leitura de receita (foto ou PDF) pela IA da própria Kentro (elemento aiProcessFile de uma automação),
// com saída em JSON no formato abaixo. O serviço só recebe o JSON e casa com o cadastro.

export interface ComponenteLido {
  nome: string;
  dosagem: number | null;
  unidade: string | null;
  texto_original: string;
  confianca: number;
}

export interface ItemLido {
  tipo_item: 'manipulado' | 'acabado';
  forma_farmaceutica: string | null;
  quantidade_total: number | null;
  unidade_quantidade: string | null;
  posologia: string | null;
  componentes: ComponenteLido[];
  nome_produto: string | null;
  apresentacao: string | null;
  quantidade_embalagens: number | null;
  confianca: number;
  observacao: string | null;
}

export interface ReceitaLida {
  eh_receita: boolean;
  legivel: boolean;
  paciente: string | null;
  prescritor: string | null;
  conselho: string | null;
  numero_conselho: string | null;
  uf_conselho: string | null;
  data_receita: string | null;
  controle_especial: boolean;
  itens: ItemLido[];
  observacoes: string | null;
}

export const INSTRUCOES = `Você lê receitas médicas brasileiras para uma farmácia de manipulação montar o orçamento.
A leitura é conferida por um atendente antes de qualquer envio: NUNCA invente. Na dúvida, deixe nulo, baixe a "confianca" e explique em "observacao".

Regras:
- Cada item da receita vira um item. "Manipulado" é fórmula (vários ativos, "manipular", "q.s.p.", "fórmula", cápsulas com doses). "Acabado" é produto industrializado de marca (caixa, frasco pronto).
- Manipulado: cada ativo em "componentes", com a dose POR UNIDADE (por cápsula, por sachê, por dose) ou a concentração (%). Se a receita disser a dose total do frasco, explique em "observacao".
- "quantidade_total" é o q.s.p. / total (ex.: "60 cápsulas" → 60 e "caps"; "q.s.p. 30 g" → 30 e "g"). Se a receita disser "tomar 1 ao dia por 30 dias" sem total, calcule (30) e diga em "observacao".
- Escreva o nome do ativo por extenso e sem abreviação ("Vit D3" → "Vitamina D3", "Ác." → "Ácido"), mas guarde a linha original em "texto_original".
- Unidades: MG, MCG (µg), G, UI, %, ML, UN; bilhões de UFC (probióticos) → BIL.
- Excipiente, cápsula, base ("q.s.p. creme base") NÃO são componentes: são a forma farmacêutica.
- Receita de controle especial (notificação amarela/azul/branca, "receituário de controle especial", substâncias como benzodiazepínicos, anfetamínicos, sibutramina, isotretinoína, hormônios anabolizantes) → "controle_especial": true.
- Se não for uma receita (foto de outra coisa), "eh_receita": false e itens vazio.`;

/** Exemplo do formato, para a instrução (o aiProcessFile não aceita esquema; o JSON vem do texto). */
const EXEMPLO = {
  eh_receita: true,
  legivel: true,
  paciente: 'Nome do paciente ou null',
  prescritor: 'Nome do médico ou null',
  conselho: 'CRM',
  numero_conselho: '123456',
  uf_conselho: 'SP',
  data_receita: 'DD/MM/AAAA ou null',
  controle_especial: false,
  observacoes: null,
  itens: [
    {
      tipo_item: 'manipulado',
      forma_farmaceutica: 'cápsula',
      quantidade_total: 60,
      unidade_quantidade: 'caps',
      posologia: 'Tomar 1 cápsula ao dia',
      componentes: [{ nome: 'Vitamina D3', dosagem: 2000, unidade: 'UI', texto_original: 'Vit D3 2.000UI', confianca: 0.95 }],
      nome_produto: null,
      apresentacao: null,
      quantidade_embalagens: null,
      confianca: 0.9,
      observacao: null,
    },
    {
      tipo_item: 'acabado',
      forma_farmaceutica: null,
      quantidade_total: null,
      unidade_quantidade: null,
      posologia: 'Aplicar 1 ml 2x ao dia',
      componentes: [],
      nome_produto: 'Minoxidil 5%',
      apresentacao: '100 ml',
      quantidade_embalagens: 1,
      confianca: 0.85,
      observacao: null,
    },
  ],
};

/** Instrução do elemento aiProcessFile (copiada no admin e usada na automação criada pela integração). */
export function instrucaoKentro(): string {
  return `${INSTRUCOES}

Responda SOMENTE com um JSON neste formato exato (mesmas chaves; use null quando não houver; confianca de 0 a 1):
${JSON.stringify(EXEMPLO, null, 2)}`;
}

/**
 * O JSON da leitura como a automação entrega: objeto, texto JSON, ou texto com ```json … ```.
 * Devolve null se não der para entender (a automação ou a IA falhou).
 */
export function interpretarLeitura(valor: unknown): ReceitaLida | null {
  let obj: unknown = valor;
  if (typeof valor === 'string') {
    const texto = valor.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const inicio = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (inicio < 0 || fim <= inicio) return null;
    try {
      obj = JSON.parse(texto.slice(inicio, fim + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const r = obj as Partial<ReceitaLida>;
  const textoOuNulo = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const numeroOuNulo = (v: unknown) => {
    // "1.000,5" (pt-BR) e "0.95" (ponto decimal): o ponto só é milhar quando há vírgula.
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const confianca = (v: unknown) => Math.max(0, Math.min(1, numeroOuNulo(v) ?? 0.5));
  return {
    eh_receita: r.eh_receita !== false,
    legivel: r.legivel !== false,
    paciente: textoOuNulo(r.paciente),
    prescritor: textoOuNulo(r.prescritor),
    conselho: textoOuNulo(r.conselho),
    numero_conselho: textoOuNulo(r.numero_conselho != null ? String(r.numero_conselho) : null),
    uf_conselho: textoOuNulo(r.uf_conselho),
    data_receita: textoOuNulo(r.data_receita),
    controle_especial: r.controle_especial === true,
    observacoes: textoOuNulo(r.observacoes),
    itens: (Array.isArray(r.itens) ? r.itens : []).map((i) => ({
      tipo_item: i?.tipo_item === 'acabado' ? 'acabado' : 'manipulado',
      forma_farmaceutica: textoOuNulo(i?.forma_farmaceutica),
      quantidade_total: numeroOuNulo(i?.quantidade_total),
      unidade_quantidade: textoOuNulo(i?.unidade_quantidade),
      posologia: textoOuNulo(i?.posologia),
      componentes: (Array.isArray(i?.componentes) ? i.componentes : [])
        .filter((c) => c && textoOuNulo(c.nome))
        .map((c) => ({
          nome: String(c.nome).trim(),
          dosagem: numeroOuNulo(c.dosagem),
          unidade: textoOuNulo(c.unidade),
          texto_original: textoOuNulo(c.texto_original) ?? String(c.nome).trim(),
          confianca: confianca(c.confianca),
        })),
      nome_produto: textoOuNulo(i?.nome_produto),
      apresentacao: textoOuNulo(i?.apresentacao),
      quantidade_embalagens: numeroOuNulo(i?.quantidade_embalagens),
      confianca: confianca(i?.confianca),
      observacao: textoOuNulo(i?.observacao),
    })),
  };
}
