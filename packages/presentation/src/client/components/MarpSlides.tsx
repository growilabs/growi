import type { JSX } from 'react';
import Head from 'next/head';

import { presentationMarpit, slideMarpit } from '../services/growi-marpit';

type Props = {
  children?: string;
  presentation?: boolean;
};

export const MarpSlides = (props: Props): JSX.Element => {
  const { children, presentation } = props;

  const marpit = presentation ? presentationMarpit : slideMarpit;
  const { html, css } = marpit.render(children ?? '');
  return (
    <>
      <Head>
        <style>{css}</style>
      </Head>
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
        dangerouslySetInnerHTML={{
          // DOMpurify.sanitize delete elements in <svg> so sanitize is not used here.
          __html: html,
        }}
      />
    </>
  );
};
