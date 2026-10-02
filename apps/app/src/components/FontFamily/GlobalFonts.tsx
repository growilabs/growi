import { type JSX, memo } from 'react';

import { useGrowiCustomIcon } from './use-growi-custom-icons';
import { useLatoFontFamily } from './use-lato';
import { useMaterialSymbolsOutlined } from './use-material-symbols-outlined';
import { useSourceHanCodeJP } from './use-source-han-code-jp';

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
