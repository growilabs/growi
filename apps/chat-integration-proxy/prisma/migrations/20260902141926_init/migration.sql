-- CreateTable
CREATE TABLE "installation" (
    "id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "workspace_name" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channels_synced_at" TIMESTAMPTZ(3),

    CONSTRAINT "installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relation" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "growi_uri" TEXT NOT NULL,
    "growi_label" TEXT NOT NULL,
    "search_weight" INTEGER NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_key" (
    "id" UUID NOT NULL,
    "relation_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "public_key_jwk" JSONB NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "peer_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "own_key" (
    "id" UUID NOT NULL,
    "relation_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "superseded_key_id" TEXT,
    "delivered_to_peer_at" TIMESTAMPTZ(3),

    CONSTRAINT "own_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_order" (
    "id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "relation_id" UUID,

    CONSTRAINT "pairing_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_nonce" (
    "relation_id" UUID NOT NULL,
    "key_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_nonce_pkey" PRIMARY KEY ("relation_id","key_id","nonce")
);

-- CreateTable
CREATE TABLE "processed_notification_target" (
    "relation_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "processed_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processed_notification_target_pkey" PRIMARY KEY ("relation_id","request_id","platform","channel_id")
);

-- CreateTable
CREATE TABLE "installation_channel" (
    "installation_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL,
    "refreshed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "installation_channel_pkey" PRIMARY KEY ("installation_id","channel_id")
);

-- CreateTable
CREATE TABLE "channel_permission" (
    "id" UUID NOT NULL,
    "relation_id" UUID NOT NULL,
    "command_name" TEXT NOT NULL,
    "channels" TEXT[],

    CONSTRAINT "channel_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_collection" (
    "correlation_id" TEXT NOT NULL,
    "relation_id" UUID,
    "platform" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "actor_account_id" TEXT NOT NULL,
    "command_name" TEXT NOT NULL,
    "invocation" JSONB NOT NULL,
    "collected" JSONB NOT NULL,
    "offered_options" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pending_collection_pkey" PRIMARY KEY ("correlation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installation_platform_workspace_id_key" ON "installation"("platform", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "relation_installation_id_growi_uri_key" ON "relation"("installation_id", "growi_uri");

-- CreateIndex
CREATE UNIQUE INDEX "peer_key_relation_id_key_id_key" ON "peer_key"("relation_id", "key_id");

-- CreateIndex
CREATE UNIQUE INDEX "own_key_relation_id_key_id_key" ON "own_key"("relation_id", "key_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_order_code_hash_key" ON "pairing_order"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "channel_permission_relation_id_command_name_key" ON "channel_permission"("relation_id", "command_name");

-- CreateIndex
CREATE INDEX "pending_collection_platform_channel_id_actor_account_id_idx" ON "pending_collection"("platform", "channel_id", "actor_account_id");

-- AddForeignKey
ALTER TABLE "relation" ADD CONSTRAINT "relation_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_key" ADD CONSTRAINT "peer_key_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "own_key" ADD CONSTRAINT "own_key_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_order" ADD CONSTRAINT "pairing_order_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_order" ADD CONSTRAINT "pairing_order_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_nonce" ADD CONSTRAINT "request_nonce_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_notification_target" ADD CONSTRAINT "processed_notification_target_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_channel" ADD CONSTRAINT "installation_channel_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_permission" ADD CONSTRAINT "channel_permission_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_collection" ADD CONSTRAINT "pending_collection_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

