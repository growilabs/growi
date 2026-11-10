-- Set only when a follow-up question was delivered by DM. Existing rows stay
-- NULL, so nothing needs rewriting.
ALTER TABLE "pending_collection" ADD COLUMN "answer_channel_id" TEXT;

CREATE INDEX "pending_collection_platform_answer_channel_id_actor_account_idx" ON "pending_collection"("platform", "answer_channel_id", "actor_account_id");
