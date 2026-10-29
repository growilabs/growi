import {
  loadReactionChips,
  type ReactionChip,
} from '~/features/comment-reaction/server';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import { toCreatorSummary } from '../serializers/to-comment-list-item';

const logger = loggerFactory(
  'growi:features:comment:service:load-reaction-chips-or-null',
);

type LoadReactionChipsOrNullDeps = {
  readonly prisma: Pick<typeof prisma, 'commentreactions' | 'users'>;
};

type LoadReactionChipsOrNullInput = {
  readonly commentIds: readonly string[];
  readonly viewerId: string | null;
};

// A reaction load failure must not hide the comments: it yields null instead.
export const loadReactionChipsOrNull = async (
  { prisma: client }: LoadReactionChipsOrNullDeps,
  { commentIds, viewerId }: LoadReactionChipsOrNullInput,
): Promise<ReadonlyMap<string, readonly ReactionChip[]> | null> => {
  try {
    return await loadReactionChips(
      { prisma: client },
      { commentIds, viewerId, formatUser: toCreatorSummary },
    );
  } catch (err) {
    logger.error('Failed to load comment reactions', err);
    return null;
  }
};
