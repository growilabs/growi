import { Lato } from 'next/font/google';

import type { DefineStyle } from './types';

const lato = Lato({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
});

export const useLatoFontFamily: DefineStyle = () => (
  <style jsx global>
    {`
      :root {
        --grw-font-family-lato: ${lato.style.fontFamily};
      }
    `}
  </style>
);
