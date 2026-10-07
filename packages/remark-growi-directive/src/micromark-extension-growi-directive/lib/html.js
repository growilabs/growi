/**
 * @typedef {import('micromark-util-types').HtmlExtension} HtmlExtension
 * @typedef {import('micromark-util-types').Handle} _Handle
 * @typedef {import('micromark-util-types').CompileContext} CompileContext
 */

/**
 * @typedef {[string, string]} Attribute
 *
 * @typedef Directive
 * @property {DirectiveType} type
 * @property {string} name
 * @property {string} [label]
 * @property {Record<string, string>} [attributes]
 * @property {string} [content]
 * @property {number} [_fenceCount]
 *
 * @typedef {(this: CompileContext, directive: Directive) => boolean|void} Handle
 *
 * @typedef {Record<string, Handle>} HtmlOptions
 */

import { parseEntities } from 'parse-entities';
import { ok as assert } from 'uvu/assert';

import { DirectiveType } from '../../mdast-util-growi-directive/lib/index.js';

const own = {}.hasOwnProperty;

/**
 * @param {HtmlOptions} [options]
 * @returns {HtmlExtension}
 */
export function directiveHtml(options = {}) {
  return {
    enter: {
      directiveGrowiLeaf() {
        return enter.call(this, DirectiveType.Leaf);
      },
      directiveGrowiLeafAttributes: enterAttributes,
      directiveGrowiLeafLabel: enterLabel,

      directiveGrowiText() {
        return enter.call(this, DirectiveType.Text);
      },
      directiveGrowiTextAttributes: enterAttributes,
      directiveGrowiTextLabel: enterLabel,
    },
    exit: {
      directiveGrowiLeaf: exit,
      directiveGrowiLeafAttributeName: exitAttributeName,
      directiveGrowiLeafAttributeValue: exitAttributeValue,
      directiveGrowiLeafAttributes: exitAttributes,
      directiveGrowiLeafLabel: exitLabel,
      directiveGrowiLeafName: exitName,

      directiveGrowiText: exit,
      directiveGrowiTextAttributeName: exitAttributeName,
      directiveGrowiTextAttributeValue: exitAttributeValue,
      directiveGrowiTextAttributes: exitAttributes,
      directiveGrowiTextLabel: exitLabel,
      directiveGrowiTextName: exitName,
    },
  };

  /**
   * @this {CompileContext}
   * @param {DirectiveType} type
   */
  function enter(type) {
    /** @type {Directive[]} */
    let stack = this.getData('directiveStack');
    if (!stack) {
      stack = [];
      this.setData('directiveStack', stack);
    }
    stack.push({ type, name: '' });
  }

  /** @type {_Handle} */
  function exitName(token) {
    /** @type {Directive[]} */
    const stack = this.getData('directiveStack');
    stack[stack.length - 1].name = this.sliceSerialize(token);
  }

  /** @type {_Handle} */
  function enterLabel() {
    this.buffer();
  }

  /** @type {_Handle} */
  function exitLabel() {
    const data = this.resume();
    /** @type {Directive[]} */
    const stack = this.getData('directiveStack');
    stack[stack.length - 1].label = data;
  }

  /** @type {_Handle} */
  function enterAttributes() {
    this.buffer();
    this.setData('directiveAttributes', []);
  }

  /** @type {_Handle} */
  function exitAttributeName(token) {
    // Attribute names in CommonMark are significantly limited, so character
    // references can’t exist.
    /** @type {Attribute[]} */
    const attributes = this.getData('directiveAttributes');

    attributes.push([this.sliceSerialize(token), '']);
  }

  /** @type {_Handle} */
  function exitAttributeValue(token) {
    /** @type {Attribute[]} */
    const attributes = this.getData('directiveAttributes');
    attributes[attributes.length - 1][1] = parseEntities(
      this.sliceSerialize(token),
    );
  }

  /** @type {_Handle} */
  function exitAttributes() {
    /** @type {Directive[]} */
    const stack = this.getData('directiveStack');
    /** @type {Attribute[]} */
    const attributes = this.getData('directiveAttributes');
    /** @type {Directive['attributes']} */
    const cleaned = {};
    /** @type {Attribute} */
    let attribute;
    let index = -1;

    while (++index < attributes.length) {
      attribute = attributes[index];

      cleaned[attribute[0]] = attribute[1];
    }

    this.resume();
    this.setData('directiveAttributes');
    stack[stack.length - 1].attributes = cleaned;
  }

  /** @type {_Handle} */
  function exit() {
    /** @type {Directive} */
    const directive = this.getData('directiveStack').pop();
    /** @type {boolean|undefined} */
    let found;
    /** @type {boolean|void} */
    let result;

    assert(directive.name, 'expected `name`');

    if (own.call(options, directive.name)) {
      result = options[directive.name].call(this, directive);
      found = result !== false;
    }

    if (!found && own.call(options, '*')) {
      result = options['*'].call(this, directive);
      found = result !== false;
    }

    if (!found && directive.type !== DirectiveType.Text) {
      this.setData('slurpOneLineEnding', true);
    }
  }
}
