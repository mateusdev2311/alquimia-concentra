import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, Avatar, Carregando, Vazio } from '../../comum/componentes';
import { compacto, dinheiro, dinheiroCompacto, inteiro, percentual, variacao } from '../../comum/formato';
import { Icone, NomeIcone } from '../../comum/icones';
import { BarrasHorizontais, GraficoColunas } from './graficos';

interface Resumo {
  orcamentos: number;
  valor: number;
  ticketMedio: number | null;
  viaIa: number;
  percentualIa: number | null;
  taxaCorrecao: number | null;
  minutosMontagem: number | null;
}

interface Atendente {
  id: string | null;
  nome: string;
  orcamentos: number;
  valor: number;
  percentualIa: number | null;
  minutosMontagem: number | null;
  consultas: number;
  leituras: number;
}

interface DadosPainel {
  dias: number;
  atual: Resumo;
  anterior: Resumo;
  porDia: { dia: string; orcamentos: number; valor: number }[];
  atendentes: Atendente[];
  leituras: { total: number; erros: number; segundosMedios: number | null };
}

function Indicador({
  icone,
  rotulo,
  valor,
  atual,
  anterior,
  melhorQuandoSobe = true,
  rodape,
}: {
  icone: NomeIcone;
  rotulo: string;
  valor: string;
  atual?: number | null;
  anterior?: number | null;
  melhorQuandoSobe?: boolean;
  rodape?: string;
}) {
  const v = atual != null ? variacao(atual, anterior, melhorQuandoSobe) : null;
  return (
    <div class="kt-indicador">
      <div class="kt-indicador-topo">
        <span class="kt-indicador-icone">
          <Icone nome={icone} tamanho={16} />
        </span>
        <span class="kt-indicador-rotulo">{rotulo}</span>
      </div>
      <div class="kt-indicador-valor">{valor}</div>
      <div class="kt-indicador-rodape">
        {v && (
          <span class={`kt-delta ${v.bom == null ? 'kt-delta-neutro' : v.bom ? 'kt-delta-bom' : 'kt-delta-ruim'}`}>
            <Icone nome={v.direcao === 'sobe' ? 'sobe' : v.direcao === 'desce' ? 'desce' : 'igual'} tamanho={12} />
            {v.texto}
          </span>
        )}
        {rodape && <span class="kt-muted">{rodape}</span>}
      </div>
    </div>
  );
}

