import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../comum/prisma.service';
import { normalizar } from '../comum/texto';
import { MODELO_PADRAO } from './mensagem';

export interface TipoFormula {
  /** Nome como aparece no Concentra (listagem de orçamentos). */
  nome: string;
  /** Código para o campo `tipo` do gerar_orcamento (ex.: "010100"). Vazio até a Concentra informar. */
  codigo: string;
  categoria: 'manipulado' | 'acabado';
  /** Palavras que a IA usa para a forma farmacêutica e que caem neste tipo. */
  apelidos: string[];
}

/** Os 25 tipos vistos nos orçamentos da Alquimia (out/2026). Os códigos vêm da Concentra (pendente). */
export const TIPOS_PADRAO: TipoFormula[] = [
  { nome: 'Cápsulas', codigo: '', categoria: 'manipulado', apelidos: ['CAPSULA', 'CAPSULAS', 'CAPS', 'CP', 'CAPSULA GELATINOSA', 'CAPSULA VEGETAL'] },
  { nome: 'Creme', codigo: '', categoria: 'manipulado', apelidos: ['CREME', 'CREME HIDRATANTE', 'CREME FACIAL'] },
  { nome: 'Gel', codigo: '', categoria: 'manipulado', apelidos: ['GEL', 'GEL CREME'] },
  { nome: 'Serun/transder', codigo: '', categoria: 'manipulado', apelidos: ['SERUM', 'SERUN', 'TRANSDERMICO', 'GEL TRANSDERMICO'] },
  { nome: 'Sache Interno', codigo: '', categoria: 'manipulado', apelidos: ['SACHE', 'SACHES', 'PO', 'PO PARA SOLUCAO ORAL'] },
  { nome: 'Solução', codigo: '', categoria: 'manipulado', apelidos: ['SOLUCAO', 'SOLUCAO ORAL', 'SOLUCAO TOPICA', 'TONICO'] },
  { nome: 'Solução 2', codigo: '', categoria: 'manipulado', apelidos: [] },
  { nome: 'SUSPENSAO', codigo: '', categoria: 'manipulado', apelidos: ['SUSPENSAO', 'SUSPENSAO ORAL'] },
  { nome: 'SUB-LINGUAL CP', codigo: '', categoria: 'manipulado', apelidos: ['SUBLINGUAL', 'SUB LINGUAL', 'COMPRIMIDO SUBLINGUAL', 'TABLETE SUBLINGUAL'] },
  { nome: 'SHAMPOO', codigo: '', categoria: 'manipulado', apelidos: ['SHAMPOO', 'XAMPU'] },
  { nome: 'Loção', codigo: '', categoria: 'manipulado', apelidos: ['LOCAO', 'LOCAO CAPILAR', 'LOCAO HIDRATANTE'] },
  { nome: 'Loção 2', codigo: '', categoria: 'manipulado', apelidos: [] },
  { nome: 'Pomada', codigo: '', categoria: 'manipulado', apelidos: ['POMADA', 'UNGUENTO'] },
  { nome: 'ESMALTE', codigo: '', categoria: 'manipulado', apelidos: ['ESMALTE', 'BASE PARA UNHAS'] },
  { nome: 'Spray', codigo: '', categoria: 'manipulado', apelidos: ['SPRAY', 'SPRAY NASAL', 'SPRAY ORAL'] },
  { nome: 'Óvulos', codigo: '', categoria: 'manipulado', apelidos: ['OVULO', 'OVULOS', 'OVULO VAGINAL'] },
  { nome: 'Xarope', codigo: '', categoria: 'manipulado', apelidos: ['XAROPE'] },
  { nome: 'Sabonete', codigo: '', categoria: 'manipulado', apelidos: ['SABONETE', 'SABONETE LIQUIDO'] },
  { nome: 'Subst. pura pó', codigo: '', categoria: 'manipulado', apelidos: ['SUBSTANCIA PURA', 'PO PURO'] },
  { nome: 'Subst.pura líq.', codigo: '', categoria: 'manipulado', apelidos: ['LIQUIDO PURO'] },
  { nome: 'OMEPRAZOL', codigo: '', categoria: 'manipulado', apelidos: [] },
  { nome: 'Produto Entrega', codigo: '', categoria: 'acabado', apelidos: [] },
  { nome: 'Produto balcão', codigo: '', categoria: 'acabado', apelidos: ['PRODUTO', 'INDUSTRIALIZADO'] },
  { nome: 'Cáps. Prontas', codigo: '', categoria: 'acabado', apelidos: [] },
  { nome: 'Prod. Convenio', codigo: '', categoria: 'acabado', apelidos: [] },
];

export interface Configuracoes {
  modeloMensagem: string;
  tipos: TipoFormula[];
  /** Tipo usado para produto acabado quando a IA não sabe dizer qual. */
  tipoAcabadoPadrao: string;
}

const PADRAO: Configuracoes = { modeloMensagem: MODELO_PADRAO, tipos: TIPOS_PADRAO, tipoAcabadoPadrao: 'Produto balcão' };

@Injectable()
export class ConfiguracoesService {
  private cache: Configuracoes | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ler(): Promise<Configuracoes> {
    if (this.cache) return this.cache;
    const linhas = await this.prisma.configuracao.findMany();
    const valores = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
    this.cache = {
      modeloMensagem: typeof valores.modeloMensagem === 'string' ? valores.modeloMensagem : PADRAO.modeloMensagem,
      tipos: Array.isArray(valores.tipos) ? (valores.tipos as unknown as TipoFormula[]) : PADRAO.tipos,
      tipoAcabadoPadrao: typeof valores.tipoAcabadoPadrao === 'string' ? valores.tipoAcabadoPadrao : PADRAO.tipoAcabadoPadrao,
    };
    return this.cache;
  }

  async gravar(parcial: Partial<Configuracoes>): Promise<Configuracoes> {
    for (const [chave, valor] of Object.entries(parcial)) {
      if (valor === undefined) continue;
      await this.prisma.configuracao.upsert({
        where: { chave },
        create: { chave, valor: valor as Prisma.InputJsonValue },
        update: { valor: valor as Prisma.InputJsonValue },
      });
    }
    this.cache = null;
    return this.ler();
  }

  /** Forma farmacêutica (texto livre da IA ou do atendente) → tipo do Concentra. */
  async tipoDaForma(forma: string | null | undefined, categoria: 'manipulado' | 'acabado'): Promise<TipoFormula | null> {
    const { tipos, tipoAcabadoPadrao } = await this.ler();
    if (categoria === 'acabado') return tipos.find((t) => t.nome === tipoAcabadoPadrao) ?? tipos.find((t) => t.categoria === 'acabado') ?? null;
    const alvo = normalizar(forma);
    if (!alvo) return null;
    const candidatos = tipos.filter((t) => t.categoria === 'manipulado');
    return (
      candidatos.find((t) => normalizar(t.nome) === alvo) ??
      candidatos.find((t) => t.apelidos.some((a) => normalizar(a) === alvo)) ??
      candidatos.find((t) => t.apelidos.some((a) => alvo.startsWith(normalizar(a)))) ??
      null
    );
  }
}
