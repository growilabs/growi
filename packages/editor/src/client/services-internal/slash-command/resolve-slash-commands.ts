import type { TFunction } from 'i18next';

import { SLASH_COMMANDS } from './slash-command-definitions.js';
import type {
  ResolvedSlashCommand,
  SlashCommand,
} from './slash-command-types.js';

/**
 * Resolve each command's i18n keys into display strings (Req 1.3, 7.1).
 *
 * Pure function: for every command it attaches `label = t(labelKey)` and
 * `description = t(descriptionKey)`, returning a fresh `ResolvedSlashCommand[]`
 * without mutating the inputs. `commands` defaults to the single-source
 * `SLASH_COMMANDS` set.
 *
 * Language fallback (Req 7.2) is delegated to i18next's own `fallbackLng`: this
 * function merely calls `t`, so an untranslated key surfaces the default-language
 * string that i18next returns.
 *
 * @param t - i18next `t` bound to the `translation` namespace.
 * @param commands - Command definitions to resolve (defaults to `SLASH_COMMANDS`).
 */
export const resolveSlashCommands = (
  t: TFunction,
  commands: readonly SlashCommand[] = SLASH_COMMANDS,
): ResolvedSlashCommand[] => {
  return commands.map((command) => ({
    ...command,
    label: t(command.labelKey),
    description: t(command.descriptionKey),
  }));
};
