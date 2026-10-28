# Alquimia × Concentra: implantação

Integração da Kentro (instância `alquimia`) com o ERP Concentra da farmácia, pela API `apiconc`.

```
Kentro (navegador do atendente)                 Doca (este serviço, HTTPS)               Farmácia
┌──────────────────────────────┐  omni.http   ┌──────────────────────────────┐  HTTP    ┌─────────────────────┐
│ Cartão "Concentra" (chatPanel)│────────────▶│ NestJS + Postgres            │────────▶│ apiconc :3000        │
│ Admin (menu do topo, admins)  │  chave      │ · cópia do cadastro (busca)  │ x-api-  │ (DuckDNS → servidor  │
└──────────────────────────────┘             │ · rascunhos, auditoria       │  key    │  192.168.1.250)      │
Automação "receita recebida" ───── webhook ──▶│ · leitura de receita (OpenAI)│         └─────────────────────┘
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

Variáveis: veja [.env.example](../.env.example). As obrigatórias são:
- `DATABASE_URL`, `URL_PUBLICA`;
- `CONCENTRA_API_URL`, `CONCENTRA_API_KEY`;
- `CHAVE_ATENDIMENTO`, `CHAVE_ADMIN`.

As que ligam recursos são:
- `OPENAI_API_KEY`, que liga a leitura de receita;
- `TOKEN_WEBHOOK_KENTRO`, que liga a pré-montagem.

Na primeira subida o serviço aplica as migrações e, em cerca de 20 segundos, copia o cadastro: produtos (11 mil), prescritores (11,5 mil) e clientes com compra nos últimos 2 anos (13 mil). Depois:
- a cada 30 minutos pega as alterações;
- todo dia refaz produtos e prescritores;
- toda semana refaz os clientes.

> Troque a senha do banco quando entrar em produção: ela apareceu num print durante o projeto.

## 2. Instalar as extensões na Kentro da Alquimia

Em **Configurações › Extensões instaladas › Instalar por URL**:

| Extensão | URL do manifest | Config |
|---|---|---|
| Alquimia × Concentra (cartão do atendente) | `{URL_PUBLICA}/extensao/atendimento/manifest.json` | `chave_atendimento` = CHAVE_ATENDIMENTO · `campo_cliente` = **1** (campo extra "ID Concentra", já criado) |
| Alquimia × Concentra — Admin | `{URL_PUBLICA}/extensao/admin/manifest.json` | `chave_admin` = CHAVE_ADMIN (só administradores veem) |

Para testar antes de liberar: instale o cartão do atendente com quem recebe = só o seu usuário. Depois abra para todos os atendentes.

## 3. Pré-montagem (receita lida antes de o atendente abrir o cartão)

Crie uma **Automação** na Kentro (depois do deploy, porque ela precisa da URL):
- disparo: mensagem recebida de **imagem** e de **PDF**, nas filas escolhidas;
- elemento **Requisição**: `POST {URL_PUBLICA}/v1/kentro/receita/{TOKEN_WEBHOOK_KENTRO}`, com o corpo:

| Campo | Valor |
|---|---|
| `chatId` | `{{chat_id}}` |
| `arquivoUrl` | `{{message_file.file_url}}` |
| `mimetype` | `{{message_file.file_mimetype}}` |
| `nome` | `{{message_file.file_name}}` |
| `telefone` | `{{chat_client_number}}` |
| `nomeContato` | `{{chat_client_name}}` |
| `contatoId` | `{{chat_contact_id}}` |

A IA também lê fotos que não são receita (ela marca "não é receita"). Para economizar, deixe a automação só nas filas de receita.

## 4. Assistente de atendimento inicial

Já criada na Kentro: **"Alquimia — Atendimento inicial"** (id 1). Ela usa GPT-5.5, lê foto, PDF e áudio, e tem um roteiro que pede a receita e transfere. Ainda não está em nenhuma fila nem na URA. Para ligar, coloque o elemento de assistente na URA da(s) fila(s) escolhida(s), antes do "transferir". Complete a base de conhecimento com as respostas do questionário do gestor.

## 5. Primeiro orçamento real (TESTE KENTRO)

1. Num atendimento seu, cartão Concentra › Orçamento › Manual.
2. Paciente "TESTE KENTRO", seu telefone, prescritor e CRM de teste. Inclua uma fórmula simples e, num segundo teste, um produto acabado.
3. "Revisei: gravar no Concentra" → confirmar.
4. Confira no Concentra se o orçamento existe e veja se o número apareceu no cartão. Depois peça para a farmácia **apagar** o orçamento de teste.

## Desenvolvimento

- `npm run db:local`: Postgres embutido (porta 54349).
- `npm test`: 25 testes, incluindo o envio ao ERP com uma Concentra falsa (não repete, não duplica, "envio incerto").
- `npm run build`: compila a API e as extensões em `dist/`.
