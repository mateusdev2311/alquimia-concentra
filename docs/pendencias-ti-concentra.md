# Pendências da API Concentra (para o TI da farmácia e a Concentra)

Levantadas em 28/10/2026, com consultas só de leitura à API `apiconc` da Alquimia.

## Para a Concentra

1. **Tabela de códigos do campo `tipo` do `gerar_orcamento`** (ex.: `010100`), com o nome de cada tipo. Nos orçamentos da Alquimia aparecem 25 nomes: Cápsulas, Creme, Gel, Serun/transder, Sache Interno, Solução, Solução 2, SUSPENSAO, SUB-LINGUAL CP, SHAMPOO, Loção, Loção 2, Pomada, ESMALTE, Spray, Óvulos, Xarope, Sabonete, Subst. pura pó, Subst.pura líq., OMEPRAZOL, Produto Entrega, Produto balcão, Cáps. Prontas e Prod. Convenio. Enquanto não houver códigos, o orçamento vai sem `tipo` (a Concentra aplica o padrão dela).
2. **`gerar_orcamento` devolve o número do orçamento criado?** Pela documentação, não. Hoje a integração procura o orçamento mais novo do paciente com o mesmo valor. Pedimos que o número venha na resposta.
3. **Produto acabado no `gerar_orcamento`:** qual `tipo` usar ("Produto balcão"? "Produto Entrega"?) e como informar a quantidade. Hoje ele vai como uma fórmula de um componente: `qsp` = quantidade, componente com o código do produto, `dosagem` = quantidade e unidade `UN`.
4. **Busca por número em `listar_orcamento_por_numero`:** um orçamento de 10 dias atrás (presente na listagem geral) deu "não encontrado" pelo número. A busca por número só acha orçamentos em aberto?
5. **`"TUDO"` não funciona** em `listar_orcamento_por_numero` (responde "Nenhum registro encontrado para: TUDO"). Só o campo vazio lista. A documentação precisa ser corrigida.
6. **Erros chegam com HTTP 200** e dentro de uma lista (`[{"erro": "..."}]`). A documentação diz `{"erro": ...}`. Ok manter, mas é bom documentar.
7. **Função para listar as receitas de um cliente** (por id ou CPF), para o atendente achar a receita sem saber o número. Hoje só existe a busca por número + ano + mês.
8. **Busca de cliente por telefone ou CPF.** Hoje só existe por nome. A integração montou um índice próprio por telefone a partir de `listar_info_clientes_por_ultima_compra`.
9. **Convênios:** existe uma lista dos valores aceitos em `convenio`? Por decisão da farmácia, hoje ele vai sempre vazio.
10. **Ambiente de homologação:** existe, ou é possível ter um cliente de teste que não entra em relatório?

## Para o TI da farmácia

0. **URGENTE: liberar o servidor do Doca (IP 169.58.192.233) na porta 3000.** Em 28/10/2026, a partir do Doca, o DNS resolve (`alquimiabraganca.duckdns.org` → 177.189.75.241), mas a conexão TCP na porta 3000 não responde em 8 s. Da rede de um dos técnicos, a mesma porta abre em 33 ms. Conferir:
   - o redirecionamento da porta 3000 no modem (alguns modens só redirecionam para certas origens ou bloqueiam IPs de fora do Brasil);
   - a regra do Firewall do Windows no servidor 192.168.1.250 (o escopo de "Endereço IP remoto" deve ser Qualquer, ou incluir 169.58.192.233);
   - antivírus ou firewall de terceiros no servidor.

   Depois, teste em Admin › Conexão e cadastro › Testar conexão: o passo "Porta 3000" precisa ficar verde.
1. **A porta 3000 está aberta para a internet, em HTTP sem criptografia.** A chave da API trafega sem proteção entre o Doca e a farmácia. Por decisão da Alquimia (28/10/2026), a porta **não** será restringida por IP. Se um dia quiserem proteger sem mexer no firewall, a saída é um túnel (Cloudflare Tunnel, Tailscale ou VPN) até o servidor `192.168.1.250`.
2. **Servidor desligado = integração parada.** O cartão do atendente avisa "sistema da farmácia fora do ar", e o admin mostra desde quando. A busca de produto e o cliente já identificado continuam funcionando, pela cópia local.
3. **DuckDNS:** confirmar que o atualizador do IP dinâmico roda no próprio servidor (ou no modem) e volta sozinho depois de uma queda de energia.

## Para a Alquimia (confirmar)

1. ~~Rio Preto ou Bragança?~~ **Resolvido (29/10/2026):** é uma loja só, em Bragança Paulista (resposta do Silvio). A mensagem de boas-vindas da URA da Kentro ainda fala em "entrega gratuita em Rio Preto", traz o Instagram `farmaciaalquimiarp` e usa o horário 8h–18h / sábado 8h–12h. O certo é 8h30–18h / sábado 8h30–13h. Corrigir a URA.
2. Quem apaga no Concentra o orçamento de teste "TESTE KENTRO".
