import { createHash, timingSafeEqual } from 'node:crypto';

// Compara pelos hashes, que têm tamanho fixo, para não vazar o tamanho nem o conteúdo pelo tempo.
export function compararSeguro(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
