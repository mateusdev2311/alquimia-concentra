// Imagem da receita no painel estreito: corta a margem branca do scan, dá zoom, arrasta e gira.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icone } from '../../comum/icones';

const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.5;
const ZOOM_CLIQUE = 2.5;

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rejeitar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = rejeitar;
    img.src = src;
  });
}

/**
 * Caixa do conteúdo (o que não é papel branco), medida numa cópia reduzida.
 * Linhas e colunas só contam com um mínimo de pixels escuros, para sujeira do scan não segurar a margem.
 */
function caixaDoConteudo(img: HTMLImageElement): { x: number; y: number; w: number; h: number } | null {
  const escala = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * escala));
  const h = Math.max(1, Math.round(img.naturalHeight * escala));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.fillStyle = '#fff'; // PNG transparente vira papel branco
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const porLinha = new Uint32Array(h);
  const porColuna = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 200) {
        porLinha[y]++;
        porColuna[x]++;
      }
    }
  }
  const minLinha = Math.max(2, w * 0.004);
  const minColuna = Math.max(2, h * 0.004);
  let topo = 0;
  while (topo < h && porLinha[topo] < minLinha) topo++;
  let base = h - 1;
  while (base > topo && porLinha[base] < minLinha) base--;
  let esq = 0;
  while (esq < w && porColuna[esq] < minColuna) esq++;
  let dir = w - 1;
  while (dir > esq && porColuna[dir] < minColuna) dir--;
  if (topo >= base || esq >= dir) return null; // página em branco: mostra como veio
  const folga = Math.round(Math.max(w, h) * 0.015);
  topo = Math.max(0, topo - folga);
  esq = Math.max(0, esq - folga);
  base = Math.min(h - 1, base + folga);
  dir = Math.min(w - 1, dir + folga);
  return { x: esq / escala, y: topo / escala, w: (dir - esq + 1) / escala, h: (base - topo + 1) / escala };
}

/** Recorta (se a margem for relevante) e gira. Em qualquer falha, devolve a imagem original. */
async function preparar(src: string, mimetype: string, giro: number): Promise<string> {
  try {
    const img = await carregar(src);
    const area = img.naturalWidth * img.naturalHeight;
    let caixa = caixaDoConteudo(img) ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    if (caixa.w * caixa.h > area * 0.9) caixa = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    if (giro === 0 && caixa.w === img.naturalWidth && caixa.h === img.naturalHeight) return src;
    const deitada = giro % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = Math.round(deitada ? caixa.h : caixa.w);
    c.height = Math.round(deitada ? caixa.w : caixa.h);
    const g = c.getContext('2d');
    if (!g) return src;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.translate(c.width / 2, c.height / 2);
    g.rotate((giro * Math.PI) / 180);
    g.drawImage(img, caixa.x, caixa.y, caixa.w, caixa.h, -caixa.w / 2, -caixa.h / 2, caixa.w, caixa.h);
    return mimetype === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
  } catch {
    return src;
  }
}

export function VisualizadorReceita({ mimetype, base64 }: { mimetype: string; base64: string }) {
  const original = `data:${mimetype};base64,${base64}`;
  const [giro, setGiro] = useState(0);
  const [exibida, setExibida] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const visor = useRef<HTMLDivElement>(null);
  // Ponto (em fração da imagem) que deve ficar no centro depois de mudar o zoom.
  const foco = useRef<{ fx: number; fy: number } | null>(null);
  const arraste = useRef<{ x: number; y: number; sl: number; st: number; moveu: boolean } | null>(null);

  useEffect(() => {
    let vivo = true;
    preparar(original, mimetype, giro).then((url) => vivo && setExibida(url));
    return () => {
      vivo = false;
    };
  }, [original, mimetype, giro]);

  useLayoutEffect(() => {
    const v = visor.current;
    const f = foco.current;
    if (!v || !f) return;
    foco.current = null;
    v.scrollLeft = f.fx * v.scrollWidth - v.clientWidth / 2;
    v.scrollTop = f.fy * v.scrollHeight - v.clientHeight / 2;
  }, [zoom]);

  /** Muda o zoom mantendo no centro o ponto que está no centro (ou o ponto clicado). */
  const mudarZoom = (novo: number, ponto?: { fx: number; fy: number }) => {
    const v = visor.current;
    const alvo = Math.min(ZOOM_MAX, Math.max(1, novo));
    if (alvo === zoom) return;
    if (v) {
      foco.current = ponto ?? {
        fx: (v.scrollLeft + v.clientWidth / 2) / v.scrollWidth,
        fy: (v.scrollTop + v.clientHeight / 2) / v.scrollHeight,
      };
    }
    setZoom(alvo);
  };

  const girar = () => {
    setZoom(1);
    setGiro((g) => (g + 90) % 360);
  };

  const aoPressionar = (e: PointerEvent) => {
    const v = visor.current;
    if (!v || zoom === 1 || e.pointerType !== 'mouse') return;
    arraste.current = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop, moveu: false };
    v.setPointerCapture(e.pointerId);
  };
  const aoMover = (e: PointerEvent) => {
    const v = visor.current;
    const a = arraste.current;
    if (!v || !a) return;
    const dx = e.clientX - a.x;
    const dy = e.clientY - a.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
    v.scrollLeft = a.sl - dx;
    v.scrollTop = a.st - dy;
  };
  const aoSoltar = () => {
    arraste.current = null;
  };

  const aoClicar = (e: MouseEvent) => {
    if (zoom !== 1) return;
    const img = e.currentTarget as HTMLImageElement;
    const r = img.getBoundingClientRect();
    mudarZoom(ZOOM_CLIQUE, { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
  };

  return (
    <div class="kt-receita-visor">
      <div class="kt-receita-barra">
        <button type="button" class="kt-icone-botao kt-receita-acao" title="Diminuir" aria-label="Diminuir" disabled={zoom <= 1} onClick={() => mudarZoom(zoom - ZOOM_PASSO)}>
          <Icone nome="menos" />
        </button>
        <span class="kt-receita-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" class="kt-icone-botao kt-receita-acao" title="Aumentar" aria-label="Aumentar" disabled={zoom >= ZOOM_MAX} onClick={() => mudarZoom(zoom + ZOOM_PASSO)}>
          <Icone nome="mais" />
        </button>
        <button type="button" class="kt-icone-botao kt-receita-acao" title="Girar 90°" aria-label="Girar 90°" onClick={girar}>
          <Icone nome="atualizar" />
        </button>
        {zoom > 1 && (
          <button type="button" class="kt-link kt-receita-ajustar" onClick={() => setZoom(1)}>
            Ajustar
          </button>
        )}
      </div>
      <div
        ref={visor}
        class={`kt-receita-area${zoom > 1 ? ' kt-receita-ampliada' : ''}`}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
      >
        {exibida ? (
          <img src={exibida} alt="Imagem da receita" draggable={false} style={{ width: `${zoom * 100}%` }} onClick={aoClicar} />
        ) : (
          <p class="kt-carregando">
            <span class="kt-girando" aria-hidden="true" />
            Preparando a imagem…
          </p>
        )}
      </div>
      {zoom === 1 && exibida && <p class="kt-receita-dica">Toque na receita para ampliar.</p>}
    </div>
  );
}
