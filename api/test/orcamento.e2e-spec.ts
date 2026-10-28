import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { CatalogoService } from '../src/catalogo/catalogo.service';
import { CHAVE_ADMIN, CHAVE_ATENDIMENTO, criarAppDeTeste, fetchFalso, limparBanco } from './app';

const prisma = new PrismaClient();
const H = { 'X-Alquimia-Chave': CHAVE_ATENDIMENTO, 'X-Kentro-Usuario-Id': '7', 'X-Kentro-Usuario-Nome': encodeURIComponent('Thaís') };

const DADOS = {
  clienteId: null,
  paciente: 'MARIA TESTE',
  fone: '5511991234567',
  prescritor: 'DR FULANO',
  crm: '134501',
  formulas: [
    {
      id: 'f1',
      tipoItem: 'manipulado',
      forma: 'Cápsulas',
      tipo: null,
      qsp: 60,
      unidadeQsp: 'caps',
      dose: null,
      posologia: null,
      repete: 1,
      componentes: [{ id: 'c1', lido: null, codigo: '00101477', nome: 'VIT D3', dosagem: 2000, unidade: 'UI' }],
      excipiente: null,
    },
  ],
};

let gerar: () => unknown;
const falso = fetchFalso({
  concentra: (funcao, corpo) => {
    if (funcao === 'gerar_orcamento') return gerar();
    if (funcao === 'listar_orcamento_por_numero' && corpo.orcamento === '') {
      return [
        { numero: '0964601', tipo: 'Cápsulas', cliente: 'MARIA TESTE', valor: 142.9, vendedor: 'X', cpf: '', descricao: '', itens: [] },
        { numero: '0964590', tipo: 'Cápsulas', cliente: 'MARIA TESTE', valor: 80, vendedor: 'X', cpf: '', descricao: '', itens: [] },
      ];
    }
    return [{ erro: 'Nenhum registro encontrado para: X' }];
  },
  openai: () => ({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              eh_receita: true,
              legivel: true,
              paciente: 'Joãozinho Teste',
              prescritor: 'Dra Beltrana',
              conselho: 'CRM',
              numero_conselho: '0000134501',
              uf_conselho: 'SP',
              data_receita: null,
              controle_especial: false,
              observacoes: null,
              itens: [
                {
                  tipo_item: 'manipulado',
                  forma_farmaceutica: 'cápsula',
                  quantidade_total: 30,
                  unidade_quantidade: 'caps',
                  posologia: '1 ao dia',
                  componentes: [{ nome: 'Vitamina D3', dosagem: 2000, unidade: 'ui', texto_original: 'Vit D3 2.000UI', confianca: 0.95 }],
                  nome_produto: null,
                  apresentacao: null,
                  quantidade_embalagens: null,
                  confianca: 0.9,
                  observacao: null,
                },
              ],
            }),
          },
        ],
      },
    ],
  }),
});

const chamadasGerar = () => falso.chamadas.filter((c) => c.corpo.funcao === 'gerar_orcamento');

let app: INestApplication;

beforeAll(async () => {
  app = await criarAppDeTeste({}, { fetch: falso.fetch });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limparBanco(prisma);
  falso.chamadas.length = 0;
  gerar = () => [{ paciente: 'MARIA TESTE', fone: '11991234567', prescritor: 'DR FULANO', crm: '134501', items: [], valor_liquido: 142.9, valor_bruto: 158 }];
});

async function rascunhoCompleto(): Promise<string> {
  const criado = await request(app.getHttpServer()).post('/v1/rascunhos').set(H).send({ chatId: '55', telefone: '5511991234567' }).expect(201);
  await request(app.getHttpServer()).put(`/v1/rascunhos/${criado.body.id}`).set(H).send({ dados: DADOS }).expect(200);
  return criado.body.id;
}

describe('acesso', () => {
  it('recusa sem chave e separa a chave de admin', async () => {
    await request(app.getHttpServer()).get('/v1/status').expect(401);
    await request(app.getHttpServer()).get('/v1/admin/status').set(H).expect(403);
    await request(app.getHttpServer()).get('/v1/admin/status').set({ 'X-Alquimia-Chave': CHAVE_ADMIN }).expect(200);
  });

  it('"não encontrado" da Concentra (HTTP 200 + erro) vira lista vazia', async () => {
    const r = await request(app.getHttpServer()).get('/v1/orcamentos?busca=FULANA').set(H).expect(200);
    expect(r.body.orcamentos).toEqual([]);
  });
});

