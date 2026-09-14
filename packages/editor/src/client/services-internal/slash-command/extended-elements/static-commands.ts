import type { SlashCommand } from '../slash-command-types.js';
import { CALLOUT_VARIANTS } from './callout-variants.js';
import {
  calloutInsertion,
  lsxInsertion,
  plantumlInsertion,
} from './insertion-builders.js';

/**
 * Static (side-effect-free) extended commands: plantuml + one command per callout
 * variant + lsx.
 *
 * plantuml and callout are block elements, so they declare
 * `disallowedIn: ['list','table']` (base context exclusion — a fence or `:::`
 * directive would break a list item / table cell). lsx is an INLINE growi directive
 * (`$lsx()`), so it declares no `disallowedIn` and is offered everywhere. The callout
 * set is generated from {@link CALLOUT_VARIANTS} so a variant added in `@growi/core`
 * propagates here.
 *
 * i18n keys follow the base convention `slash_command.<id>.(label|description)`;
 * callout ids are `callout-<type>` and its keys `slash_command.callout.<type>.*`.
 */
export const STATIC_EXTENDED_COMMANDS: readonly SlashCommand[] = [
  {
    id: 'plantuml',
    labelKey: 'slash_command.plantuml.label',
    descriptionKey: 'slash_command.plantuml.description',
    keywords: ['uml', 'sequence'],
    disallowedIn: ['list', 'table'],
    action: { kind: 'insert', buildInsertion: plantumlInsertion },
  },
  ...CALLOUT_VARIANTS.map(
    (v): SlashCommand => ({
      id: `callout-${v.type}`,
      labelKey: `slash_command.callout.${v.type}.label`,
      descriptionKey: `slash_command.callout.${v.type}.description`,
      keywords: ['callout', ...v.keywords],
      disallowedIn: ['list', 'table'],
      action: { kind: 'insert', buildInsertion: calloutInsertion(v.type) },
    }),
  ),
  {
    id: 'lsx',
    labelKey: 'slash_command.lsx.label',
    descriptionKey: 'slash_command.lsx.description',
    // id `lsx` so both `/ls` and `/lsx` reach it by prefix match on the id.
    keywords: ['ls', 'list', 'pages', 'tree'],
    // Inline directive: no `disallowedIn` — valid inside a table cell / list item.
    action: { kind: 'insert', buildInsertion: lsxInsertion },
  },
];
