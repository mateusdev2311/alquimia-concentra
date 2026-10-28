// Só a parte do SDK injetado pela Kentro que a integração usa.
// Referência completa: ../../kentro-shop/docs/kentro/sdk-omni-referencia.md

export interface UsuarioOmni {
  id?: number;
  name?: string;
  type?: number;
  permissions?: { isAdmin?: boolean; isSupervisor?: boolean };
}

export interface CtxOmni {
  config?: Record<string, unknown>;
  user?: UsuarioOmni;
  instance?: { name?: string; domain?: string };
}

export interface ChatOmni {
  id: number;
  queueId?: number | null;
  /** Atendente com o atendimento agora (null na fila ou com a IA). */
  userId?: number | null;
  status?: unknown;
  contactId?: number | null;
  channel?: unknown;
  contact?: { name?: string; phone?: string } | null;
}

/** Mensagem normalizada pelo SDK (só os campos usados aqui). */
export interface MensagemOmni {
  id: number | string;
  direction?: unknown;
  text?: string | null;
  at?: string | number | null;
  fileRef?: string | number | null;
  fileName?: string | null;
  mimetype?: string | null;
  fileSize?: number | null;
  deleted?: unknown;
}

export interface ArquivoOmni {
  url: string;
  mimetype?: string | null;
  name?: string | null;
  size?: number | null;
}

/** Contato da Kentro: os campos extras vêm por id (a chave exata varia entre versões do SDK). */
export interface ContatoOmni {
  id: number;
  name?: string | null;
  phone?: string | null;
  extraFields?: Record<string, unknown> | null;
  extradata?: Record<string, unknown> | null;
}

export interface RespostaHttp {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Omni {
  ready(cb: (ctx: CtxOmni) => void): unknown;
  /** Executa uma automação no servidor da Kentro (contexto administrativo), com variáveis soltas e/ou um payload. */
  runAutomation(idOuSlug: number | string, vars?: Record<string, string>, payload?: unknown): Promise<unknown>;
  on(evento: string, cb: (payload: never) => void): unknown;
  http: {
    request(opts: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number }): Promise<RespostaHttp>;
  };
  chats: {
    getSelected(): Promise<ChatOmni | null>;
    /** Rejeita com `not_found` se o usuário não puder ver o atendimento. */
    get(chatId: number): Promise<ChatOmni>;
    getMessages(chatId: number, opts?: { limit?: number; before?: number | string }): Promise<MensagemOmni[]>;
    /** URL temporária servida pelo host. */
    getFile(fileRef: string | number): Promise<ArquivoOmni>;
    sendMessage(chatId: number, payload: { text?: string; fileUrl?: string; fileName?: string; type?: string }): Promise<{ sent: boolean; id?: unknown }>;
  };
  contacts: {
    get(id: number): Promise<ContatoOmni>;
    update(id: number, campos: Record<string, unknown>, opts?: { silent?: boolean }): Promise<{ updated: boolean }>;
  };
  users: {
    list(): Promise<UsuarioOmni[]>;
  };
  ui: {
    toast(msg: string, tipo?: 'success' | 'error' | 'info' | 'warn'): Promise<unknown>;
    resize(altura: number): Promise<unknown>;
    confirm(opts: { title?: string; message: string; okLabel?: string; cancelLabel?: string }): Promise<{ confirmed: boolean }>;
  };
  storage: {
    get(chave: string): Promise<unknown>;
    set(chave: string, valor: unknown): Promise<unknown>;
    remove(chave: string): Promise<unknown>;
  };
}

/** O SDK chega como global `omni` antes do script da extensão. */
export function sdk(): Omni {
  const omni = (globalThis as { omni?: Omni }).omni;
  if (!omni) throw new Error('O SDK da Kentro (omni) não foi carregado.');
  return omni;
}

/** Aviso flutuante da Kentro, sem derrubar a tela se o host recusar. */
export function avisar(texto: string, tipo: 'success' | 'error' | 'info' = 'success'): void {
  Promise.resolve()
    .then(() => sdk().ui.toast(texto, tipo))
    .catch(() => {});
}

/** O painel lateral tem largura fixa: a altura acompanha o conteúdo. */
export function acompanharAltura(): void {
  if (typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    Promise.resolve()
      .then(() => sdk().ui.resize(document.body.scrollHeight + 16))
      .catch(() => {});
  }).observe(document.body);
}
