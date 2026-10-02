import localFont from 'next/font/local';

import type { DefineStyle } from './types';

const growiCustomIconFont = localFont({
  src: '../../../../../packages/custom-icons/dist/growi-custom-icons.woff2',
  adjustFontFallback: false,
  display: 'block',
});

export const useGrowiCustomIcon: DefineStyle = () => (
  <style jsx global>
    {`
      :root {
        --grw-font-family-custom-icon: ${growiCustomIconFont.style.fontFamily};
      }
    `}
  </style>
);
