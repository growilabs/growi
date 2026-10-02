import localFont from 'next/font/local';

import type { DefineStyle } from './types';

const materialSymbolsOutlined = localFont({
  src: '../../../resource/fonts/MaterialSymbolsOutlined-opsz,wght,FILL@20..48,300,0..1.woff2',
  adjustFontFallback: false,
  display: 'block',
  preload: false,
});

export const useMaterialSymbolsOutlined: DefineStyle = () => (
  <style jsx global>
    {`
      :root {
        --grw-font-family-material-symbols-outlined: ${materialSymbolsOutlined.style.fontFamily};
      }
    `}
  </style>
);
