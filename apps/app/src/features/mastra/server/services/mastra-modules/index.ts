import { Mastra } from '@mastra/core/mastra';
import { InMemoryStore } from '@mastra/core/storage';

import { growiAgent } from './agents/growi-agent';
import { suggestPathAgent } from './agents/suggest-path';

export const mastra = new Mastra({
  agents: {
    growiAgent,
    suggestPathAgent,
  },
  // Only per-run snapshots live here (threads use memory's MongoDB store).
  // Use a persistent store if agents ever suspend/resume.
  storage: new InMemoryStore(),
});
