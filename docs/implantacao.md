# Alquimia × Concentra: implantação

Integração da Kentro (instância `alquimia`) com o ERP Concentra da farmácia, pela API `apiconc`.

```
Kentro (navegador do atendente)                 Doca (este serviço, HTTPS)               Farmácia
┌──────────────────────────────┐  omni.http   ┌──────────────────────────────┐  HTTP    ┌─────────────────────┐
│ Cartão "Concentra" (chatPanel)│────────────▶│ NestJS + Postgres            │────────▶│ apiconc :3000        │
│ Admin (menu do topo, admins)  │  chave      │ · cópia do cadastro (busca)  │ x-api-  │ (DuckDNS → servidor  │
└──────────────┬───────────────┘             │ · rascunhos, auditoria       │  key    │  192.168.1.250)      │
   runAutomation│                             │ · casa a leitura c/ cadastro │         └─────────────────────┘
┌──────────────▼───────────────┐   POST JSON │                              │
│ Automação "Ler receita"       │────────────▶│ /v1/kentro/leitura/{token}   │
│ aiProcessFile (IA da Kentro)  │             └──────────────────────────────┘
└──────────────────────────────┘
```

- O navegador nunca fala com a Concentra: a chave da API fica só no Doca.
- As extensões (manifest + telas) são servidas pelo próprio serviço em `/extensao/...`.
- `gerar_orcamento` grava no ERP de produção. Só sai depois de o atendente revisar e confirmar. Nunca é repetido sozinho.

## 1. Subir no Doca

| Campo | Valor |
|---|---|
| Tipo | API ou microsserviço (NestJS) |
| Pasta do projeto | `extensão-kentro/Alquimia-concentra` (o build precisa de `extension/`) |
| Construir | `npm run build` → `dist/main.js` |
| Iniciar | `npm start` |
| Porta / verificação | 3000 / `GET /` (responde `{"ok":true}`) |
| Memória / CPU | 512 MB / 0,5 (a cópia do cadastro tem cerca de 11 mil produtos em memória) |
| Banco | ligar o projeto ao Postgres `mateus_alquimia_concentra` (está criado, mas **não ligado**) |
| Subdomínio | com HTTPS, ex.: `https://concentra.kentro.com.br` (é o `URL_PUBLICA`) |

Variáveis: só quatro, veja [.env.example](../.env.example).
- `DATABASE_URL` e `URL_PUBLICA`;
- `CONCENTRA_API_URL` e `CONCENTRA_API_KEY`.

As chaves das extensões não vão no Doca: são geradas na ativação (passo 2). A IA também não: quem lê a receita é a IA da Kentro (passo 3).

Na primeira subida o serviço aplica as migrações e, em cerca de 20 segundos, copia o cadastro: produtos (11 mil), prescritores (11,5 mil) e clientes com compra nos últimos 2 anos (13 mil). Depois:
- a cada 30 minutos pega as alterações;
- todo dia refaz produtos e prescritores;
- toda semana refaz os clientes.

> Troque a senha do banco quando entrar em produção: ela apareceu num print durante o projeto.

## 2. Instalar as extensões e ativar

1. Em **Configurações › Extensões instaladas › Instalar por URL**, instale o **Admin**: `{URL_PUBLICA}/extensao/admin/manifest.json`. Deixe a chave de admin **vazia**.
2. Abra **Concentra** no menu do topo (só administradores veem) › **Ativar e gerar as chaves**. Aparecem a chave de admin e a chave de atendimento, **uma vez só**.
3. Cole a **chave de admin** na instalação do Admin.
4. Instale o **cartão do atendente**: `{URL_PUBLICA}/extensao/atendimento/manifest.json`, com:
   - a chave de atendimento da ativação;
   - `campo_cliente` = **1**, que já vem preenchido (é o campo extra "ID Concentra", já criado);
   - `automacao_leitura` = id da automação do passo 3.
5. Para testar antes de liberar, faça o cartão chegar só ao seu usuário. Depois abra para todos os atendentes.

Se a chave de admin se perder: `REDEFINIR_CHAVES=sim` no Doca, reinicie, ative de novo e tire a variável.

## 3. Automação "Ler receita" (a IA da Kentro lê, a integração casa com o cadastro)

Uma automação só serve aos dois caminhos: o botão "Receita → Orçamento" do cartão e a pré-montagem quando a receita chega. Os valores para copiar (URL com o token, instrução e corpo) ficam no Admin › **Conexão e cadastro › Leitura de receita**.

Uma automação faz o seguinte, nesta ordem:
1. **Processar arquivo por IA** (`aiProcessFile`), com:
   - modelo GPT-5.5;
   - arquivo `{{arquivo_id}}` (pelo cartão) ou `{{message_file.file_id}}` (pela mensagem recebida);
   - a instrução copiada do Admin;
   - resultado na variável `receita_lida`.
2. **Requisição** `POST` para a URL do Admin, com o corpo do Admin.

- **Pelo cartão:** a extensão chama a automação com as variáveis `rascunho_id`, `arquivo_id`, `arquivo_nome`, `arquivo_tipo`, `chat_id` e `cliente_id`.
- **Pré-montagem:** uma cópia da automação com disparo em mensagem de imagem e de PDF, nas filas de receita. Nela, `arquivo_id` vira `{{message_file.file_id}}` e `rascunho_id` fica vazio.

A integração também lê fotos que não são receita, que voltam marcadas como "não é receita". Para economizar, deixe a pré-montagem só nas filas de receita.

## 4. Assistente de atendimento inicial

Já criada na Kentro: **"Alquimia — Atendimento inicial"** (id 1). Ela usa GPT-5.5, lê foto, PDF e áudio, e tem um roteiro que pede a receita e transfere. Ainda não está em nenhuma fila nem na URA. Para ligar, coloque o elemento de assistente na URA da(s) fila(s) escolhida(s), antes do "transferir". Complete a base de conhecimento com as respostas do questionário do gestor.

## 5. Primeiro orçamento real (TESTE KENTRO)

1. Num atendimento seu, cartão Concentra › Orçamento › Manual.
2. Paciente "TESTE KENTRO", seu telefone, prescritor e CRM de teste. Inclua uma fórmula simples e, num segundo teste, um produto acabado.
3. "Revisei: gravar no Concentra" → confirmar.
4. Confira no Concentra se o orçamento existe e veja se o número apareceu no cartão. Depois peça para a farmácia **apagar** o orçamento de teste.

## Desenvolvimento

- `npm run db:local`: Postgres embutido (porta 54349).
- `npm test`: 30 testes, incluindo a ativação, a leitura vinda da automação e o envio ao ERP com uma Concentra falsa (não repete, não duplica, "envio incerto").
- `npm run build`: compila a API e as extensões em `dist/`.
