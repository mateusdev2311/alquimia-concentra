import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Api, criarApi, lerConfigInstalacao, mensagemDeErro } from '../../comum/api';
import { Aviso, Carregando, Vazio } from '../../comum/componentes';
import { Icone, NomeIcone } from '../../comum/icones';
import type { ChatOmni, CtxOmni, Omni } from '../../comum/omni';
import { AbaCliente } from './cliente';
import { AbaConsultas } from './consultas';
import { AbaOrcamento } from './orcamento';
import type { Cliente, Painel } from './tipos';

export interface Contexto {
  omni: Omni;
  api: Api;
  chat: ChatOmni;
  /** Id do campo extra "ID Concentra" do contato (config da instalação). */
  campoCliente: number | null;
  /** Cliente da Concentra deste atendimento (identificado pelo telefone, vinculado ou escolhido). */
  cliente: Cliente | null;
  escolherCliente: (c: Cliente | null) => void;
  recarregar: () => void;
}

type Aba = 'cliente' | 'orcamento' | 'consultas';

const ABAS: { id: Aba; rotulo: string; icone: NomeIcone }[] = [
  { id: 'cliente', rotulo: 'Cliente', icone: 'usuario' },
  { id: 'orcamento', rotulo: 'Orçamento', icone: 'pilula' },
  { id: 'consultas', rotulo: 'Consultas', icone: 'busca' },
];

/** O campo extra do contato com o id do cliente na Concentra (a chave varia entre versões do SDK). */
async function clienteVinculado(omni: Omni, chat: ChatOmni, campo: number | null): Promise<string | undefined> {
  if (!campo || !chat.contactId) return undefined;
  try {
    const contato = await omni.contacts.get(chat.contactId);
    const extras = contato.extraFields ?? contato.extradata ?? {};
    const valor = extras[String(campo)];
    const texto = typeof valor === 'object' && valor && 'value' in valor ? (valor as { value: unknown }).value : valor;
    return texto ? String(texto).trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

export function App({ omni, ctx }: { omni: Omni; ctx: CtxOmni }) {
  const { apiUrl, chave } = lerConfigInstalacao(ctx, 'chave_atendimento');
  const campoCliente = Number(ctx.config?.campo_cliente) || null;
  const api = useMemo(() => (apiUrl && chave ? criarApi({ omni, apiUrl, chave, ctx }) : null), [omni, apiUrl, chave, ctx]);

  const [selecionado, setSelecionado] = useState<ChatOmni | null | undefined>(undefined);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [aba, setAba] = useState<Aba>('cliente');
  const [versao, setVersao] = useState(0);
  /** Atendimento em que o cartão já pulou sozinho para a aba do orçamento (só uma vez por atendimento). */
  const abriuOrcamento = useRef<number | null>(null);

  useEffect(() => {
    omni.on('omniChatSelected', (c: never) => setSelecionado((c as ChatOmni | null) ?? null));
    omni.chats.getSelected().then(
      (c) => setSelecionado(c ?? null),
      () => setSelecionado(null),
    );
  }, [omni]);

  // Trocou de atendimento: começa do zero.
  useEffect(() => {
    setPainel(null);
    setCliente(null);
    setErro(null);
  }, [selecionado?.id]);

  useEffect(() => {
    if (!api || !selecionado?.id) return;
    let vale = true;
    setCarregando(true);
    (async () => {
      try {
        const clienteId = await clienteVinculado(omni, selecionado, campoCliente);
        const p = await api<Painel>('/v1/painel', {
          method: 'POST',
          body: { chatId: String(selecionado.id), telefone: selecionado.contact?.phone ?? undefined, clienteId },
        });
        if (!vale) return;
        setPainel(p);
        setErro(null);
        setCliente((atual) => atual ?? (p.clientes.length === 1 ? p.clientes[0] : null));
        // Receita já lida (pré-montada) ou em leitura: abre direto no orçamento.
        if (abriuOrcamento.current !== selecionado.id && p.rascunhos.some((r) => r.status === 'pronto' || r.status === 'lendo')) {
          abriuOrcamento.current = selecionado.id;
          setAba('orcamento');
        }
      } catch (e) {
        if (vale) setErro(mensagemDeErro(e));
      } finally {
        if (vale) setCarregando(false);
      }
    })();
    return () => {
      vale = false;
    };
    // `versao` força o recarregamento depois de uma ação.
  }, [api, omni, selecionado, campoCliente, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  if (!api) {
    return (
      <main class="kt-painel">
        <Aviso tipo="erro">Peça ao administrador para configurar a extensão Alquimia × Concentra (endereço e chave de atendimento).</Aviso>
      </main>
    );
  }
  if (selecionado === undefined) return <main class="kt-painel"><Carregando /></main>;
  if (!selecionado?.id) {
    return (
      <main class="kt-painel">
        <Vazio icone="mensagem" titulo="Concentra">
          Abra um atendimento para ver o cliente, as receitas e montar o orçamento.
        </Vazio>
      </main>
    );
  }

  const contexto: Contexto = { omni, api, chat: selecionado, campoCliente, cliente, escolherCliente: setCliente, recarregar };
  const status = painel?.status;
  const abertos = painel?.rascunhos.filter((r) => r.status !== 'erro').length ?? 0;

  return (
    <main class="kt-painel">
      {status?.concentraOnline === false && (
        <Aviso tipo="erro">
          <strong>O sistema da farmácia (Concentra) está fora do ar.</strong> As consultas e o envio de orçamentos voltam quando ele voltar. A busca de
          produtos e o cliente já identificado continuam funcionando.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div class="kt-abas-painel" role="tablist">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" class="kt-aba-painel" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
            <Icone nome={a.icone} tamanho={14} />
            {a.rotulo}
            {a.id === 'orcamento' && abertos > 0 && <span class="kt-contador">{abertos}</span>}
          </button>
        ))}
      </div>

      {!painel && carregando && <Carregando texto="Procurando o cliente no Concentra…" />}
      {painel && aba === 'cliente' && <AbaCliente ctx={contexto} painel={painel} />}
      {painel && aba === 'orcamento' && <AbaOrcamento ctx={contexto} painel={painel} />}
      {aba === 'consultas' && <AbaConsultas ctx={contexto} />}
      <p class="kt-rodape">Alquimia × Concentra · by Kentro</p>
    </main>
  );
}
