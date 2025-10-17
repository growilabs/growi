import type { MarpOptions } from '@marp-team/marp-core';
import { Marp } from '@marp-team/marp-core';
import { Element } from '@marp-team/marpit';

export const MARP_CONTAINER_CLASS_NAME = 'marpit';

// Add data-line to Marp slide.
// https://github.com/marp-team/marp-vscode/blob/d9af184ed12b65bb28c0f328e250955d548ac1d1/src/plugins/line-number.ts
const sourceMapIgnoredTypesForElements = ['inline', 'marpit_slide_open'];
const lineNumber = (md) => {
  const { marpit_slide_containers_open: marpitSlideContainersOpen } =
    md.renderer.rules;

  // Enable line sync by per slides
  md.renderer.rules.marpit_slide_containers_open = (tks, i, opts, env, slf) => {
    const slide = tks.slice(i + 1).find((t) => t.type === 'marpit_slide_open');

    if (slide?.map?.length) {
      tks[i].attrJoin('class', 'has-data-line');
      tks[i].attrSet('data-line', slide.map[0]);
    }

    const renderer = marpitSlideContainersOpen || slf.renderToken;
    return renderer.call(slf, tks, i, opts, env, slf);
  };
  // Enables line sync per elements
  md.core.ruler.push('marp_growi_source_map_attr', (state) => {
    for (const token of state.tokens) {
      if (
        token.map?.length &&
        !sourceMapIgnoredTypesForElements.includes(token.type)
      ) {
        token.attrJoin('class', 'has-data-line');
        token.attrSet('data-line', token.map[0]);
      }
    }
  });
};

const marpitOption: MarpOptions = {
  container: [
    new Element('div', { class: `slides ${MARP_CONTAINER_CLASS_NAME}` }),
  ],
  inlineSVG: true,
  emoji: undefined,
  html: false,
  math: false,
};

const slideMarpitOption = marpitOption;
slideMarpitOption.slideContainer = [
  new Element('section', { class: 'shadow rounded m-2' }),
];

export const slideMarpit = new Marp(slideMarpitOption).use(lineNumber);

const presentationMarpitOption = marpitOption;
presentationMarpitOption.slideContainer = [
  new Element('section', { class: 'm-2' }),
];

export const presentationMarpit = new Marp(presentationMarpitOption);
