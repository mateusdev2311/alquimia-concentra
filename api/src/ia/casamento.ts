// Leitura da IA → rascunho editável: casa cada ativo com o cadastro e marca o que precisa de atenção.
import { randomUUID } from 'node:crypto';
import { Achado } from '../catalogo/busca';
import { CatalogoService } from '../catalogo/catalogo.service';
import { ConfiguracoesService } from '../orcamento/configuracoes.service';
import { Componente, Formula, unidadeNormalizada } from '../orcamento/modelo';
import { ItemLido } from './leitura';

/** Abaixo disto o componente fica destacado para o atendente conferir. */
export const CONFIANCA_MINIMA = 0.7;

const PORTARIAS: Record<string, string> = {
  especial: 'controle especial',
  psicotropico: 'psicotrópico',
  entorpecente: 'entorpecente',
  imunossupressor: 'imunossupressor',
  antimicrobiano: 'antimicrobiano (retenção de receita)',
  policia_civil: 'Polícia Civil',
  policia_federal: 'Polícia Federal',
  exercito: 'Exército',
};

function alternativas(achados: Achado[]) {
  return achados.slice(0, 5).map((a) => ({
    codigo: a.item.codigo,
    descricao: a.item.descricao,
    unidade: a.item.unidade || null,
    pontuacao: Math.round(a.pontuacao * 100) / 100,
  }));
}

function alertaControlado(portarias: string[]): string {
  const nomes = portarias.map((p) => PORTARIAS[p] ?? p);
  return `Controlado${nomes.length ? ` (${nomes.join(', ')})` : ''}: confira a receita original e a retenção.`;
}

export class Casamento {
  constructor(
    private readonly catalogo: CatalogoService,
    private readonly configuracoes: ConfiguracoesService,
  ) {}

  async formula(item: ItemLido): Promise<Formula> {
    return item.tipo_item === 'acabado' ? this.acabado(item) : this.manipulado(item);
  }

  private async manipulado(item: ItemLido): Promise<Formula> {
    const tipo = await this.configuracoes.tipoDaForma(item.forma_farmaceutica, 'manipulado');
    const componentes = item.componentes.map((c): Componente => {
      const achados = this.catalogo.buscar(c.nome, { limite: 6, familias: ['00'] });
      const melhor = achados[0];
      const confianca = Math.min(c.confianca ?? 0, melhor?.pontuacao ?? 0);
      const alertas: string[] = [];
      if (!melhor) alertas.push('Não achei no cadastro: escolha o produto.');
      else if (confianca < CONFIANCA_MINIMA) alertas.push('Confira: leitura ou produto com pouca certeza.');
      if (melhor?.item.controlado) alertas.push(alertaControlado(melhor.item.portarias));
      if (c.dosagem == null) alertas.push('Dosagem não lida.');
      return {
        id: randomUUID(),
        lido: c.texto_original || c.nome,
        codigo: melhor?.item.codigo ?? null,
        nome: melhor?.item.descricao ?? c.nome,
        dosagem: c.dosagem,
        unidade: unidadeNormalizada(c.unidade),
        controlado: melhor?.item.controlado ?? false,
        portarias: melhor?.item.portarias ?? [],
        confianca: Math.round(confianca * 100) / 100,
        alternativas: alternativas(achados),
        alerta: alertas.join(' ') || null,
        sugerido: melhor?.item.codigo ?? null,
      };
    });
    const alertas: string[] = [];
    if (!tipo) alertas.push(`Forma farmacêutica "${item.forma_farmaceutica ?? 'não lida'}": escolha o tipo.`);
    else if (!tipo.codigo) alertas.push(`O tipo "${tipo.nome}" ainda não tem código (admin › Tipos).`);
    if (item.quantidade_total == null) alertas.push('QSP não lido.');
    if (item.observacao) alertas.push(item.observacao);
    return {
      id: randomUUID(),
      tipoItem: 'manipulado',
      forma: tipo?.nome ?? item.forma_farmaceutica,
      tipo: tipo?.codigo || null,
      qsp: item.quantidade_total,
      unidadeQsp: item.unidade_quantidade,
      dose: null,
      posologia: item.posologia,
      repete: 1,
      componentes,
      // O atendente escolhe a cápsula/excipiente (decisão da farmácia em 28/10/2026).
      excipiente: null,
      alertas,
      confianca: item.confianca,
    };
  }

  private async acabado(item: ItemLido): Promise<Formula> {
    const tipo = await this.configuracoes.tipoDaForma(null, 'acabado');
    const consulta = [item.nome_produto, item.apresentacao].filter(Boolean).join(' ');
    let achados = consulta ? this.catalogo.buscar(consulta, { limite: 6, apenasFamilias: ['10', '15'] }) : [];
    // Produto pronto que a farmácia também cadastra como matéria-prima em UN (ex.: "OMEPRAZOL 20MG 30CAP").
    if (!achados.length && consulta) achados = this.catalogo.buscar(consulta, { limite: 6 }).filter((a) => a.item.unidade === 'UN');
    const melhor = achados[0];
    const confianca = Math.min(item.confianca ?? 0, melhor?.pontuacao ?? 0);
    const alertas: string[] = [];
    if (!melhor) alertas.push('Produto acabado não encontrado no cadastro: avise o cliente ou escolha outro.');
    else if (confianca < CONFIANCA_MINIMA) alertas.push('Confira o produto e a apresentação.');
    if (melhor?.item.controlado) alertas.push(alertaControlado(melhor.item.portarias));
    if (item.observacao) alertas.push(item.observacao);
    return {
      id: randomUUID(),
      tipoItem: 'acabado',
      forma: tipo?.nome ?? null,
      tipo: tipo?.codigo || null,
      qsp: null,
      unidadeQsp: null,
      dose: null,
      posologia: item.posologia,
      repete: 1,
      quantidade: item.quantidade_embalagens ?? 1,
      componentes: [
        {
          id: randomUUID(),
          lido: consulta || null,
          codigo: melhor?.item.codigo ?? null,
          nome: melhor?.item.descricao ?? item.nome_produto,
          dosagem: null,
          unidade: 'UN',
          controlado: melhor?.item.controlado ?? false,
          portarias: melhor?.item.portarias ?? [],
          confianca: Math.round(confianca * 100) / 100,
          alternativas: alternativas(achados),
          alerta: null,
          sugerido: melhor?.item.codigo ?? null,
        },
      ],
      excipiente: null,
      alertas,
      confianca: item.confianca,
    };
  }
}
