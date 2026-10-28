import { IndiceCatalogo, ItemCatalogo, tokens } from '../src/catalogo/busca';
import { chaveTelefone, normalizar } from '../src/comum/texto';
import { mensagemDeErro } from '../src/concentra/concentra.client';
import { cliente, formulaF9, itemOrcamento, orcamento, produtoCadastro, produtoDeDescricao, valorMonetario } from '../src/concentra/formatos';
import { MODELO_PADRAO, renderizar, valoresDaMensagem } from '../src/orcamento/mensagem';
import { corpoGerarOrcamento, DadosOrcamento, unidadeNormalizada, validar } from '../src/orcamento/modelo';

describe('telefone', () => {
  it('casa o número do WhatsApp com o cadastro com e sem o nono dígito', () => {
    expect(chaveTelefone('5511991234567')).toBe('1191234567');
    expect(chaveTelefone('91234567', '011')).toBe('1191234567');
    expect(chaveTelefone('991234567', '11')).toBe('1191234567');
    expect(chaveTelefone('(11) 99123-4567')).toBe('1191234567');
  });

  it('não inventa chave sem DDD', () => {
    expect(chaveTelefone('91234567')).toBeNull();
    expect(chaveTelefone('123')).toBeNull();
  });
});

describe('formatos da Concentra', () => {
  it('lê "codigo@descricao@preco@unidade" e sinaliza cadastro zerado', () => {
    expect(produtoDeDescricao('00000637@PARACETAMOL@0.6831270803@G')).toEqual({
      codigo: '00000637',
      descricao: 'PARACETAMOL',
      preco: 0.6831270803,
      unidade: 'G',
      suspeito: false,
    });
    expect(produtoDeDescricao('00002859@PARACETAMOL@0.0000000000@')?.suspeito).toBe(true);
  });

  it('lê a fórmula F9 e o item de orçamento', () => {
    expect(formulaF9('CAPSULA ANTIOXIDANTE@0.00')).toEqual({ nome: 'CAPSULA ANTIOXIDANTE', preco: 0 });
    expect(itemOrcamento('MAGNESIO GLICINA 500.0000 MG')).toEqual({ texto: 'MAGNESIO GLICINA 500.0000 MG', nome: 'MAGNESIO GLICINA', quantidade: 500, unidade: 'MG' });
  });

  it('lê o orçamento da listagem e o da busca por número', () => {
    const lista = orcamento({ numero: '0963181', tipo: 'Gel', cliente: 'FULANA', valor: 53.5, vendedor: 'THAIS', cpf: '', descricao: 'x', itens: ['AC GLICOLICO 10.0000 %'] });
    expect(lista).toMatchObject({ numero: '0963181', tipo: 'Gel', valor: 53.5, cpf: null });
    const busca = orcamento({ descricao: '0964588@Cápsulas@FULANA@63.50@THAIS@', itens: [] });
    expect(busca).toMatchObject({ numero: '0964588', tipo: 'Cápsulas', cliente: 'FULANA', valor: 63.5 });
    expect(valorMonetario('R$ 1.234,50')).toBe(1234.5);
  });

  it('monta o cliente com os telefones do DDD e as chaves de busca', () => {
    const c = cliente({ id: '000019', nome: 'FULANA DE TAL ', tel: '45678901 ', cel: '', ddd: '011', ultco: '20261021', cpf: '' });
    expect(c?.telefones).toEqual(['1145678901']);
    expect(c?.chavesTelefone).toEqual(['1145678901']);
    expect(c?.ultimaCompra?.toISOString().slice(0, 10)).toBe('2026-10-21');
    expect(c?.cpf).toBeNull();
  });

  it('calcula o preço do cadastro como custo × fator e lista as portarias marcadas', () => {
    const p = produtoCadastro({ codigo: '00101477', descricao: 'VIT D3', familia: '00', unidade: 'G  ', custo: 2, fator_de_preco: 3.5, portarias: { especial: true, psicotropico: false }, controlado: false, excluido: false, sinonimo: false, prod_principal_sin: '        ' });
    expect(p).toMatchObject({ preco: 7, unidade: 'G', controlado: true, portarias: ['especial'], principal: null });
  });

  it('reconhece o erro em HTTP 200, com ou sem lista em volta', () => {
    expect(mensagemDeErro([{ erro: 'Produto não encontrado' }])).toBe('Produto não encontrado');
    expect(mensagemDeErro({ erro: 'Acesso não autorizado' })).toBe('Acesso não autorizado');
    expect(mensagemDeErro([{ descricao: 'x' }])).toBeNull();
  });
});

