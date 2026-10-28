import { useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { dinheiro } from '../../comum/formato';
import type { Alternativa, ProdutoAchado } from './tipos';

export type TipoBusca = 'materia-prima' | 'acabado' | 'excipiente' | 'todos';

/** Busca no cadastro (espelho local, tolerante a erro). Enter ou o botão buscam: cada busca conta no limite da Kentro. */
export function BuscaProduto({
  api,
  tipo = 'todos',
  inicial = '',
  sugestoes = [],
  aoEscolher,
  aoCancelar,
  placeholder = 'Nome do produto',
}: {
  api: Api;
  tipo?: TipoBusca;
  inicial?: string;
  /** Alternativas que a IA já achou (aparecem antes de buscar). */
  sugestoes?: Alternativa[];
  aoEscolher: (p: ProdutoAchado) => void;
  aoCancelar?: () => void;
  placeholder?: string;
}) {
  const [termo, setTermo] = useState(inicial);
  const [estado, setEstado] = useState<{ tipo: 'parado' | 'buscando' | 'ok' | 'erro'; produtos: ProdutoAchado[]; erro?: string }>({
    tipo: 'parado',
    produtos: sugestoes.map((s) => ({ codigo: s.codigo, descricao: s.descricao, unidade: s.unidade, preco: null, pontuacao: s.pontuacao })),
  });

  const buscar = async (e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (termo.trim().length < 2) return;
    setEstado({ tipo: 'buscando', produtos: [] });
    try {
      const filtro = tipo === 'todos' ? '' : `&tipo=${tipo}`;
      const r = await api<{ produtos: ProdutoAchado[] }>(`/v1/produtos?q=${encodeURIComponent(termo.trim())}${filtro}`);
      setEstado({ tipo: 'ok', produtos: r.produtos });
    } catch (erro) {
      setEstado({ tipo: 'erro', produtos: [], erro: mensagemDeErro(erro) });
    }
  };

  return (
    <div>
      <form class="kt-busca" onSubmit={buscar}>
        <input
          value={termo}
          placeholder={placeholder}
          onInput={(e) => setTermo((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Escape' && aoCancelar?.()}
          autoFocus
        />
        <button type="submit" class="kt-botao kt-botao-pequeno" disabled={termo.trim().length < 2 || estado.tipo === 'buscando'}>
          Buscar
        </button>
        {aoCancelar && (
          <button type="button" class="kt-botao kt-botao-fantasma kt-botao-pequeno" onClick={aoCancelar}>
            ✕
          </button>
        )}
      </form>
      {estado.tipo === 'buscando' && <p class="kt-muted">Buscando…</p>}
      {estado.tipo === 'erro' && <p class="kt-alerta-linha kt-alerta-erro">{estado.erro}</p>}
      {estado.tipo === 'ok' && estado.produtos.length === 0 && <p class="kt-muted">Nada encontrado. Tente outra grafia ou só o começo do nome.</p>}
      {estado.produtos.length > 0 && (
        <ul class="kt-sugestoes">
          {estado.produtos.map((p) => (
            <li key={p.codigo} tabIndex={0} onClick={() => aoEscolher(p)} onKeyDown={(e) => e.key === 'Enter' && aoEscolher(p)}>
              {p.descricao}
              <small>
                {p.codigo}
                {p.unidade ? ` · ${p.unidade}` : ''}
                {p.preco ? ` · ${dinheiro(p.preco)}${p.unidade ? `/${p.unidade}` : ''}` : ''}
                {p.controlado ? ' · CONTROLADO' : ''}
                {p.viaSinonimo ? ` · sinônimo: ${p.viaSinonimo}` : ''}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
