import localFont from 'next/font/local';

import type { DefineStyle } from './types';

const sourceHanCodeJPSubsetMain = localFont({
  src: '../../../resource/fonts/SourceHanCodeJP-Regular-subset-main.woff2',
  display: 'swap',
  preload: false,
});
const sourceHanCodeJPSubsetJis2 = localFont({
  src: '../../../resource/fonts/SourceHanCodeJP-Regular-subset-jis2.woff2',
  display: 'swap',
  preload: false,
});

export const useSourceHanCodeJP: DefineStyle = () => (
  <style jsx global>
    {`
      :root {
        --grw-font-family-source-han-code-jp-subset-main: ${sourceHanCodeJPSubsetMain.style.fontFamily};
        --grw-font-family-source-han-code-jp-subset-jis2: ${sourceHanCodeJPSubsetJis2.style.fontFamily};
      }
    `}
  </style>
);
