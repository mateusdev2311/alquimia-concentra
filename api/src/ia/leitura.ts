// Leitura de receita (foto ou PDF) pela OpenAI, com saída em JSON de esquema fixo.

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

const texto = { type: ['string', 'null'] } as const;
const numero = { type: ['number', 'null'] } as const;

/** Esquema estrito (structured outputs): todo campo obrigatório, nulo quando não há. */
export const ESQUEMA_RECEITA = {
  type: 'object',
  additionalProperties: false,
  required: ['eh_receita', 'legivel', 'paciente', 'prescritor', 'conselho', 'numero_conselho', 'uf_conselho', 'data_receita', 'controle_especial', 'itens', 'observacoes'],
  properties: {
    eh_receita: { type: 'boolean', description: 'A imagem é uma receita/prescrição?' },
    legivel: { type: 'boolean', description: 'Dá para ler o essencial (itens e dosagens)?' },
    paciente: { ...texto, description: 'Nome do paciente como escrito.' },
    prescritor: { ...texto, description: 'Nome do médico/dentista/nutricionista.' },
    conselho: { ...texto, description: 'CRM, CRO, CRN, CRF, CRMV, COREN…' },
    numero_conselho: { ...texto, description: 'Número do registro, só dígitos.' },
    uf_conselho: { ...texto, description: 'UF do registro (SP, MG…).' },
    data_receita: { ...texto, description: 'Data da receita em DD/MM/AAAA.' },
    controle_especial: { type: 'boolean', description: 'Receituário de controle especial, notificação (amarela/azul/branca) ou substância da Portaria 344.' },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'tipo_item',
          'forma_farmaceutica',
          'quantidade_total',
          'unidade_quantidade',
          'posologia',
          'componentes',
          'nome_produto',
          'apresentacao',
          'quantidade_embalagens',
          'confianca',
          'observacao',
        ],
        properties: {
          tipo_item: { type: 'string', enum: ['manipulado', 'acabado'] },
          forma_farmaceutica: { ...texto, description: 'Manipulado: cápsula, creme, gel, loção, solução, shampoo, sachê, sublingual, sérum…' },
          quantidade_total: { ...numero, description: 'Manipulado: o QSP / quantidade total (ex.: 60 cápsulas, 30 g, 100 ml).' },
          unidade_quantidade: { ...texto, description: 'Unidade da quantidade total: caps, g, ml, saches, un.' },
          posologia: { ...texto, description: 'Modo de usar, como escrito.' },
          componentes: {
            type: 'array',
            description: 'Manipulado: cada ativo com a dose POR UNIDADE (por cápsula) ou a concentração (%). Acabado: vazio.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['nome', 'dosagem', 'unidade', 'texto_original', 'confianca'],
              properties: {
                nome: { type: 'string', description: 'Nome do ativo por extenso, sem abreviação (ex.: "Vitamina D3", "Ácido hialurônico").' },
                dosagem: numero,
                unidade: { ...texto, description: 'MG, MCG, G, UI, %, ML, UN, BIL (bilhões de UFC).' },
                texto_original: { type: 'string', description: 'A linha como está escrita na receita.' },
                confianca: { type: 'number', description: '0 a 1: certeza da leitura deste componente.' },
              },
            },
          },
          nome_produto: { ...texto, description: 'Acabado: nome comercial do produto.' },
          apresentacao: { ...texto, description: 'Acabado: apresentação (ex.: "60 cápsulas", "100 ml", "500 mg").' },
          quantidade_embalagens: { ...numero, description: 'Acabado: quantas caixas/frascos.' },
          confianca: { type: 'number', description: '0 a 1: certeza da leitura do item.' },
          observacao: { ...texto, description: 'Dúvida da leitura (letra ilegível, dose ambígua…).' },
        },
      },
    },
    observacoes: texto,
  },
} as const;

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

export interface Arquivo {
  base64: string;
  mimetype: string;
  nome: string;
}

/** Resposta da OpenAI (Responses API): o JSON está no primeiro "output_text". */
export function textoDaResposta(corpo: unknown): string | null {
  const saida = (corpo as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] })?.output;
  if (!Array.isArray(saida)) return null;
  for (const item of saida) {
    for (const parte of item.content ?? []) {
      if (parte.type === 'output_text' && typeof parte.text === 'string') return parte.text;
    }
  }
  return null;
}

/** Corpo da requisição: imagem vai como input_image; PDF como input_file. */
export function corpoOpenAi(modelo: string, arquivo: Arquivo): Record<string, unknown> {
  const dataUrl = `data:${arquivo.mimetype};base64,${arquivo.base64}`;
  const anexo =
    arquivo.mimetype === 'application/pdf'
      ? { type: 'input_file', filename: arquivo.nome || 'receita.pdf', file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl, detail: 'high' };
  return {
    model: modelo,
    instructions: INSTRUCOES,
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Leia esta receita e devolva os dados no formato pedido.' }, anexo] }],
    text: { format: { type: 'json_schema', name: 'receita', strict: true, schema: ESQUEMA_RECEITA } },
    store: false,
  };
}
