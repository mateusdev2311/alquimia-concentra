-- CreateEnum
CREATE TYPE "StatusRascunho" AS ENUM ('lendo', 'pronto', 'erro', 'enviado', 'descartado');

-- CreateEnum
CREATE TYPE "OrigemRascunho" AS ENUM ('manual', 'ia', 'automacao');

-- CreateTable
CREATE TABLE "produtos" (
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "familia" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,
    "preco" DOUBLE PRECISION NOT NULL,
    "controlado" BOOLEAN NOT NULL,
    "portarias" TEXT[],
    "excluido" BOOLEAN NOT NULL,
    "sinonimo" BOOLEAN NOT NULL,
    "principal" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "prescritores" (
    "chave" TEXT NOT NULL,
    "conselho" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "especialidade" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescritores_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "chaves_telefone" TEXT[],
    "telefones" TEXT[],
    "cpf" TEXT,
    "email" TEXT,
    "endereco" JSONB,
    "nascimento" TEXT,
    "sexo" TEXT,
    "ultima_compra" DATE,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rascunhos" (
    "id" UUID NOT NULL,
    "chat_id" TEXT NOT NULL,
    "contato_id" TEXT,
    "usuario_id" TEXT,
    "usuario_nome" TEXT,
    "origem" "OrigemRascunho" NOT NULL,
    "status" "StatusRascunho" NOT NULL,
    "arquivo" JSONB,
    "leitura" JSONB,
    "dados" JSONB NOT NULL,
    "erro" TEXT,
    "segundos_leitura" DOUBLE PRECISION,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rascunhos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamentos_enviados" (
    "id" UUID NOT NULL,
    "rascunho_id" UUID,
    "numero" TEXT,
    "usuario_id" TEXT,
    "usuario_nome" TEXT,
    "origem" "OrigemRascunho" NOT NULL,
    "formulas" INTEGER NOT NULL,
    "componentes" INTEGER NOT NULL,
    "corrigidos" INTEGER NOT NULL DEFAULT 0,
    "valor_liquido" DOUBLE PRECISION,
    "valor_bruto" DOUBLE PRECISION,
    "segundos_montagem" DOUBLE PRECISION,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamentos_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" TEXT,
    "usuario_nome" TEXT,
    "acao" TEXT NOT NULL,
    "alvo" TEXT,
    "detalhes" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "sincronizacoes" (
    "recurso" TEXT NOT NULL,
    "ultima_tentativa" TIMESTAMP(3),
    "ultimo_sucesso" TIMESTAMP(3),
    "ultima_carga_total" TIMESTAMP(3),
    "registros" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "em_execucao_ate" TIMESTAMP(3),

    CONSTRAINT "sincronizacoes_pkey" PRIMARY KEY ("recurso")
);

-- CreateIndex
CREATE INDEX "prescritores_numero_idx" ON "prescritores"("numero");

-- CreateIndex
CREATE INDEX "clientes_chaves_telefone_idx" ON "clientes" USING GIN ("chaves_telefone");

-- CreateIndex
CREATE INDEX "rascunhos_chat_id_idx" ON "rascunhos"("chat_id");

-- CreateIndex
CREATE INDEX "rascunhos_criado_em_idx" ON "rascunhos"("criado_em");

-- CreateIndex
CREATE INDEX "orcamentos_enviados_criado_em_idx" ON "orcamentos_enviados"("criado_em");

-- CreateIndex
CREATE INDEX "eventos_criado_em_idx" ON "eventos"("criado_em");

-- CreateIndex
CREATE INDEX "eventos_acao_criado_em_idx" ON "eventos"("acao", "criado_em");

