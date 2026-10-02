/**
 * @typedef {import('micromark-util-types').Extension} Extension
 */

import { codes } from 'micromark-util-symbol';

import { directiveLeaf } from './directive-leaf.js';
import { directiveText } from './directive-text.js';

/**
 * @returns {Extension}
 */
export function directive() {
  return {
    text: { [codes.dollarSign]: directiveText },
    flow: { [codes.dollarSign]: [directiveLeaf] },
  };
}
