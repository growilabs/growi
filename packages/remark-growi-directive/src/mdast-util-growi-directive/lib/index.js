/**
 * @typedef {import('mdast').Node} Node
 * @typedef {import('mdast').Paragraph} Paragraph
 *
 * @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
 * @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
 * @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
 * @typedef {import('mdast-util-from-markdown').Token} Token
 *
 * @typedef {import('mdast-util-to-markdown').ConstructName} ConstructName
 * @typedef {import('mdast-util-to-markdown').Handle} ToMarkdownHandle
 * @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
 * @typedef {import('mdast-util-to-markdown').State} State
 *
 * @typedef {import('../types/index.js').LeafGrowiPluginDirective} LeafGrowiPluginDirective
 * @typedef {import('../types/index.js').TextGrowiPluginDirective} TextGrowiPluginDirective
 * @typedef {import('../types/index.js').Directives} Directives
 */

import { parseEntities } from 'parse-entities';
import { stringifyEntitiesLight } from 'stringify-entities';

const own = {}.hasOwnProperty;

export const DirectiveType = Object.freeze({
  Text: 'textGrowiPluginDirective',
  Leaf: 'leafGrowiPluginDirective',
});

handleDirective.peek = peekDirective;

/** @type {FromMarkdownExtension} */
export function directiveFromMarkdown() {
  return {
    canContainEols: [DirectiveType.Text],
    enter: {
      directiveGrowiLeaf: enterLeaf,
      directiveGrowiLeafAttributes: enterAttributes,

      directiveGrowiText: enterText,
      directiveGrowiTextAttributes: enterAttributes,
    },
    exit: {
      directiveGrowiLeaf: exit,
      directiveGrowiLeafAttributeName: exitAttributeName,
      directiveGrowiLeafAttributeValue: exitAttributeValue,
      directiveGrowiLeafAttributes: exitAttributes,
      directiveGrowiLeafName: exitName,

      directiveGrowiText: exit,
      directiveGrowiTextAttributeName: exitAttributeName,
      directiveGrowiTextAttributeValue: exitAttributeValue,
      directiveGrowiTextAttributes: exitAttributes,
      directiveGrowiTextName: exitName,
    },
  };
}

/** @type {ToMarkdownExtension} */
export function directiveToMarkdown() {
  return {
    unsafe: [
      {
        character: '\r',
        inConstruct: [DirectiveType.Leaf],
      },
      {
        character: '\n',
        inConstruct: [DirectiveType.Leaf],
      },
      {
        before: '[^$]',
        character: '$',
        after: '[A-Za-z]',
        inConstruct: ['phrasing'],
      },
      { atBreak: true, character: '$', after: '$' },
    ],
    handlers: {
      [DirectiveType.Leaf]: handleDirective,
      [DirectiveType.Text]: handleDirective,
    },
  };
}

/** @type {FromMarkdownHandle} */
function enterLeaf(token) {
  enter.call(this, DirectiveType.Leaf, token);
}

/** @type {FromMarkdownHandle} */
function enterText(token) {
  enter.call(this, DirectiveType.Text, token);
}

/**
 * @this {CompileContext}
 * @param {Directive['type']} type
 * @param {Token} token
 */
function enter(type, token) {
  this.enter(
    {
      type,
      name: '',
      attributes: {},
      children: [],
    },
    token,
  );
}

/**
 * @this {CompileContext}
 * @param {Token} token
 */
function exitName(token) {
  const node = /** @type {Directive} */ (this.stack[this.stack.length - 1]);
  node.name = this.sliceSerialize(token);
}

/** @type {FromMarkdownHandle} */
function enterAttributes() {
  this.data.directiveAttributes = [];
  this.buffer(); // Capture EOLs
}

/** @type {FromMarkdownHandle} */
function exitAttributeValue(token) {
  const list = /** @type {Array.<[string, string]>} */ (
    this.data.directiveAttributes
  );
  list[list.length - 1][1] = parseEntities(this.sliceSerialize(token));
}

/** @type {FromMarkdownHandle} */
function exitAttributeName(token) {
  const list = /** @type {Array.<[string, string]>} */ (
    this.data.directiveAttributes
  );

  // Attribute names in CommonMark are significantly limited, so character
  // references can’t exist.
  list.push([this.sliceSerialize(token), '']);
}

/** @type {FromMarkdownHandle} */
function exitAttributes() {
  const list = /** @type {Array.<[string, string]>} */ (
    this.data.directiveAttributes
  );
  /** @type {Record.<string, string>} */
  const cleaned = {};
  let index = -1;

  while (++index < list.length) {
    const attribute = list[index];

    cleaned[attribute[0]] = attribute[1];
  }

  this.data.directiveAttributes = [];
  this.resume(); // Drop EOLs
  const node = /** @type {Directive} */ (this.stack[this.stack.length - 1]);
  node.attributes = cleaned;
}

/** @type {FromMarkdownHandle} */
function exit(token) {
  this.exit(token);
}

/**
 * @type {ToMarkdownHandle}
 * @param {Directive} node
 */
function handleDirective(node, _, context, safeOptions) {
  const tracker = context.createTracker(safeOptions);
  const sequence = fence(node);
  const exit = context.enter(node.type);
  let value = tracker.move(sequence + (node.name || ''));
  /** @type {Directive|Paragraph|undefined} */
  const label = node;

  if (label?.children && label.children.length > 0) {
    const exit = context.enter('label');
    const subexit = context.enter(`${node.type}Label`);
    value += tracker.move('[');
    value += tracker.move(
      context.containerPhrasing(label, {
        ...tracker.current(),
        before: value,
        after: ']',
      }),
    );
    value += tracker.move(']');
    subexit();
    exit();
  }

  value += tracker.move(attributes(node, context));

  exit();
  return value;
}

/** @type {ToMarkdownHandle} */
function peekDirective() {
  return '$';
}

/**
 * @param {Directive} node
 * @param {State} state
 * @returns {string}
 */
function attributes(node, state) {
  const quote = state.options.quote || '"';
  const subset =
    node.type === DirectiveType.Text ? [quote] : [quote, '\n', '\r'];
  const attrs = node.attributes || {};
  /** @type {Array.<string>} */
  const values = [];
  /** @type {string} */
  let key;

  // eslint-disable-next-line no-restricted-syntax
  for (key in attrs) {
    if (
      own.call(attrs, key) &&
      attrs[key] !== undefined &&
      attrs[key] !== null
    ) {
      const value = String(attrs[key]);

      values.push(quoted(key, value));
    }
  }

  return values.length > 0 ? `(${values.join(' ')})` : '';

  /**
   * @param {string} key
   * @param {string} value
   * @returns {string}
   */
  function quoted(key, value) {
    return (
      key +
      (value
        ? `=${quote}${stringifyEntitiesLight(value, { subset })}${quote}`
        : '')
    );
  }
}

/**
 * @param {Directive} node
 * @returns {string}
 */
function fence(node) {
  let size = 0;

  if (node.type === DirectiveType.Leaf) {
    size = 1;
  } else {
    size = 1;
  }

  return '$'.repeat(size);
}
