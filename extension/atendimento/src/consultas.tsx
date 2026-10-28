import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Secao, Vazio } from '../../comum/componentes';
import { dinheiro } from '../../comum/formato';
import type { Contexto } from './app';
import { ListaOrcamentos } from './cliente';
import { BuscaProduto } from './produto';
import type { Orcamento, ProdutoAchado } from './tipos';

type Sub = 'receita' | 'orcamentos' | 'produtos' | 'f9' | 'prescritores';

const SUBS: { id: Sub; rotulo: string }[] = [
  { id: 'receita', rotulo: 'Receita' },
  { id: 'orcamentos', rotulo: 'Orçamentos' },
  { id: 'produtos', rotulo: 'Produtos' },
  { id: 'f9', rotulo: 'Fórmulas F9' },
  { id: 'prescritores', rotulo: 'Prescritores' },
];

type Estado<T> = { tipo: 'parado' } | { tipo: 'buscando' } | { tipo: 'erro'; mensagem: string } | { tipo: 'ok'; dados: T };

function useBusca<T>() {
  const [estado, setEstado] = useState<Estado<T>>({ tipo: 'parado' });
  const rodar = async (fn: () => Promise<T>) => {
    setEstado({ tipo: 'buscando' });
    try {
      setEstado({ tipo: 'ok', dados: await fn() });
    } catch (e) {
      setEstado({ tipo: 'erro', mensagem: mensagemDeErro(e) });
    }
  };
  return [estado, rodar] as const;
}

function Situacao<T>({ estado }: { estado: Estado<T> }) {
  if (estado.tipo === 'buscando') return <Carregando texto="Consultando o Concentra…" />;
  if (estado.tipo === 'erro') return <Aviso tipo="erro">{estado.mensagem}</Aviso>;
  return null;
}

interface ComponenteReceita {
  cod?: string;
  descricao?: string;
  qtd?: number;
  unidade?: string;
  controlado?: boolean;
}

type Receita = Record<string, unknown> & { componentes?: ComponenteReceita[] };

const CAMPOS_RECEITA: [string, string][] = [
  ['nome_paciente', 'Paciente'],
  ['fone_paciente', 'Telefone'],
  ['prescritor', 'Prescritor'],
  ['crm', 'CRM'],
  ['data', 'Data'],
  ['tipo_formula', 'Tipo'],
  ['qsp', 'QSP'],
  ['unidade', 'Unidade'],
  ['posologia', 'Posologia'],
  ['nome_vendedor', 'Vendedor'],
  ['desc_confirmador', 'Confirmador'],
  ['descricao_fil', 'Filial'],
  ['data_validade', 'Validade'],
];

