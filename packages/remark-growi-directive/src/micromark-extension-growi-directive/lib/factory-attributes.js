/**
 * @typedef {import('micromark-util-types').Effects} Effects
 * @typedef {import('micromark-util-types').State} State
 * @typedef {import('micromark-util-types').Code} Code
 */

import { factorySpace } from 'micromark-factory-space';
import { factoryWhitespace } from 'micromark-factory-whitespace';
import {
  markdownLineEnding,
  markdownLineEndingOrSpace,
  markdownSpace,
} from 'micromark-util-character';
import { codes, types } from 'micromark-util-symbol';
import { ok as assert } from 'uvu/assert';

import {
  factoryAttributesDevider,
  markdownLineEndingOrSpaceOrComma,
} from '../../micromark-factory-attributes-devider/index.js';

/**
 * @param {Effects} effects
 * @param {State} ok
 * @param {State} nok
 * @param {string} attributesType
 * @param {string} attributesMarkerType
 * @param {string} attributeType
 * @param {string} attributeNameType
 * @param {string} attributeInitializerType
 * @param {string} attributeValueLiteralType
 * @param {string} attributeValueType
 * @param {string} attributeValueMarker
 * @param {string} attributeValueData
 * @param {boolean} [disallowEol=false]
 */
/* eslint-disable-next-line max-params */
export function factoryAttributes(
  effects,
  ok,
  nok,
  attributesType,
  attributesMarkerType,
  attributeType,
  attributeNameType,
  attributeInitializerType,
  attributeValueLiteralType,
  attributeValueType,
  attributeValueMarker,
  attributeValueData,
  disallowEol,
) {
  /** @type {Code|undefined} */
  let marker;

  return start;

  /** @type {State} */
  function start(code) {
    assert(code === codes.leftParenthesis, 'expected `(`');
    effects.enter(attributesType);
    effects.enter(attributesMarkerType);
    effects.consume(code);
    effects.exit(attributesMarkerType);
    return between;
  }

  /** @type {State} */
  function between(code) {
    if (disallowEol) {
      if (markdownSpace(code)) {
        return factorySpace(effects, between, types.whitespace)(code);
      }
      if (code === codes.comma) {
        return factoryAttributesDevider(effects, between)(code);
      }
    }

    if (!disallowEol && markdownLineEndingOrSpaceOrComma(code)) {
      return factoryAttributesDevider(effects, between)(code);
    }

    if (
      code !== codes.rightParenthesis &&
      code !== codes.eof &&
      code !== codes.carriageReturn &&
      code !== codes.lineFeed &&
      code !== codes.carriageReturnLineFeed &&
      code !== codes.ampersand
    ) {
      effects.enter(attributeType);
      effects.enter(attributeNameType);
      effects.consume(code);
      return name;
    }

    return end(code);
  }

  /** @type {State} */
  function name(code) {
    if (
      code !== codes.eof &&
      code !== codes.carriageReturn &&
      code !== codes.lineFeed &&
      code !== codes.carriageReturnLineFeed &&
      code !== codes.quotationMark &&
      code !== codes.apostrophe &&
      code !== codes.lessThan &&
      code !== codes.equalsTo &&
      code !== codes.greaterThan &&
      code !== codes.graveAccent &&
      code !== codes.rightParenthesis &&
      code !== codes.space &&
      code !== codes.comma
    ) {
      effects.consume(code);
      return name;
    }

    effects.exit(attributeNameType);

    if (disallowEol && markdownSpace(code)) {
      return factorySpace(effects, nameAfter, types.whitespace)(code);
    }

    if (!disallowEol && markdownLineEndingOrSpace(code)) {
      return factoryAttributesDevider(effects, nameAfter)(code);
    }

    return nameAfter(code);
  }

  /** @type {State} */
  function nameAfter(code) {
    if (code === codes.equalsTo) {
      effects.enter(attributeInitializerType);
      effects.consume(code);
      effects.exit(attributeInitializerType);
      return valueBefore;
    }

    // Attribute w/o value.
    effects.exit(attributeType);
    return between(code);
  }

  /** @type {State} */
  function valueBefore(code) {
    if (
      code === codes.eof ||
      code === codes.lessThan ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.graveAccent ||
      code === codes.rightParenthesis ||
      (disallowEol && markdownLineEnding(code))
    ) {
      return nok(code);
    }

    if (code === codes.quotationMark || code === codes.apostrophe) {
      effects.enter(attributeValueLiteralType);
      effects.enter(attributeValueMarker);
      effects.consume(code);
      effects.exit(attributeValueMarker);
      marker = code;
      return valueQuotedStart;
    }

    if (disallowEol && markdownSpace(code)) {
      return factorySpace(effects, valueBefore, types.whitespace)(code);
    }

    if (!disallowEol && markdownLineEndingOrSpace(code)) {
      return factoryAttributesDevider(effects, valueBefore)(code);
    }

    effects.enter(attributeValueType);
    effects.enter(attributeValueData);
    effects.consume(code);
    marker = undefined;
    return valueUnquoted;
  }

  /** @type {State} */
  function valueUnquoted(code) {
    if (
      code === codes.eof ||
      code === codes.quotationMark ||
      code === codes.apostrophe ||
      code === codes.lessThan ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.graveAccent
    ) {
      return nok(code);
    }

    if (
      code === codes.rightParenthesis ||
      markdownLineEndingOrSpaceOrComma(code)
    ) {
      effects.exit(attributeValueData);
      effects.exit(attributeValueType);
      effects.exit(attributeType);
      return between(code);
    }

    effects.consume(code);
    return valueUnquoted;
  }

  /** @type {State} */
  function valueQuotedStart(code) {
    if (code === marker) {
      effects.enter(attributeValueMarker);
      effects.consume(code);
      effects.exit(attributeValueMarker);
      effects.exit(attributeValueLiteralType);
      effects.exit(attributeType);
      return valueQuotedAfter;
    }

    effects.enter(attributeValueType);
    return valueQuotedBetween(code);
  }

  /** @type {State} */
  function valueQuotedBetween(code) {
    if (code === marker) {
      effects.exit(attributeValueType);
      return valueQuotedStart(code);
    }

    if (code === codes.eof) {
      return nok(code);
    }

    // Note: blank lines can’t exist in content.
    if (markdownLineEnding(code)) {
      return disallowEol
        ? nok(code)
        : factoryWhitespace(effects, valueQuotedBetween)(code);
    }

    effects.enter(attributeValueData);
    effects.consume(code);
    return valueQuoted;
  }

  /** @type {State} */
  function valueQuoted(code) {
    if (code === marker || code === codes.eof || markdownLineEnding(code)) {
      effects.exit(attributeValueData);
      return valueQuotedBetween(code);
    }

    effects.consume(code);
    return valueQuoted;
  }

  /** @type {State} */
  function valueQuotedAfter(code) {
    return code === codes.rightParenthesis ||
      markdownLineEndingOrSpaceOrComma(code)
      ? between(code)
      : end(code);
  }

  /** @type {State} */
  function end(code) {
    if (code === codes.rightParenthesis) {
      effects.enter(attributesMarkerType);
      effects.consume(code);
      effects.exit(attributesMarkerType);
      effects.exit(attributesType);
      return ok;
    }

    return nok(code);
  }
}
