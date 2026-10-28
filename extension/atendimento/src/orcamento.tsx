import { useEffect, useState } from 'preact/hooks';
import { mensagemDeErro } from '../../comum/api';
import { Aviso, BotaoCopiar, Carregando, Secao, Vazio } from '../../comum/componentes';
import { dinheiro, haQuanto } from '../../comum/formato';
import { Icone } from '../../comum/icones';
import { avisar, type MensagemOmni } from '../../comum/omni';
import type { Contexto } from './app';
import { BuscaProduto } from './produto';
import { Componente, DadosOrcamento, Formula, Painel, Rascunho, RascunhoResumo, ResultadoEnvio, TipoFormula, UNIDADES } from './tipos';

const novoId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** "0,5" e "0.5" viram 0.5; vazio vira null. */
function numero(texto: string): number | null {
  const t = texto.trim().replace(/\./g, (m, i, s: string) => (s.includes(',') ? '' : m)).replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function mostrarNumero(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',');
}

const ROTULO_STATUS: Record<RascunhoResumo['status'], string> = {
  lendo: 'Lendo a receita…',
  pronto: 'Para revisar',
  erro: 'Com problema',
  enviado: 'Enviado',
  descartado: 'Descartado',
};

const ROTULO_ORIGEM: Record<RascunhoResumo['origem'], string> = { manual: 'Manual', ia: 'Receita (IA)', automacao: 'Pré-montado' };

function ehReceita(m: MensagemOmni): boolean {
  const tipo = String(m.mimetype ?? '').toLowerCase();
  return m.fileRef != null && !m.deleted && (tipo.startsWith('image/') || tipo === 'application/pdf');
}

/** Arquivo do chat em base64 (quando o servidor não consegue baixar a URL temporária da Kentro). */
async function baixarComoBase64(url: string): Promise<string> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const blob = await resposta.blob();
  if (blob.size > 4.5 * 1024 * 1024) throw new Error('grande');
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ''));
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