describe('busca no cadastro', () => {
  const item = (codigo: string, descricao: string, extra: Partial<ItemCatalogo> = {}): ItemCatalogo => ({
    codigo,
    descricao,
    familia: '00',
    unidade: 'G',
    preco: 1,
    controlado: false,
    portarias: [],
    excluido: false,
    sinonimo: false,
    principal: null,
    ...extra,
  });
  const indice = new IndiceCatalogo();
  indice.carregar([
    item('1', 'VIT D3 (DIL.P/CAPSULA)'),
    item('2', 'VIT D3 PURA(P/NOTA FISCAL)'),
    item('3', 'GEL BASE (P/ ACIDO GLICOLICO)'),
    item('4', 'AC GLICOLICO', { unidade: 'ML' }),
    item('5', 'MAGNESIO GLICINA', { sinonimo: true, principal: '6' }),
    item('6', 'MAGNESIO QUELATO BUFFERED(USAR ESSE)'),
    item('7', 'VITAMINA C ANTIGA', { excluido: true }),
  ]);

  it('expande abreviações e junta letra + número', () => {
    expect(tokens('Vit. D 3')).toEqual(['VITAMINA', 'D3']);
    expect(tokens('Ác. hialurônico')).toEqual(['ACIDO', 'HIALURONICO']);
    expect(tokens('MAGNESIO 50 MG')).toEqual(['MAGNESIO', '50', 'MG']);
  });

  it('prefere o produto para receita ao "para nota fiscal"', () => {
    expect(indice.buscar('vitamina d3')[0].item.codigo).toBe('1');
  });

  it('não deixa a observação entre parênteses vencer o nome', () => {
    expect(indice.buscar('ácido glicólico')[0].item.codigo).toBe('4');
  });

  it('troca o sinônimo pelo produto principal', () => {
    const [a] = indice.buscar('magnésio glicina');
    expect(a.item.codigo).toBe('6');
    expect(a.viaSinonimo).toBe('MAGNESIO GLICINA');
  });

  it('ignora excluídos', () => {
    expect(indice.buscar('vitamina c').some((a) => a.item.codigo === '7')).toBe(false);
  });
});

describe('orçamento', () => {
  const dados = (): DadosOrcamento => ({
    clienteId: null,
    paciente: 'Maria da Silva',
    fone: '5511991234567',
    prescritor: 'Dr Fulano',
    crm: '0000134501',
    formulas: [
      {
        id: 'f1',
        tipoItem: 'manipulado',
        forma: 'Cápsulas',
        tipo: '010100',
        qsp: 60,
        unidadeQsp: 'caps',
        dose: null,
        posologia: 'tomar 1 ao dia',
        repete: null,
        componentes: [{ id: 'c1', lido: 'Vit D3 2000UI', codigo: '00101477', nome: 'VIT D3', dosagem: 2000, unidade: 'UI' }],
        excipiente: { codigo: '00000968', nome: 'CAPSULA 0 INCOLOR', dosagem: null, unidade: 'UN' },
      },
      {
        id: 'f2',
        tipoItem: 'acabado',
        forma: 'Produto balcão',
        tipo: null,
        qsp: null,
        unidadeQsp: null,
        dose: null,
        posologia: null,
        repete: 1,
        quantidade: 2,
        componentes: [{ id: 'c2', lido: null, codigo: '10000219', nome: 'MINOXIDIL A 5% 100ML', dosagem: null, unidade: 'UN' }],
        excipiente: null,
      },
    ],
  });

  it('monta o corpo do gerar_orcamento como a documentação pede', () => {
    const corpo = corpoGerarOrcamento(dados());
    expect(corpo).toEqual({
      paciente: 'MARIA DA SILVA',
      fone: '11991234567',
      prescritor: 'DR FULANO',
      crm: '134501',
      formulas: [
        {
          qsp: 60,
          tipo: '010100',
          dose: 0,
          posologia: 'TOMAR 1 AO DIA',
          repete: 1,
          componentes: [{ nome: 'VIT D3', codigo: '00101477', dosagem: 2000, unidade: 'UI' }],
          excipiente: { codigo: '00000968', nome: 'CAPSULA 0 INCOLOR', dosagem: 60, unidade: 'UN', descricao: 'CAPSULA 0 INCOLOR' },
        },
        {
          qsp: 2,
          dose: 0,
          posologia: 'USO CONFORME PRESCRIÇÃO',
          repete: 1,
          componentes: [{ nome: 'MINOXIDIL A 5% 100ML', codigo: '10000219', dosagem: 2, unidade: 'UN' }],
        },
      ],
    });
    expect(corpo).not.toHaveProperty('convenio');
  });

  it('aponta o que falta antes de enviar', () => {
    const d = dados();
    d.formulas[0].componentes[0].codigo = null;
    d.formulas[0].qsp = null;
    d.crm = '';
    const erros = validar(d);
    expect(erros).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CRM'),
        expect.stringContaining('QSP'),
        expect.stringContaining('escolha o produto no cadastro'),
      ]),
    );
    expect(validar(dados())).toEqual([]);
  });

  it('normaliza unidades escritas por extenso', () => {
    expect(unidadeNormalizada('mcg')).toBe('MCG');
    expect(unidadeNormalizada('miligramas')).toBe('MG');
    expect(unidadeNormalizada('bilhões')).toBe('BIL');
  });

  it('renderiza o modelo da mensagem, escondendo a seção sem número', () => {
    const valores = valoresDaMensagem({ dados: dados(), numero: null, valorLiquido: 142.9, valorBruto: 158, atendente: 'Thais' });
    const texto = renderizar(MODELO_PADRAO, valores);
    expect(texto).toContain('Olá, Maria!');
    expect(texto).not.toContain('nº');
    expect(texto).toContain('• Vit D3 2.000 UI');
    expect(texto).toContain('*2. Minoxidil A 5% 100ml* — 2 un.');
    expect(texto.replace(/ /g, ' ')).toContain('R$ 142,90');
    expect(renderizar('{{#numero}}nº {{numero}}{{/numero}} {{desconhecida}}', { ...valores, numero: '0964601' })).toBe('nº 0964601 {{desconhecida}}');
  });

  it('normaliza nomes como a Concentra', () => {
    expect(normalizar('  Ácido   hialurônico ')).toBe('ACIDO HIALURONICO');
  });
});
