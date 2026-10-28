import { useMemo, useState } from 'preact/hooks';
import { criarApi, lerConfigInstalacao } from '../../comum/api';
import { Aviso } from '../../comum/componentes';
import { Icone, NomeIcone } from '../../comum/icones';
import type { CtxOmni, Omni } from '../../comum/omni';
import { AbaAuditoria, AbaConexao, AbaMensagem, AbaTipos } from './configuracoes';
import { AbaPainel } from './painel';

type Aba = 'painel' | 'mensagem' | 'tipos' | 'conexao' | 'auditoria';

const ABAS: { id: Aba; rotulo: string; icone: NomeIcone }[] = [
  { id: 'painel', rotulo: 'Impacto', icone: 'grafico' },
  { id: 'mensagem', rotulo: 'Mensagem do orçamento', icone: 'mensagem' },
  { id: 'tipos', rotulo: 'Tipos de fórmula', icone: 'lista' },
  { id: 'conexao', rotulo: 'Conexão e cadastro', icone: 'tomada' },
  { id: 'auditoria', rotulo: 'Auditoria', icone: 'historico' },
];

export function App({ omni, ctx }: { omni: Omni; ctx: CtxOmni }) {
  const { apiUrl, chave } = lerConfigInstalacao(ctx, 'chave_admin');
  const api = useMemo(() => (apiUrl && chave ? criarApi({ omni, apiUrl, chave, ctx }) : null), [omni, apiUrl, chave, ctx]);
  const [aba, setAba] = useState<Aba>('painel');

  return (
    <main class="kt-admin">
      <header class="kt-topo">
        <span class="kt-marca">
          <Icone nome="pilula" tamanho={22} />
        </span>
        <div class="kt-topo-titulos">
          <h1>Alquimia × Concentra</h1>
          <p class="kt-muted">Integração do atendimento com o Concentra: impacto, configuração e auditoria.</p>
        </div>
      </header>
      {!api ? (
        <Aviso tipo="erro">Configure a extensão com o endereço da integração e a chave de admin (CHAVE_ADMIN do serviço no Doca).</Aviso>
      ) : (
        <>
          <nav class="kt-abas" role="tablist">
            {ABAS.map((a) => (
              <button key={a.id} type="button" role="tab" class="kt-aba" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
                <Icone nome={a.icone} tamanho={15} />
                {a.rotulo}
              </button>
            ))}
          </nav>
          {aba === 'painel' && <AbaPainel api={api} />}
          {aba === 'mensagem' && <AbaMensagem api={api} />}
          {aba === 'tipos' && <AbaTipos api={api} />}
          {aba === 'conexao' && <AbaConexao api={api} />}
          {aba === 'auditoria' && <AbaAuditoria api={api} />}
        </>
      )}
    </main>
  );
}
