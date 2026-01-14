import { type JSX, useEffect, useRef } from 'react';
import Reveal from 'reveal.js';

import type { PresentationOptions } from '../consts';
import { Slides } from './Slides';

import styles from './Presentation.module.scss';

const moduleClass = styles['grw-presentation'] ?? '';

const baseRevealOptions: Reveal.Options = {
  // adjust size to the marp preset size
  width: 1280,
  height: 720,
  maxScale: 1.2,
  slideNumber: 'c/t',
  display: '',
};

/**
 * Remove all [hidden] in order to activate transitions
 *   cz: All of .past and .future elements are hidden by `display: none !important`
 * @see https://getbootstrap.com/docs/4.6/content/reboot/#html5-hidden-attribute
 */
const removeAllHiddenElements = () => {
  const sections = document.querySelectorAll(`${moduleClass} section`);
  for (const section of sections) {
    section.removeAttribute('hidden');
  }
};

export type PresentationProps = {
  options: PresentationOptions;
  marp?: boolean;
  children?: string;
};

export const Presentation = (props: PresentationProps): JSX.Element => {
  const { options, marp, children } = props;
  const { revealOptions } = options;
  const deckRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (children == null || deckRef.current == null) {
      return;
    }
    const deck = new Reveal(deckRef.current, {
      ...baseRevealOptions,
      ...revealOptions,
    });
    deck.initialize().then(() => deck.slide(0)); // navigate to the first slide

    deck.on('ready', removeAllHiddenElements);
    deck.on('slidechanged', removeAllHiddenElements);

    return function cleanup() {
      deck.off('ready', removeAllHiddenElements);
      deck.off('slidechanged', removeAllHiddenElements);
    };
  }, [children, revealOptions]);

  return (
    <div ref={deckRef} className={`${moduleClass} reveal`}>
      <Slides options={options} hasMarpFlag={marp} presentation>
        {children}
      </Slides>
    </div>
  );
};
