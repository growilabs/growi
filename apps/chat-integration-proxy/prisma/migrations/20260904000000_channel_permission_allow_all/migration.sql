-- Carries `RelationSettings.allowedChannels === 'all'`, which the `channels`
-- array cannot express: an empty array already means "no channel permitted".
ALTER TABLE "channel_permission" ADD COLUMN "allow_all" BOOLEAN NOT NULL DEFAULT false;
