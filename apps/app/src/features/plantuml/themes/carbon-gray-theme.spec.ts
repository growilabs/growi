import { describe, expect, it } from 'vitest';

import carbonGrayDark from './carbon-gray-dark.puml';
import carbonGrayLight from './carbon-gray-light.puml';

/*
 * Regression guard for growilabs/growi#11258.
 *
 * PlantUML's CommandSkinParam.executeArg() unconditionally attaches a
 * "Please use CSS style instead of skinparam <name>" warning to the diagram
 * whenever a `skinparam ParticipantPadding` or `skinparam padding` command is
 * parsed (name matched with equalsIgnoreCase). Affected PlantUML server
 * versions paint that warning straight into the rendered image.
 *
 * These theme strings are prepended to every user PlantUML diagram, so they
 * must not declare those two skinparams. `skinparam BoxPadding` is deliberately
 * NOT covered here: PlantUML does not warn on it, and the theme keeps it.
 */
describe('carbon-gray PlantUML theme', () => {
  // Anchor to line start (with /m) so only an actual `skinparam <name>` DIRECTIVE is
  // matched, not a mention inside a `'`-prefixed comment or prose — PlantUML parses
  // commands from line-leading tokens only, so a comment naming the skinparam is harmless.
  // Case-insensitive to mirror PlantUML's equalsIgnoreCase; `\b` keeps "BoxPadding" and
  // "ParticipantPadding" from being mistaken for the standalone "Padding".
  const warningTriggeringSkinparams = [
    {
      name: 'ParticipantPadding',
      pattern: /^\s*skinparam\s+ParticipantPadding\b/im,
    },
    { name: 'Padding', pattern: /^\s*skinparam\s+Padding\b/im },
  ];

  it.each([
    ['light', carbonGrayLight],
    ['dark', carbonGrayDark],
  ])('%s theme must not declare warning-triggering padding skinparams', (_name, theme) => {
    for (const { name, pattern } of warningTriggeringSkinparams) {
      expect(
        pattern.test(theme),
        `"skinparam ${name}" makes PlantUML paint a deprecation warning into every diagram (#11258)`,
      ).toBe(false);
    }
  });
});