function ConsultaReceita({ ctx }: { ctx: Contexto }) {
  const hoje = new Date();
  const [numero, setNumero] = useState('');
  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1).padStart(2, '0'));
  const [dados, buscarDados] = useBusca<Receita>();
  const [imagem, buscarImagem] = useBusca<{ mimetype: string; base64: string }>();
  const corpo = () => ({ receita: numero.trim(), ano, mes });
  const valido = numero.trim().length >= 6 && numero.trim().length <= 7 && /^\d{4}$/.test(ano) && /^\d{2}$/.test(mes);

  return (
    <Secao icone="formulario" titulo="Receita no Concentra" descricao="Número da receita (6 ou 7 caracteres), ano e mês.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valido) buscarDados(async () => (await ctx.api<{ receita: Receita }>('/v1/receitas/consultar', { method: 'POST', body: corpo() })).receita);
        }}
      >
        <div class="kt-grade-3">
          <label class="kt-campo">
            <span>Número</span>
            <input value={numero} maxLength={7} onInput={(e) => setNumero((e.target as HTMLInputElement).value.toUpperCase())} />
          </label>
          <label class="kt-campo">
            <span>Ano</span>
            <input value={ano} maxLength={4} inputMode="numeric" onInput={(e) => setAno((e.target as HTMLInputElement).value)} />
          </label>
          <label class="kt-campo">
            <span>Mês</span>
            <input value={mes} maxLength={2} inputMode="numeric" onInput={(e) => setMes((e.target as HTMLInputElement).value.padStart(2, '0').slice(-2))} />
          </label>
        </div>
        <div class="kt-linha-acoes">
          <button type="submit" class="kt-botao kt-botao-pequeno" disabled={!valido}>
            Ver dados
          </button>
          <button
            type="button"
            class="kt-botao kt-botao-secundario kt-botao-pequeno"
            disabled={!valido}
            onClick={() => buscarImagem(() => ctx.api<{ mimetype: string; base64: string }>('/v1/receitas/imagem', { method: 'POST', body: corpo(), timeout: 60000 }))}
          >
            Ver imagem
          </button>
        </div>
      </form>
      <div style={{ marginTop: '10px' }}>
        <Situacao estado={dados} />
        {dados.tipo === 'ok' && (
          <>
            <dl class="kt-dados">
              {CAMPOS_RECEITA.filter(([k]) => dados.dados[k] != null && String(dados.dados[k]).trim()).map(([k, rotulo]) => (
                <Fragment key={k}>
                  <dt>{rotulo}</dt>
                  <dd>{String(dados.dados[k])}</dd>
                </Fragment>
              ))}
              {typeof dados.dados.valor === 'number' && (
                <>
                  <dt>Valor</dt>
                  <dd>{dinheiro(dados.dados.valor)}</dd>
                </>
              )}
            </dl>
            {dados.dados.componentes?.length ? (
              <ul class="kt-itens" style={{ marginTop: '8px' }}>
                {dados.dados.componentes.map((c, i) => (
                  <li key={i}>
                    {c.descricao} — {c.qtd} {c.unidade}
                    {c.controlado ? ' · CONTROLADO' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <Situacao estado={imagem} />
        {imagem.tipo === 'ok' &&
          (imagem.dados.mimetype === 'application/pdf' ? (
            <Aviso>A imagem desta receita é um PDF: abra no Concentra.</Aviso>
          ) : (
            <img class="kt-imagem-receita" src={`data:${imagem.dados.mimetype};base64,${imagem.dados.base64}`} alt="Imagem da receita" />
          ))}
      </div>
    </Secao>
  );
}

function ConsultaOrcamentos({ ctx }: { ctx: Contexto }) {
  const [termo, setTermo] = useState('');
  const [estado, buscar] = useBusca<Orcamento[]>();
  return (
    <Secao icone="historico" titulo="Orçamentos" descricao="Número do orçamento ou nome do cliente.">
      <form
        class="kt-busca"
        onSubmit={(e) => {
          e.preventDefault();
          if (termo.trim().length >= 3) buscar(async () => (await ctx.api<{ orcamentos: Orcamento[] }>(`/v1/orcamentos?busca=${encodeURIComponent(termo.trim())}`)).orcamentos);
        }}
      >
        <input value={termo} placeholder="Ex.: 0964588 ou MARIA SILVA" onInput={(e) => setTermo((e.target as HTMLInputElement).value)} />
        <button type="submit" class="kt-botao kt-botao-pequeno" disabled={termo.trim().length < 3}>
          Buscar
        </button>
      </form>
      <Situacao estado={estado} />
      {estado.tipo === 'ok' && (estado.dados.length ? <ListaOrcamentos orcamentos={estado.dados} /> : <Vazio icone="historico" titulo="Nenhum orçamento encontrado" />)}
    </Secao>
  );
}

function ConsultaProdutos({ ctx }: { ctx: Contexto }) {
  const [escolhido, setEscolhido] = useState<ProdutoAchado | null>(null);
  return (
    <Secao icone="pilula" titulo="Produtos" descricao="Busca no cadastro do Concentra (aceita abreviações e erros de digitação).">
      <BuscaProduto api={ctx.api} aoEscolher={setEscolhido} placeholder="Ex.: vitamina d3, minoxidil, cápsula 0" />
      {escolhido && (
        <dl class="kt-dados" style={{ marginTop: '8px' }}>
          <dt>Produto</dt>
          <dd>{escolhido.descricao}</dd>
          <dt>Código</dt>
          <dd>
            <code>{escolhido.codigo}</code>
          </dd>
          {escolhido.unidade && (
            <>
              <dt>Unidade</dt>
              <dd>{escolhido.unidade}</dd>
            </>
          )}
          {escolhido.preco != null && (
            <>
              <dt>Preço</dt>
              <dd>
                {dinheiro(escolhido.preco)}
                {escolhido.unidade ? ` por ${escolhido.unidade}` : ''}
              </dd>
            </>
          )}
          {escolhido.controlado && (
            <>
              <dt>Controle</dt>
              <dd>Controlado{escolhido.portarias?.length ? ` (${escolhido.portarias.join(', ')})` : ''}</dd>
            </>
          )}
        </dl>
      )}
    </Secao>
  );
}

function ConsultaF9({ ctx }: { ctx: Contexto }) {
  const [termo, setTermo] = useState('');
  const [estado, buscar] = useBusca<{ nome: string; preco: number | null }[]>();
  return (
    <Secao icone="lista" titulo="Fórmulas F9" descricao="Fórmulas prontas cadastradas no Concentra.">
      <form
        class="kt-busca"
        onSubmit={(e) => {
          e.preventDefault();
          if (termo.trim().length >= 2) buscar(async () => (await ctx.api<{ formulas: { nome: string; preco: number | null }[] }>(`/v1/formulas-f9?q=${encodeURIComponent(termo.trim())}`)).formulas);
        }}
      >
        <input value={termo} placeholder="Começo do nome da fórmula" onInput={(e) => setTermo((e.target as HTMLInputElement).value)} />
        <button type="submit" class="kt-botao kt-botao-pequeno" disabled={termo.trim().length < 2}>
          Buscar
        </button>
      </form>
      <Situacao estado={estado} />
      {estado.tipo === 'ok' &&
        (estado.dados.length ? (
          <ul class="kt-lista">
            {estado.dados.map((f) => (
              <li key={f.nome}>
                <div class="kt-linha-topo">
                  <strong>{f.nome}</strong>
                  <span>{f.preco ? dinheiro(f.preco) : ''}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Vazio icone="lista" titulo="Nenhuma fórmula">
            A busca da Concentra procura pelo começo do nome.
          </Vazio>
        ))}
    </Secao>
  );
}

interface Prescritor {
  chave: string;
  conselho: string;
  uf: string;
  numero: string;
  nome: string;
  especialidade: string | null;
}

function ConsultaPrescritores({ ctx }: { ctx: Contexto }) {
  const [termo, setTermo] = useState('');
  const [estado, buscar] = useBusca<Prescritor[]>();
  return (
    <Secao icone="usuario" titulo="Prescritores" descricao="CRM (só números) ou parte do nome.">
      <form
        class="kt-busca"
        onSubmit={(e) => {
          e.preventDefault();
          const t = termo.trim();
          if (t.length < 3) return;
          const q = /^\d+$/.test(t) ? `crm=${t}` : `nome=${encodeURIComponent(t)}`;
          buscar(async () => (await ctx.api<{ prescritores: Prescritor[] }>(`/v1/prescritores?${q}`)).prescritores);
        }}
      >
        <input value={termo} placeholder="Ex.: 134501 ou MANGOLIN" onInput={(e) => setTermo((e.target as HTMLInputElement).value)} />
        <button type="submit" class="kt-botao kt-botao-pequeno" disabled={termo.trim().length < 3}>
          Buscar
        </button>
      </form>
      <Situacao estado={estado} />
      {estado.tipo === 'ok' &&
        (estado.dados.length ? (
          <ul class="kt-lista">
            {estado.dados.map((p) => (
              <li key={p.chave}>
                <strong>{p.nome}</strong>
                <div class="kt-muted">
                  {p.conselho}-{p.uf} {p.numero}
                  {p.especialidade ? ` · ${p.especialidade}` : ''}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Vazio icone="usuario" titulo="Nenhum prescritor encontrado" />
        ))}
    </Secao>
  );
}

export function AbaConsultas({ ctx }: { ctx: Contexto }) {
  const [sub, setSub] = useState<Sub>('receita');
  return (
    <>
      <div class="kt-chips">
        {SUBS.map((s) => (
          <button key={s.id} type="button" class="kt-chip" aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>
            {s.rotulo}
          </button>
        ))}
      </div>
      {sub === 'receita' && <ConsultaReceita ctx={ctx} />}
      {sub === 'orcamentos' && <ConsultaOrcamentos ctx={ctx} />}
      {sub === 'produtos' && <ConsultaProdutos ctx={ctx} />}
      {sub === 'f9' && <ConsultaF9 ctx={ctx} />}
      {sub === 'prescritores' && <ConsultaPrescritores ctx={ctx} />}
    </>
  );
}