describe('envio ao Concentra', () => {
  it('exige a confirmação do atendente', async () => {
    const id = await rascunhoCompleto();
    await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: false }).expect(400);
    expect(chamadasGerar()).toHaveLength(0);
  });

  it('grava uma vez, acha o número pelo valor e monta a mensagem', async () => {
    const id = await rascunhoCompleto();
    const r = await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: true }).expect(201);
    expect(r.body.resultado).toMatchObject({ numero: '0964601', valorLiquido: 142.9, valorBruto: 158 });
    expect(r.body.resultado.mensagem).toContain('nº 0964601');
    expect(chamadasGerar()).toHaveLength(1);
    expect(chamadasGerar()[0].corpo).toMatchObject({ paciente: 'MARIA TESTE', fone: '11991234567', crm: '134501' });
    expect(chamadasGerar()[0].corpo).not.toHaveProperty('convenio');

    const enviado = await prisma.orcamentoEnviado.findFirstOrThrow();
    expect(enviado).toMatchObject({ numero: '0964601', usuarioId: '7', usuarioNome: 'Thaís', formulas: 1, componentes: 1, origem: 'manual' });

    // De novo: não grava outra vez.
    await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: true }).expect(409);
    expect(chamadasGerar()).toHaveLength(1);
  });

  it('sem resposta da Concentra: não repete e bloqueia o reenvio sem "forçar"', async () => {
    const id = await rascunhoCompleto();
    gerar = () => 'cair';
    const r = await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: true }).expect(503);
    expect(r.body.erro.codigo).toBe('ENVIO_INCERTO');
    expect(chamadasGerar()).toHaveLength(1);

    gerar = () => [{ valor_liquido: 142.9, valor_bruto: 142.9 }];
    const bloqueado = await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: true }).expect(409);
    expect(bloqueado.body.erro.codigo).toBe('ENVIO_INCERTO');
    expect(chamadasGerar()).toHaveLength(1);

    await request(app.getHttpServer()).post(`/v1/rascunhos/${id}/enviar`).set(H).send({ confirmado: true, forcar: true }).expect(201);
    expect(chamadasGerar()).toHaveLength(2);
  });

  it('orçamento incompleto não chega à Concentra', async () => {
    const criado = await request(app.getHttpServer()).post('/v1/rascunhos').set(H).send({ chatId: '56' }).expect(201);
    const r = await request(app.getHttpServer()).post(`/v1/rascunhos/${criado.body.id}/enviar`).set(H).send({ confirmado: true }).expect(422);
    expect(r.body.erros.length).toBeGreaterThan(0);
    expect(chamadasGerar()).toHaveLength(0);
  });
});

describe('receita → orçamento', () => {
  it('lê a receita, casa com o cadastro e o prescritor, e deixa pronto para revisar', async () => {
    await prisma.produto.createMany({
      data: [
        { codigo: '00101477', descricao: 'VIT D3 (DIL.P/CAPSULA)', familia: '00', unidade: 'G', preco: 1, controlado: false, portarias: [], excluido: false, sinonimo: false },
        { codigo: '00050337', descricao: 'VIT D3 PURA(P/NOTA FISCAL)', familia: '00', unidade: 'G', preco: 1, controlado: false, portarias: [], excluido: false, sinonimo: false },
      ],
    });
    await prisma.prescritor.create({ data: { chave: 'CRM-SP-134501', conselho: 'CRM', uf: 'SP', numero: '134501', nome: 'DRA BELTRANA CADASTRADA' } });
    await app.get(CatalogoService).recarregar();

    const r = await request(app.getHttpServer())
      .post('/v1/rascunhos/ler-receita')
      .set(H)
      .send({ chatId: '57', telefone: '5511991234567', nomeContato: 'Mãe do Joãozinho', arquivo: { base64: Buffer.from('jpg').toString('base64'), mimetype: 'image/jpeg', referencia: 'f1' } })
      .expect(201);
    expect(r.body.status).toBe('lendo');

    let rascunho = r.body;
    for (let i = 0; i < 50 && rascunho.status === 'lendo'; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      rascunho = (await request(app.getHttpServer()).get(`/v1/rascunhos/${r.body.id}`).set(H)).body;
    }
    expect(rascunho.status).toBe('pronto');
    const [formula] = rascunho.dados.formulas;
    expect(formula).toMatchObject({ tipoItem: 'manipulado', forma: 'Cápsulas', qsp: 30 });
    expect(formula.componentes[0]).toMatchObject({ codigo: '00101477', dosagem: 2000, unidade: 'UI', lido: 'Vit D3 2.000UI' });
    expect(rascunho.dados).toMatchObject({ prescritor: 'DRA BELTRANA CADASTRADA', crm: '134501', paciente: 'JOAOZINHO TESTE' });

    // A mesma foto de novo não gera outra leitura.
    const repetida = await request(app.getHttpServer())
      .post('/v1/rascunhos/ler-receita')
      .set(H)
      .send({ chatId: '57', arquivo: { base64: 'eA==', mimetype: 'image/jpeg', referencia: 'f1' } })
      .expect(201);
    expect(repetida.body.id).toBe(r.body.id);
  });
});
