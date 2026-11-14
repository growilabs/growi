-- `allowedInDirectMessage` is read only for commands that decide DMs by their
-- own flag. Existing rows get false, which `judge()` reads as "not allowed".
ALTER TABLE "channel_permission" ADD COLUMN "allowed_in_direct_message" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pending_agent_request" (
    "relation_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "installation_id" UUID NOT NULL,
    "origin" JSONB NOT NULL,
    "delivery_status" TEXT,
    "delivery_claimed_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pending_agent_request_pkey" PRIMARY KEY ("relation_id","request_id")
);

CREATE INDEX "pending_agent_request_expires_at_idx" ON "pending_agent_request"("expires_at");

ALTER TABLE "pending_agent_request" ADD CONSTRAINT "pending_agent_request_relation_id_fkey" FOREIGN KEY ("relation_id") REFERENCES "relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pending_agent_request" ADD CONSTRAINT "pending_agent_request_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
