// next/font/local resolves to the compiled localFont() factory.
import OrigLocalFont from 'next/dist/compiled/@next/font/dist/local/index.js';
declare const localFont: typeof OrigLocalFont;
export = localFont;