const minutos = (m: number | null) => (m == null ? '—' : m < 1 ? `${Math.round(m * 60)} s` : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min`);

/** Preenche os dias sem orçamento com zero (o gráfico precisa de todos os dias do período). */
function diasCompletos(dias: number, pontos: { dia: string; orcamentos: number; valor: number }[]) {
  const mapa = new Map(pontos.map((p) => [p.dia, p]));
  const saida: { dia: string; orcamentos: number; valor: number }[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
    saida.push(mapa.get(dia) ?? { dia, orcamentos: 0, valor: 0 });
  }
  return saida;
}

export function AbaPainel({ api }: { api: Api }) {
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setErro(null);
    api<DadosPainel>(`/v1/admin/painel?dias=${dias}`).then(setDados, (e) => setErro(mensagemDeErro(e)));
  }, [api, dias]);

  return (
    <>
      <div class="kt-filtros">
        <label class="kt-select">
          <Icone nome="calendario" />
          <select value={dias} onChange={(e) => setDias(Number((e.target as HTMLSelectElement).value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
        </label>
        <span class="kt-filtros-estado">Comparado com os {dias} dias anteriores</span>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && !erro && <Carregando />}
      {dados && (
        <>
          <div class="kt-indicadores">
            <Indicador icone="pilula" rotulo="Orçamentos pela integração" valor={inteiro(dados.atual.orcamentos)} atual={dados.atual.orcamentos} anterior={dados.anterior.orcamentos} />
            <Indicador icone="dinheiro" rotulo="Valor orçado" valor={dinheiroCompacto(dados.atual.valor)} atual={dados.atual.valor} anterior={dados.anterior.valor} />
            <Indicador icone="sacola" rotulo="Ticket médio" valor={dinheiro(dados.atual.ticketMedio)} atual={dados.atual.ticketMedio} anterior={dados.anterior.ticketMedio} />
            <Indicador
              icone="ia"
              rotulo="Montados pela IA"
              valor={percentual(dados.atual.percentualIa, 0)}
              rodape={`${inteiro(dados.atual.viaIa)} orçamentos`}
            />
            <Indicador
              icone="relogio"
              rotulo="Tempo de montagem (mediana)"
              valor={minutos(dados.atual.minutosMontagem)}
              atual={dados.atual.minutosMontagem}
              anterior={dados.anterior.minutosMontagem}
              melhorQuandoSobe={false}
            />
            <Indicador
              icone="check"
              rotulo="Itens corrigidos na revisão"
              valor={percentual(dados.atual.taxaCorrecao, 0)}
              rodape="dos componentes lidos pela IA"
              atual={dados.atual.taxaCorrecao}
              anterior={dados.anterior.taxaCorrecao}
              melhorQuandoSobe={false}
            />
            <Indicador
              icone="imagem"
              rotulo="Receitas lidas"
              valor={inteiro(dados.leituras.total)}
              rodape={`${dados.leituras.erros} com problema${dados.leituras.segundosMedios ? ` · ${Math.round(dados.leituras.segundosMedios)} s em média` : ''}`}
            />
          </div>

          <div class="kt-graficos">
            <GraficoColunas
              titulo="Orçamentos por dia"
              resumo={inteiro(dados.atual.orcamentos)}
              pontos={diasCompletos(dados.dias, dados.porDia).map((p) => ({ dia: p.dia, valor: p.orcamentos }))}
              formatar={(v) => `${inteiro(v)} orçamento${v === 1 ? '' : 's'}`}
              formatarEixo={(v) => (Number.isInteger(v) ? compacto(v) : v.toLocaleString('pt-BR'))}
            />
            <GraficoColunas
              titulo="Valor orçado por dia"
              resumo={dinheiro(dados.atual.valor)}
              pontos={diasCompletos(dados.dias, dados.porDia).map((p) => ({ dia: p.dia, valor: p.valor }))}
              formatar={(v) => dinheiro(v)}
              formatarEixo={(v) => dinheiroCompacto(v)}
            />
            <BarrasHorizontais
              titulo="Orçamentos por atendente"
              barras={dados.atendentes
                .filter((a) => a.orcamentos > 0)
                .map((a) => ({ rotulo: a.nome, valor: a.orcamentos, detalhe: `${dinheiro(a.valor)} · ${percentual(a.percentualIa, 0)} pela IA` }))}
              formatar={inteiro}
            />
          </div>

          <div class="kt-secao" style={{ marginTop: '24px' }}>
            <span class="kt-secao-icone">
              <Icone nome="usuarios" />
            </span>
            <div>
              <h2>Acompanhamento por atendente</h2>
              <p class="kt-muted">Orçamentos gravados pela integração e uso das consultas no período.</p>
            </div>
          </div>
          {dados.atendentes.length === 0 ? (
            <Vazio icone="usuarios" titulo="Ainda sem uso no período">
              Os números aparecem assim que os atendentes começarem a usar o cartão Concentra.
            </Vazio>
          ) : (
            <div class="kt-tabela-card kt-tabela-rolagem">
              <table class="kt-tabela">
                <thead>
                  <tr>
                    <th>Atendente</th>
                    <th class="kt-num">Orçamentos</th>
                    <th class="kt-num">Valor</th>
                    <th class="kt-num">Ticket médio</th>
                    <th class="kt-num">Pela IA</th>
                    <th class="kt-num">Montagem</th>
                    <th class="kt-num">Receitas lidas</th>
                    <th class="kt-num">Consultas</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.atendentes.map((a) => (
                    <tr key={a.id ?? a.nome}>
                      <td>
                        <span class="kt-pessoa">
                          <Avatar nome={a.nome} />
                          {a.nome}
                        </span>
                      </td>
                      <td class="kt-num">{inteiro(a.orcamentos)}</td>
                      <td class="kt-num">{dinheiro(a.valor)}</td>
                      <td class="kt-num">{a.orcamentos ? dinheiro(a.valor / a.orcamentos) : '—'}</td>
                      <td class="kt-num">{percentual(a.percentualIa, 0)}</td>
                      <td class="kt-num">{minutos(a.minutosMontagem)}</td>
                      <td class="kt-num">{inteiro(a.leituras)}</td>
                      <td class="kt-num">{inteiro(a.consultas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
