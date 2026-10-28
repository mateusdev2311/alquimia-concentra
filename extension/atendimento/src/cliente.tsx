import { useState } from 'preact/hooks';
import { mensagemDeErro } from '../../comum/api';
import { Aviso, Avatar, Carregando, Secao, Vazio } from '../../comum/componentes';
import { dinheiro, diaLongo } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar } from '../../comum/omni';
import type { Contexto } from './app';
import type { Cliente, Orcamento, Painel } from './tipos';

function telefone(t: string): string {
  const d = t.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

function cpf(c: string): string {
  const d = c.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c;
}

function endereco(c: Cliente): string | null {
  const e = c.endereco;
  if (!e) return null;
  const linha = [e.logradouro, e.numero].filter(Boolean).join(', ');
  return [linha, e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep].filter(Boolean).join(' · ') || null;
}

export function CartaoCliente({ cliente }: { cliente: Cliente }) {
  const end = endereco(cliente);
  return (
    <>
      <div class="kt-nome-cliente">
        <Avatar nome={cliente.nome} tamanho={32} />
        <strong>{cliente.nome}</strong>
      </div>
      <dl class="kt-dados">
        {cliente.telefones.length > 0 && (
          <>
            <dt>Telefone</dt>
            <dd>{cliente.telefones.map(telefone).join(' · ')}</dd>
          </>
        )}
        {cliente.cpf && (
          <>
            <dt>CPF</dt>
            <dd>{cpf(cliente.cpf)}</dd>
          </>
        )}
        {cliente.email && (
          <>
            <dt>E-mail</dt>
            <dd>{cliente.email}</dd>
          </>
        )}
        {end && (
          <>
            <dt>Endereço</dt>
            <dd>{end}</dd>
          </>
        )}
        {cliente.nascimento && (
          <>
            <dt>Nascimento</dt>
            <dd>{cliente.nascimento}</dd>
          </>
        )}
        {cliente.ultimaCompra && (
          <>
            <dt>Última compra</dt>
            <dd>{diaLongo(cliente.ultimaCompra)}</dd>
          </>
        )}
        <dt>Código</dt>
        <dd>
          <code>{cliente.id}</code>
        </dd>
      </dl>
    </>
  );
}

export function ListaOrcamentos({ orcamentos }: { orcamentos: Orcamento[] }) {
  return (
    <ul class="kt-lista">
      {orcamentos.map((o) => (
        <li key={o.numero}>
          <div class="kt-linha-topo">
            <strong>
              nº {o.numero} · {o.tipo ?? '—'}
            </strong>
            <span>{dinheiro(o.valor)}</span>
          </div>
          {o.cliente && <div class="kt-muted">{o.cliente}{o.vendedor ? ` · ${o.vendedor}` : ''}</div>}
          {o.itens.length > 0 && (
            <ul class="kt-itens">
              {o.itens.slice(0, 8).map((i, n) => (
                <li key={n}>{i.texto}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AbaCliente({ ctx, painel }: { ctx: Contexto; painel: Painel }) {
  const { cliente, escolherCliente, api, omni, chat, campoCliente } = ctx;
  const [nome, setNome] = useState('');
  const [busca, setBusca] = useState<{ estado: 'parado' | 'buscando' | 'ok' | 'erro'; clientes: Cliente[]; erro?: string }>({ estado: 'parado', clientes: [] });
  const [vinculando, setVinculando] = useState(false);
  const [vinculadoAgora, setVinculadoAgora] = useState<string | null>(null);

  const buscar = async (e?: Event) => {
    e?.preventDefault();
    if (nome.trim().length < 3) return;
    setBusca({ estado: 'buscando', clientes: [] });
    try {
      const r = await api<{ clientes: Cliente[] }>(`/v1/clientes?nome=${encodeURIComponent(nome.trim())}`);
      setBusca({ estado: 'ok', clientes: r.clientes });
    } catch (erro) {
      setBusca({ estado: 'erro', clientes: [], erro: mensagemDeErro(erro) });
    }
  };

  // Grava o código do cliente no campo extra do contato: os próximos atendimentos já abrem vinculados.
  const vincular = async (c: Cliente) => {
    escolherCliente(c);
    if (!campoCliente || !chat.contactId) return;
    setVinculando(true);
    try {
      await omni.contacts.update(chat.contactId, { extraFields: { [String(campoCliente)]: c.id } }, { silent: true });
      setVinculadoAgora(c.id);
      avisar('Cliente vinculado ao contato.');
    } catch {
      avisar('Não foi possível gravar o cliente no contato.', 'error');
    } finally {
      setVinculando(false);
    }
  };

  const vinculado = painel.vinculado || (cliente != null && vinculadoAgora === cliente.id);
  const outros = painel.clientes.filter((c) => c.id !== cliente?.id);
  const recentes = cliente && painel.clientes.length === 1 && cliente.id === painel.clientes[0].id ? painel.orcamentosRecentes : [];

  return (
    <>
      {cliente ? (
        <Secao
          icone="usuario"
          titulo={vinculado ? 'Cliente vinculado' : painel.clientes.some((c) => c.id === cliente.id) ? 'Cliente pelo telefone' : 'Cliente escolhido'}
          acoes={
            <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => escolherCliente(null)}>
              Trocar
            </button>
          }
        >
          <CartaoCliente cliente={cliente} />
          {!vinculado && campoCliente && chat.contactId && (
            <div class="kt-linha-acoes" style={{ marginTop: '10px' }}>
              <button type="button" class="kt-botao kt-botao-secundario kt-botao-pequeno" disabled={vinculando} onClick={() => vincular(cliente)}>
                <Icone nome="link" tamanho={14} />
                Confirmar: é este cliente
              </button>
            </div>
          )}
        </Secao>
      ) : (
        painel.clientes.length === 0 && (
          <Aviso>Nenhum cliente do Concentra com o telefone deste atendimento. Busque pelo nome abaixo.</Aviso>
        )
      )}

      {!cliente && outros.length > 0 && (
        <Secao icone="usuarios" titulo="Clientes com este telefone" descricao="Escolha quem é o cliente deste atendimento.">
          <ul class="kt-lista">
            {outros.map((c) => (
              <li key={c.id} class="kt-clicavel" onClick={() => vincular(c)}>
                <div class="kt-linha-topo">
                  <strong>{c.nome}</strong>
                  <Icone nome="direita" />
                </div>
                <div class="kt-muted">{c.ultimaCompra ? `Última compra ${diaLongo(c.ultimaCompra)}` : 'Sem compra recente'}</div>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {recentes.length > 0 && (
        <Secao icone="historico" titulo="Orçamentos recentes" descricao="Últimos 11 dias no Concentra.">
          <ListaOrcamentos orcamentos={recentes} />
        </Secao>
      )}
      {painel.orcamentosErro && <Aviso tipo="erro">{painel.orcamentosErro}</Aviso>}

      <Secao icone="busca" titulo="Buscar cliente pelo nome">
        <form class="kt-busca" onSubmit={buscar}>
          <input value={nome} onInput={(e) => setNome((e.target as HTMLInputElement).value)} placeholder="Nome do cliente (mín. 3 letras)" />
          <button type="submit" class="kt-botao kt-botao-pequeno" disabled={nome.trim().length < 3 || busca.estado === 'buscando'}>
            Buscar
          </button>
        </form>
        {busca.estado === 'buscando' && <Carregando texto="Buscando no Concentra…" />}
        {busca.estado === 'erro' && <Aviso tipo="erro">{busca.erro}</Aviso>}
        {busca.estado === 'ok' && busca.clientes.length === 0 && (
          <Vazio icone="usuario" titulo="Ninguém com esse nome">
            Confira a grafia ou busque só pelo sobrenome.
          </Vazio>
        )}
        {busca.clientes.length > 0 && (
          <ul class="kt-lista">
            {busca.clientes.map((c) => (
              <li key={c.id} class={`kt-clicavel${cliente?.id === c.id ? ' kt-ativo' : ''}`} onClick={() => escolherCliente(c)}>
                <div class="kt-linha-topo">
                  <strong>{c.nome}</strong>
                  <Icone nome="direita" />
                </div>
                <div class="kt-muted">
                  {[c.telefones.map(telefone).join(' · '), c.ultimaCompra ? `última compra ${diaLongo(c.ultimaCompra)}` : null].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  );
}
