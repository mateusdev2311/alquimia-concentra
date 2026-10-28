import { useEffect, useState } from 'preact/hooks';
import { Api, mensagemDeErro } from '../../comum/api';
import { Aviso, CaixaChave, Carregando, Secao } from '../../comum/componentes';

export interface ChavesNovas {
  chaveAdmin: string;
  chaveAtendimento: string;
}

/** As chaves recém-geradas: aparecem uma vez só, com onde colar cada uma. */
export function ChavesGeradas({ chaves }: { chaves: ChavesNovas }) {
  return (
    <Secao icone="chave" titulo="Integração ativada" descricao="Copie as duas chaves agora: elas não aparecem de novo.">
      <CaixaChave rotulo="Chave de admin" valor={chaves.chaveAdmin}>
        Cole em <strong>Configurações › Extensões instaladas › Alquimia × Concentra — Admin › Chave de admin</strong>.
      </CaixaChave>
      <CaixaChave rotulo="Chave de atendimento" valor={chaves.chaveAtendimento}>
        Cole em <strong>Configurações › Extensões instaladas › Alquimia × Concentra › Chave de atendimento</strong>. Nunca troque as duas de lugar: a de
        atendimento chega ao navegador de todos os atendentes.
      </CaixaChave>
      <Aviso>Depois de salvar a chave de admin na instalação, feche e abra esta tela de novo.</Aviso>
    </Secao>
  );
}

/** Primeiro uso, sem chave na instalação: ativa a integração (só funciona uma vez) ou explica o que falta. */
export function Ativacao({ api }: { api: Api }) {
  const [ativada, setAtivada] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ativando, setAtivando] = useState(false);
  const [chaves, setChaves] = useState<ChavesNovas | null>(null);

  useEffect(() => {
    api<{ ativada: boolean }>('/v1/ativacao').then(
      (r) => setAtivada(r.ativada),
      (e) => setErro(mensagemDeErro(e)),
    );
  }, [api]);

  const ativar = async () => {
    setAtivando(true);
    setErro(null);
    try {
      setChaves(await api<ChavesNovas>('/v1/ativacao', { method: 'POST' }));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setAtivando(false);
    }
  };

  if (chaves) return <ChavesGeradas chaves={chaves} />;
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (ativada == null) return <Carregando />;
  if (ativada) {
    return (
      <Aviso tipo="erro">
        A integração já foi ativada, mas esta instalação está sem a <strong>chave de admin</strong>. Cole a chave gerada na ativação em Configurações › Extensões
        instaladas › Alquimia × Concentra — Admin. Se ela se perdeu, defina <code>REDEFINIR_CHAVES=sim</code> no Doca, reinicie o serviço, ative de novo
        aqui e depois apague a variável.
      </Aviso>
    );
  }
  return (
    <Secao
      icone="chave"
      titulo="Ativar a integração"
      descricao="Gera a chave de admin (desta extensão) e a chave de atendimento (do cartão dos atendentes). Só precisa fazer uma vez."
    >
      <button type="button" class="kt-botao" disabled={ativando} onClick={ativar}>
        {ativando ? 'Ativando…' : 'Ativar e gerar as chaves'}
      </button>
    </Secao>
  );
}
