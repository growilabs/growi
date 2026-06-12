import { type JSX, memo } from 'react';

import { useGrowiCustomIcon } from './use-growi-custom-icons.js';
import { useLatoFontFamily } from './use-lato.js';
import { useMaterialSymbolsOutlined } from './use-material-symbols-outlined.js';
import { useSourceHanCodeJP } from './use-source-han-code-jp.js';

/**
 * Define prefixed by '--grw-font-family'
 */
export const GlobalFonts = memo((): JSX.Element => {
  const latoFontFamily = useLatoFontFamily();
  const sourceHanCodeJPFontFamily = useSourceHanCodeJP();
  const materialSymbolsOutlinedFontFamily = useMaterialSymbolsOutlined();
  const customSvgFontFamily = useGrowiCustomIcon();

  return (
    <>
      {latoFontFamily}
      {sourceHanCodeJPFontFamily}
      {materialSymbolsOutlinedFontFamily}
      {customSvgFontFamily}
    </>
  );
});
