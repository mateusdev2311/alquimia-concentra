/** Maiúsculas sem acento e com espaços simples: a forma em que a Concentra guarda e compara os nomes. */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Campo do ERP (DBF): vem com espaços à direita e vazio vira null. */
export function limpo(valor: unknown): string | null {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto ? texto : null;
}

/** "20261021" → Date (só a data, em UTC). Datas vazias ou inválidas viram null. */
export function dataAaaammdd(valor: unknown): Date | null {
  const texto = String(valor ?? '').trim();
  if (!/^\d{8}$/.test(texto)) return null;
  const d = new Date(Date.UTC(Number(texto.slice(0, 4)), Number(texto.slice(4, 6)) - 1, Number(texto.slice(6, 8))));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "DD/MM/AAAA", o formato que a Concentra recebe nas datas. Usa o fuso da farmácia. */
export function dataBr(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  return partes;
}

/** Só os dígitos. */
export function digitos(texto: string | null | undefined): string {
  return String(texto ?? '').replace(/\D/g, '');
}

/**
 * Chave de telefone: DDD + 8 últimos dígitos. Casa o número do WhatsApp (55 + DDD + 9 dígitos)
 * com o cadastro do ERP, que às vezes não tem o nono dígito nem o DDD no mesmo campo.
 */
export function chaveTelefone(telefone: string | null | undefined, dddPadrao?: string | null): string | null {
  let d = digitos(telefone);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (d.length === 8 || d.length === 9) {
    const ddd = digitos(dddPadrao).replace(/^0+/, '').slice(-2);
    if (ddd.length !== 2) return null;
    d = ddd + d;
  }
  if (d.length !== 10 && d.length !== 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}
