import type { AuthorizeResult } from '@slack/oauth';

import type { GrowiCommand } from './growi-command.js';

export interface GrowiCommandProcessor<
  ProcessCommandContext = { [key: string]: string },
> {
  shouldHandleCommand(growiCommand?: GrowiCommand): boolean;

  processCommand(
    growiCommand: GrowiCommand,
    authorizeResult: AuthorizeResult,
    context?: ProcessCommandContext,
  ): Promise<void>;
}
