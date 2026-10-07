/**
 * @typedef {import('micromark-util-types').Effects} Effects
 * @typedef {import('micromark-util-types').State} State
 */
import { factorySpace } from 'micromark-factory-space';
import { markdownLineEnding, markdownSpace } from 'micromark-util-character';
import { codes } from 'micromark-util-symbol';

export function markdownLineEndingOrSpaceOrComma(code) {
  return (
    code !== null &&
    (code < codes.nul || code === codes.space || code === codes.comma)
  );
}

/**
 * @param {Effects} effects
 * @param {State} ok
 */
export function factoryAttributesDevider(effects, ok) {
  /** @type {boolean} */
  let seen;
  return start;
  /** @type {State} */

  function start(code) {
    if (markdownLineEnding(code)) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      seen = true;
      return start;
    }

    // consume comma
    if (code === codes.comma) {
      effects.enter('attributeDevider');
      effects.consume(code);
      effects.exit('attributeDevider');
      seen = true;
      return start;
    }

    if (markdownSpace(code)) {
      return factorySpace(
        effects,
        start,
        seen ? 'linePrefix' : 'lineSuffix',
      )(code);
    }

    return ok(code);
  }
}
