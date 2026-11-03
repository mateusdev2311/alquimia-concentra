// Caminho até a API da farmácia, passo a passo, para o admin (e o TI) saberem onde a conexão para.
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { motivoDeRede } from './concentra.client';

export interface PassoDiagnostico {
  nome: string;
  ok: boolean;
  detalhe: string;
}

export interface Diagnostico {
  passos: PassoDiagnostico[];
  ipSaida: string | null;
}

const TEMPO = 8000;

function portaAbre(host: string, porta: number): Promise<{ ok: boolean; detalhe: string }> {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const socket = connect({ host, port: porta, timeout: TEMPO });
    const fim = (ok: boolean, detalhe: string) => {
      socket.destroy();
      resolver({ ok, detalhe });
    };
    socket.once('connect', () => fim(true, `conectou em ${Date.now() - inicio} ms`));
    socket.once('timeout', () => fim(false, `sem resposta em ${TEMPO / 1000} s: firewall bloqueando (no Doca ou na farmácia) ou servidor desligado`));
    socket.once('error', (erro) => fim(false, motivoDeRede(erro)));
  });
}

/** O ping pode nem existir na imagem do servidor, ou não ter permissão: isso não é sinal de bloqueio. */
function pinga(ip: string): Promise<{ ok: boolean; detalhe: string }> {
  const args = process.platform === 'win32' ? ['-n', '3', '-w', '2000', ip] : ['-c', '3', '-W', '2', ip];
  return new Promise((resolver) => {
    execFile('ping', args, { timeout: TEMPO }, (erro, saida, saidaErro) => {
      if (!erro) {
        const perda = /(\d+)%/.exec(saida)?.[1];
        return resolver({ ok: true, detalhe: `respondeu${perda ? ` (${perda}% de perda)` : ''}` });
      }
      const indisponivel = (erro as NodeJS.ErrnoException).code === 'ENOENT' || /not permitted|permission|not found/i.test(saidaErro);
      resolver({ ok: false, detalhe: indisponivel ? 'não deu para testar: o ping não está disponível neste servidor' : 'sem resposta' });
    });
  });
}

/** IP público com que este servidor sai para a internet. */
async function ipDeSaida(): Promise<string | null> {
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(TEMPO) });
    return String(((await r.json()) as { ip?: string }).ip ?? '') || null;
  } catch {
    return null;
  }
}

export async function diagnosticar(urlApi: string): Promise<Diagnostico> {
  const passos: PassoDiagnostico[] = [];
  const url = new URL(urlApi);
  const porta = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const ipSaida = ipDeSaida();

  let ip: string | null = null;
  try {
    ip = (await lookup(url.hostname, { family: 4 })).address;
    passos.push({ nome: `DNS de ${url.hostname}`, ok: true, detalhe: `aponta para ${ip}` });
  } catch (erro) {
    passos.push({ nome: `DNS de ${url.hostname}`, ok: false, detalhe: motivoDeRede(erro) });
  }

  if (ip) {
    // Em paralelo com a porta, para não somar tempo ao teste.
    const [tcp, ping, pingControle] = await Promise.all([portaAbre(ip, porta), pinga(ip), pinga('8.8.8.8')]);
    passos.push({ nome: `Ping em ${ip}`, ...ping });
    passos.push({
      nome: 'Controle: ping em 8.8.8.8',
      ok: pingControle.ok,
      detalhe: pingControle.ok ? pingControle.detalhe : `${pingControle.detalhe}: sem esse controle, o ping acima não indica bloqueio`,
    });
    passos.push({ nome: `Porta ${porta} em ${ip}`, ...tcp });
    if (!tcp.ok) {
      // Controle: a mesma porta num servidor público que aceita qualquer porta (portquiz.net).
      // Abre lá e não na farmácia → o bloqueio é na farmácia; não abre em lugar nenhum → é a saída deste servidor.
      const controle = await portaAbre('portquiz.net', porta);
      passos.push({
        nome: `Controle: porta ${porta} em portquiz.net`,
        ok: controle.ok,
        detalhe: controle.ok
          ? `${controle.detalhe}: a saída deste servidor pela porta ${porta} funciona, então o bloqueio está na FARMÁCIA (modem ou firewall do servidor)`
          : `${controle.detalhe}: este servidor não consegue sair pela porta ${porta}; o bloqueio está no DOCA`,
      });
    }
    if (tcp.ok) {
      try {
        const r = await fetch(urlApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(TEMPO) });
        // Sem a chave, a API responde 401: é a prova de que ela está de pé e falando HTTP.
        passos.push({ nome: 'API respondendo (HTTP)', ok: r.status < 500, detalhe: `HTTP ${r.status}${r.status === 401 ? ' (esperado sem a chave: a API está de pé)' : ''}` });
      } catch (erro) {
        passos.push({ nome: 'API respondendo (HTTP)', ok: false, detalhe: motivoDeRede(erro) });
      }
    }
  }
  return { passos, ipSaida: await ipSaida };
}