/** Fotos e PDFs da conversa: o atendente escolhe qual é a receita. */
function ArquivosDoChat({ ctx, aoLer, aoVoltar }: { ctx: Contexto; aoLer: (r: Rascunho) => void; aoVoltar: () => void }) {
  const { omni, api, chat, cliente } = ctx;
  const [arquivos, setArquivos] = useState<MensagemOmni[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState<string | number | null>(null);

  useEffect(() => {
    omni.chats.getMessages(chat.id, { limit: 60 }).then(
      (msgs) => setArquivos(msgs.filter(ehReceita)),
      () => setErro('Não foi possível ler as mensagens deste atendimento.'),
    );
  }, [omni, chat.id]);

  const ler = async (m: MensagemOmni) => {
    setLendo(m.id);
    setErro(null);
    try {
      const arquivo = await omni.chats.getFile(m.fileRef!);
      const base = {
        chatId: String(chat.id),
        contatoId: chat.contactId != null ? String(chat.contactId) : undefined,
        clienteId: cliente?.id,
        telefone: chat.contact?.phone ?? undefined,
        nomeContato: chat.contact?.name ?? undefined,
      };
      const info = { mimetype: arquivo.mimetype ?? m.mimetype ?? undefined, nome: arquivo.name ?? m.fileName ?? undefined, referencia: String(m.fileRef) };
      let r: Rascunho;
      try {
        r = await api<Rascunho>('/v1/rascunhos/ler-receita', { method: 'POST', body: { ...base, arquivo: { ...info, url: arquivo.url } } });
      } catch (e) {
        if ((e as { codigo?: string }).codigo !== 'ARQUIVO_INACESSIVEL') throw e;
        // A URL temporária só abre na sessão do navegador: manda o próprio arquivo.
        const base64 = await baixarComoBase64(arquivo.url);
        r = await api<Rascunho>('/v1/rascunhos/ler-receita', { method: 'POST', body: { ...base, arquivo: { ...info, base64 } }, timeout: 60000 });
      }
      aoLer(r);
    } catch (e) {
      setErro((e as Error)?.message === 'grande' ? 'O arquivo passa de 4,5 MB: peça uma foto menor ao cliente.' : mensagemDeErro(e));
    } finally {
      setLendo(null);
    }
  };

  return (
    <Secao
      icone="imagem"
      titulo="Qual é a receita?"
      descricao="Fotos e PDFs recebidos neste atendimento."
      acoes={
        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={aoVoltar}>
          Voltar
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!arquivos && !erro && <Carregando texto="Procurando fotos e PDFs…" />}
      {arquivos?.length === 0 && (
        <Vazio icone="imagem" titulo="Nenhuma foto ou PDF">
          Peça ao cliente a foto da receita. Ela aparece aqui assim que chegar.
        </Vazio>
      )}
      {arquivos && arquivos.length > 0 && (
        <ul class="kt-lista">
          {arquivos.map((m) => (
            <li key={m.id} class="kt-clicavel" onClick={() => lendo == null && ler(m)}>
              <div class="kt-linha-topo">
                <span class="kt-miniatura-receita">
                  <Icone nome={String(m.mimetype).includes('pdf') ? 'formulario' : 'imagem'} tamanho={20} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{m.fileName || (String(m.mimetype).includes('pdf') ? 'PDF' : 'Foto')}</strong>
                  <span class="kt-muted">{m.at ? haQuanto(typeof m.at === 'number' ? new Date(m.at).toISOString() : m.at) : ''}</span>
                </div>
                {lendo === m.id ? <span class="kt-girando" /> : <span class="kt-selo kt-selo-neutro"><Icone nome="ia" tamanho={12} /> Ler</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

function Alerta({ texto, erro }: { texto: string; erro?: boolean }) {
  return (
    <p class={`kt-alerta-linha${erro ? ' kt-alerta-erro' : ''}`}>
      <Icone nome="alerta" tamanho={13} />
      <span>{texto}</span>
    </p>
  );
}

function LinhaComponente({
  ctx,
  componente,
  mudar,
  remover,
  acabado,
}: {
  ctx: Contexto;
  componente: Componente;
  mudar: (c: Componente) => void;
  remover: () => void;
  acabado: boolean;
}) {
  const [buscando, setBuscando] = useState(!componente.codigo);
  const atencao = !componente.codigo || (componente.confianca != null && componente.confianca < 0.7) || componente.controlado;
  return (
    <div class={`kt-componente${atencao ? ' kt-componente-atencao' : ''}`}>
      {componente.lido && <p class="kt-lido">Na receita: “{componente.lido}”</p>}
      {componente.codigo && !buscando ? (
        <div class="kt-produto-escolhido">
          <span>
            {componente.nome} <code>{componente.codigo}</code>
          </span>
          <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setBuscando(true)}>
            Trocar
          </button>
        </div>
      ) : (
        <BuscaProduto
          api={ctx.api}
          tipo={acabado ? 'acabado' : 'materia-prima'}
          inicial={componente.nome ?? componente.lido ?? ''}
          sugestoes={componente.alternativas}
          aoCancelar={componente.codigo ? () => setBuscando(false) : undefined}
          aoEscolher={(p) => {
            mudar({ ...componente, codigo: p.codigo, nome: p.descricao, unidade: componente.unidade ?? p.unidade, controlado: p.controlado ?? componente.controlado, confianca: 1, alerta: null });
            setBuscando(false);
          }}
        />
      )}
      {!acabado && (
        <div class="kt-dose">
          <input
            inputMode="decimal"
            placeholder="Dosagem"
            value={mostrarNumero(componente.dosagem)}
            onChange={(e) => mudar({ ...componente, dosagem: numero((e.target as HTMLInputElement).value) })}
          />
          <select value={componente.unidade ?? ''} onChange={(e) => mudar({ ...componente, unidade: (e.target as HTMLSelectElement).value || null })}>
            <option value="">un.</option>
            {[...new Set([...(componente.unidade ? [componente.unidade] : []), ...UNIDADES])].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button type="button" class="kt-icone-botao" title="Remover componente" onClick={remover}>
            <Icone nome="lixeira" tamanho={15} />
          </button>
        </div>
      )}
      {componente.controlado && <Alerta texto="Controlado: confira a receita original e a retenção." />}
      {componente.alerta && !componente.controlado && <Alerta texto={componente.alerta} />}
    </div>
  );
}

function CartaoFormula({
  ctx,
  formula,
  indice,
  tipos,
  mudar,
  remover,
}: {
  ctx: Contexto;
  formula: Formula;
  indice: number;
  tipos: TipoFormula[];
  mudar: (f: Formula) => void;
  remover: () => void;
}) {
  const [excipiente, setExcipiente] = useState(false);
  const acabado = formula.tipoItem === 'acabado';
  const opcoes = tipos.filter((t) => t.categoria === formula.tipoItem);
  const mudarComponente = (i: number, c: Componente) => mudar({ ...formula, componentes: formula.componentes.map((x, j) => (j === i ? c : x)) });
  return (
    <div class="kt-formula">
      <div class="kt-formula-topo">
        <span class="kt-selo kt-selo-neutro">{indice + 1}</span>
        <strong>{acabado ? 'Produto acabado' : 'Fórmula manipulada'}</strong>
        <button type="button" class="kt-icone-botao" title="Remover item" onClick={remover}>
          <Icone nome="lixeira" tamanho={15} />
        </button>
      </div>
      {formula.alertas?.map((a, i) => <Alerta key={i} texto={a} />)}

      <label class="kt-campo">
        <span>Tipo no Concentra</span>
        <select
          value={formula.forma ?? ''}
          onChange={(e) => {
            const t = opcoes.find((o) => o.nome === (e.target as HTMLSelectElement).value);
            mudar({ ...formula, forma: t?.nome ?? null, tipo: t?.codigo || null });
          }}
        >
          <option value="">Escolha…</option>
          {formula.forma && !opcoes.some((o) => o.nome === formula.forma) && <option value={formula.forma}>{formula.forma}</option>}
          {opcoes.map((t) => (
            <option key={t.nome} value={t.nome}>
              {t.nome}
              {t.codigo ? '' : ' (sem código)'}
            </option>
          ))}
        </select>
      </label>

      {acabado ? (
        <>
          {formula.componentes.map((c, i) => (
            <LinhaComponente key={c.id} ctx={ctx} componente={c} acabado mudar={(n) => mudarComponente(i, n)} remover={() => {}} />
          ))}
          <label class="kt-campo">
            <span>Quantidade (unidades)</span>
            <input inputMode="numeric" value={mostrarNumero(formula.quantidade)} onChange={(e) => mudar({ ...formula, quantidade: numero((e.target as HTMLInputElement).value) })} />
          </label>
        </>
      ) : (
        <>
          <div class="kt-grade-2">
            <label class="kt-campo">
              <span>QSP (total)</span>
              <input inputMode="decimal" value={mostrarNumero(formula.qsp)} onChange={(e) => mudar({ ...formula, qsp: numero((e.target as HTMLInputElement).value) })} />
            </label>
            <label class="kt-campo">
              <span>Unidade</span>
              <input value={formula.unidadeQsp ?? ''} placeholder="caps, g, ml" onChange={(e) => mudar({ ...formula, unidadeQsp: (e.target as HTMLInputElement).value || null })} />
            </label>
          </div>
          {formula.componentes.map((c, i) => (
            <LinhaComponente
              key={c.id}
              ctx={ctx}
              componente={c}
              acabado={false}
              mudar={(n) => mudarComponente(i, n)}
              remover={() => mudar({ ...formula, componentes: formula.componentes.filter((_, j) => j !== i) })}
            />
          ))}
          <div class="kt-linha-acoes" style={{ margin: '6px 0 10px' }}>
            <button
              type="button"
              class="kt-botao kt-botao-fantasma kt-botao-pequeno"
              onClick={() => mudar({ ...formula, componentes: [...formula.componentes, { id: novoId(), lido: null, codigo: null, nome: null, dosagem: null, unidade: null }] })}
            >
              <Icone nome="mais" tamanho={13} />
              Componente
            </button>
          </div>

          <div class="kt-campo">
            <span>Excipiente / cápsula</span>
            {formula.excipiente && !excipiente ? (
              <div class="kt-produto-escolhido">
                <span>
                  {formula.excipiente.nome} <code>{formula.excipiente.codigo}</code>
                </span>
                <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setExcipiente(true)}>
                  Trocar
                </button>
                <button type="button" class="kt-icone-botao" title="Sem excipiente" onClick={() => mudar({ ...formula, excipiente: null })}>
                  <Icone nome="fechar" tamanho={14} />
                </button>
              </div>
            ) : excipiente || !formula.excipiente ? (
              excipiente ? (
                <BuscaProduto
                  api={ctx.api}
                  tipo="excipiente"
                  placeholder="Ex.: cápsula 0, excipiente…"
                  aoCancelar={() => setExcipiente(false)}
                  aoEscolher={(p) => {
                    mudar({ ...formula, excipiente: { codigo: p.codigo, nome: p.descricao, dosagem: formula.qsp, unidade: p.unidade || 'UN' } });
                    setExcipiente(false);
                  }}
                />
              ) : (
                <div>
                  <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={() => setExcipiente(true)}>
                    Escolher excipiente
                  </button>
                </div>
              )
            ) : null}
          </div>
        </>
      )}

      <label class="kt-campo">
        <span>Posologia</span>
        <textarea rows={2} value={formula.posologia ?? ''} onChange={(e) => mudar({ ...formula, posologia: (e.target as HTMLTextAreaElement).value || null })} />
      </label>
    </div>
  );
}

function Resultado({ ctx, rascunho, resultado }: { ctx: Contexto; rascunho: Rascunho; resultado: ResultadoEnvio }) {
  const [mensagem, setMensagem] = useState(resultado.mensagem);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const mandar = async () => {
    setEnviando(true);
    try {
      await ctx.omni.chats.sendMessage(ctx.chat.id, { text: mensagem });
      setEnviada(true);
      avisar('Resumo enviado ao cliente.');
      ctx.api(`/v1/rascunhos/${rascunho.id}/mensagem-enviada`, { method: 'POST' }).catch(() => {});
    } catch {
      avisar('Não foi possível enviar no chat. Copie e cole a mensagem.', 'error');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Secao icone="check" titulo="Orçamento gravado no Concentra">
      <div class="kt-resultado">
        <div class="kt-muted">{resultado.numero ? `Orçamento nº ${resultado.numero}` : 'Número não localizado: confira no Concentra'}</div>
        <div class="kt-valor">{dinheiro(resultado.valorLiquido)}</div>
        {resultado.valorBruto != null && resultado.valorLiquido != null && resultado.valorBruto - resultado.valorLiquido >= 0.01 && (
          <div class="kt-muted">de {dinheiro(resultado.valorBruto)}</div>
        )}
      </div>
      <label class="kt-campo">
        <span>Mensagem para o cliente (pode editar antes de enviar)</span>
        <textarea class="kt-mensagem" value={mensagem} onInput={(e) => setMensagem((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="kt-linha-acoes">
        <button type="button" class="kt-botao" disabled={enviando || !mensagem.trim()} onClick={mandar}>
          <Icone nome="enviar" tamanho={14} />
          {enviada ? 'Enviar de novo' : 'Enviar no chat'}
        </button>
        <BotaoCopiar texto={mensagem} aoCopiar="Mensagem copiada." />
      </div>
    </Secao>
  );
}

function Editor({ ctx, id, aoVoltar }: { ctx: Contexto; id: string; aoVoltar: () => void }) {
  const { api, omni } = ctx;
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [dados, setDados] = useState<DadosOrcamento | null>(null);
  const [tipos, setTipos] = useState<TipoFormula[]>([]);
  const [alterado, setAlterado] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'salvando' | 'enviando' | 'descartando'>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);

  const carregar = async () => {
    try {
      const r = await api<Rascunho>(`/v1/rascunhos/${id}`);
      setRascunho(r);
      if (r.status !== 'lendo') setDados(r.dados);
      if (r.status === 'enviado' && r.dados.resultado) setResultado(r.dados.resultado);
      return r;
    } catch (e) {
      setErro(mensagemDeErro(e));
      return null;
    }
  };

  useEffect(() => {
    carregar();
    api<{ tipos: TipoFormula[] }>('/v1/tipos').then((t) => setTipos(t.tipos), () => {});
  }, [id]);

  // Enquanto a IA lê, confere a cada 5 s (fica longe do limite de 30 chamadas/minuto).
  useEffect(() => {
    if (rascunho?.status !== 'lendo') return;
    const t = setTimeout(carregar, 5000);
    return () => clearTimeout(t);
  }, [rascunho]);

  if (erro && !rascunho) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!rascunho) return <Carregando />;
  if (rascunho.status === 'lendo') {
    return (
      <Secao icone="ia" titulo="Lendo a receita…" descricao="A IA está lendo e procurando cada item no cadastro. Leva de 10 a 40 segundos.">
        <Carregando texto="Pode continuar o atendimento: o orçamento fica salvo aqui." />
      </Secao>
    );
  }
  if (resultado) return <Resultado ctx={ctx} rascunho={rascunho} resultado={resultado} />;
  if (!dados) return <Carregando />;

  const mudar = (parcial: Partial<DadosOrcamento>) => {
    setDados({ ...dados, ...parcial });
    setAlterado(true);
  };
  const mudarFormula = (i: number, f: Formula) => mudar({ formulas: dados.formulas.map((x, j) => (j === i ? f : x)) });
  const incluir = (tipoItem: Formula['tipoItem']) =>
    mudar({
      formulas: [
        ...dados.formulas,
        {
          id: novoId(),
          tipoItem,
          forma: null,
          tipo: null,
          qsp: null,
          unidadeQsp: null,
          dose: null,
          posologia: null,
          repete: 1,
          quantidade: tipoItem === 'acabado' ? 1 : null,
          componentes: tipoItem === 'acabado' ? [{ id: novoId(), lido: null, codigo: null, nome: null, dosagem: null, unidade: 'UN' }] : [],
          excipiente: null,
          alertas: [],
        },
      ],
    });

  const salvar = async (): Promise<boolean> => {
    if (!alterado) return true;
    setOcupado('salvando');
    try {
      const r = await api<Rascunho>(`/v1/rascunhos/${id}`, { method: 'PUT', body: { dados } });
      setRascunho(r);
      setAlterado(false);
      return true;
    } catch (e) {
      setErro(mensagemDeErro(e));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const enviar = async () => {
    setErro(null);
    setErros([]);
    if (!(await salvar())) return;
    const controlado = dados.controleEspecial || dados.formulas.some((f) => f.componentes.some((c) => c.controlado));
    const itens = dados.formulas.length;
    const { confirmed } = await omni.ui.confirm({
      title: 'Gravar no Concentra?',
      message:
        `Vai criar um orçamento REAL no Concentra para ${dados.paciente || 'o paciente'}, com ${itens} ${itens === 1 ? 'item' : 'itens'}.` +
        (controlado ? '\n\nATENÇÃO: há medicamento controlado. Confira a receita original.' : '') +
        (dados.envioIncerto ? '\n\nO envio anterior pode ter sido gravado: confira no Concentra para não duplicar.' : ''),
      okLabel: 'Gravar orçamento',
      cancelLabel: 'Revisar mais',
    });
    if (!confirmed) return;
    setOcupado('enviando');
    try {
      const r = await api<{ rascunho: Rascunho; resultado: ResultadoEnvio }>(`/v1/rascunhos/${id}/enviar`, {
        method: 'POST',
        body: { confirmado: true, forcar: dados.envioIncerto === true },
        timeout: 100000,
      });
      setRascunho(r.rascunho);
      setResultado(r.resultado);
      ctx.recarregar();
    } catch (e) {
      const falha = e as { erros?: string[] };
      setErro(mensagemDeErro(e));
      if (falha.erros?.length) setErros(falha.erros);
      carregar();
    } finally {
      setOcupado(null);
    }
  };

  const descartar = async () => {
    const { confirmed } = await omni.ui.confirm({ message: 'Descartar este orçamento em montagem?', okLabel: 'Descartar', cancelLabel: 'Manter' });
    if (!confirmed) return;
    setOcupado('descartando');
    try {
      await api(`/v1/rascunhos/${id}/descartar`, { method: 'POST' });
      ctx.recarregar();
      aoVoltar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
    }
  };

  const campo = (rotulo: string, chave: 'paciente' | 'fone' | 'prescritor' | 'crm', ajuda?: string | null) => (
    <label class="kt-campo">
      <span>{rotulo}</span>
      <input value={dados[chave]} onInput={(e) => mudar({ [chave]: (e.target as HTMLInputElement).value } as Partial<DadosOrcamento>)} />
      {ajuda && <small class="kt-campo-ajuda kt-muted">{ajuda}</small>}
    </label>
  );

  return (
    <>
      <div class="kt-linha-acoes" style={{ marginBottom: '8px' }}>
        <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={async () => (await salvar()) && aoVoltar()}>
          ← Orçamentos
        </button>
        <span class="kt-selo kt-selo-neutro">{ROTULO_ORIGEM[rascunho.origem]}</span>
      </div>
      {rascunho.erro && <Aviso tipo={rascunho.status === 'erro' ? 'erro' : 'info'}>{rascunho.erro}</Aviso>}
      {dados.envioIncerto && (
        <Aviso tipo="erro">O envio anterior não teve resposta e PODE ter sido gravado. Confira no Concentra antes de enviar de novo.</Aviso>
      )}
      {dados.controleEspecial && <Aviso tipo="erro">Receita com medicamento controlado: confira a receita original e a retenção antes de seguir.</Aviso>}
      {dados.observacoes && <Aviso>{dados.observacoes}</Aviso>}

      <Secao icone="usuario" titulo="Paciente e prescritor">
        {campo('Paciente', 'paciente', dados.pacienteLido ? `Na receita: ${dados.pacienteLido}` : null)}
        {campo('Telefone', 'fone')}
        {campo('Prescritor', 'prescritor', dados.prescritorLido && dados.prescritorLido.toUpperCase() !== dados.prescritor ? `Na receita: ${dados.prescritorLido}` : null)}
        {campo('CRM', 'crm', dados.crmLido && dados.crmLido !== dados.crm ? `Na receita: ${dados.crmLido}` : null)}
      </Secao>

      {dados.formulas.map((f, i) => (
        <CartaoFormula
          key={f.id}
          ctx={ctx}
          formula={f}
          indice={i}
          tipos={tipos}
          mudar={(n) => mudarFormula(i, n)}
          remover={() => mudar({ formulas: dados.formulas.filter((_, j) => j !== i) })}
        />
      ))}
      {dados.formulas.length === 0 && <Aviso>Inclua as fórmulas e os produtos da receita.</Aviso>}
      <div class="kt-linha-acoes" style={{ marginBottom: '10px' }}>
        <button type="button" class="kt-botao kt-botao-secundario kt-botao-pequeno" onClick={() => incluir('manipulado')}>
          <Icone nome="mais" tamanho={13} />
          Fórmula
        </button>
        <button type="button" class="kt-botao kt-botao-secundario kt-botao-pequeno" onClick={() => incluir('acabado')}>
          <Icone nome="mais" tamanho={13} />
          Produto acabado
        </button>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erros.length > 1 && (
        <Aviso tipo="erro">
          <ul style={{ margin: 0, paddingLeft: '16px' }}>
            {erros.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Aviso>
      )}

      <div class="kt-barra-envio">
        <button type="button" class="kt-botao kt-botao-sucesso" disabled={ocupado != null || dados.formulas.length === 0} onClick={enviar}>
          <Icone nome="enviar" tamanho={14} />
          {ocupado === 'enviando' ? 'Gravando no Concentra…' : 'Revisei: gravar no Concentra'}
        </button>
        <div class="kt-grade-2">
          <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" disabled={!alterado || ocupado != null} onClick={salvar}>
            {ocupado === 'salvando' ? 'Salvando…' : alterado ? 'Salvar rascunho' : 'Salvo'}
          </button>
          <button type="button" class="kt-botao kt-botao-perigo kt-botao-pequeno" disabled={ocupado != null} onClick={descartar}>
            Descartar
          </button>
        </div>
      </div>
    </>
  );
}

export function AbaOrcamento({ ctx, painel }: { ctx: Contexto; painel: Painel }) {
  const { api, chat, cliente } = ctx;
  const [modo, setModo] = useState<{ tipo: 'lista' } | { tipo: 'arquivos' } | { tipo: 'editar'; id: string }>({ tipo: 'lista' });
  const [lista, setLista] = useState<RascunhoResumo[]>(painel.rascunhos);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => setLista(painel.rascunhos), [painel]);

  const manual = async () => {
    setCriando(true);
    setErro(null);
    try {
      const r = await api<Rascunho>('/v1/rascunhos', {
        method: 'POST',
        body: {
          chatId: String(chat.id),
          contatoId: chat.contactId != null ? String(chat.contactId) : undefined,
          clienteId: cliente?.id,
          telefone: chat.contact?.phone ?? undefined,
          nomeContato: chat.contact?.name ?? undefined,
        },
      });
      setModo({ tipo: 'editar', id: r.id });
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setCriando(false);
    }
  };

  if (modo.tipo === 'arquivos') {
    return <ArquivosDoChat ctx={ctx} aoVoltar={() => setModo({ tipo: 'lista' })} aoLer={(r) => setModo({ tipo: 'editar', id: r.id })} />;
  }
  if (modo.tipo === 'editar') {
    return (
      <Editor
        ctx={ctx}
        id={modo.id}
        aoVoltar={() => {
          setModo({ tipo: 'lista' });
          ctx.recarregar();
        }}
      />
    );
  }

  return (
    <>
      {!painel.status.iaLigada && <Aviso>A leitura de receita com IA está desligada. Monte o orçamento manualmente.</Aviso>}
      {!cliente && <Aviso>Sem cliente identificado: o nome do paciente virá da receita. Confira na revisão.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div class="kt-grade-2" style={{ marginBottom: '10px' }}>
        <button type="button" class="kt-botao" disabled={!painel.status.iaLigada} onClick={() => setModo({ tipo: 'arquivos' })}>
          <Icone nome="ia" tamanho={14} />
          Receita → Orçamento
        </button>
        <button type="button" class="kt-botao kt-botao-secundario" disabled={criando} onClick={manual}>
          <Icone nome="mais" tamanho={14} />
          Manual
        </button>
      </div>
      {lista.length === 0 ? (
        <Vazio icone="pilula" titulo="Nenhum orçamento em montagem">
          Quando o cliente mandar a receita, use “Receita → Orçamento”. A IA monta e você revisa antes de gravar.
        </Vazio>
      ) : (
        <Secao icone="pilula" titulo="Em montagem neste atendimento">
          <ul class="kt-lista">
            {lista.map((r) => (
              <li key={r.id} class="kt-clicavel" onClick={() => setModo({ tipo: 'editar', id: r.id })}>
                <div class="kt-linha-topo">
                  <strong>{ROTULO_ORIGEM[r.origem]}</strong>
                  <span class={`kt-selo ${r.status === 'erro' ? 'kt-selo-erro' : r.status === 'pronto' ? 'kt-selo-aviso' : 'kt-selo-neutro'}`}>
                    {r.status === 'lendo' && <span class="kt-girando" />}
                    {ROTULO_STATUS[r.status]}
                  </span>
                </div>
                <div class="kt-muted">
                  {r.arquivo?.nome ? `${r.arquivo.nome} · ` : ''}
                  {haQuanto(r.criadoEm)}
                </div>
                {r.erro && <Alerta texto={r.erro} erro={r.status === 'erro'} />}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </>
  );
}
