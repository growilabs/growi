import type { DrawioConfig } from './DrawioCommunicationHelper';

const headerColor = '#334455';
// draw.io v26 removed styles/atlas.css, the only stylesheet that gave the menubar light
// text, so repainting the menubar background without also setting the foreground leaves
// the entries at draw.io's dark default and unreadable.
// refs: https://github.com/growilabs/growi/issues/10478
const headerTextColor = '#ffffff';
const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', Meiryo, sans-serif";

export const drawioConfig: DrawioConfig = {
  css: `
  .geMenubarContainer { background-color: ${headerColor} !important; color: ${headerTextColor} !important; }
  .geMenubar { background-color: ${headerColor} !important; color: ${headerTextColor} !important; }
  .geMenubar .geItem { color: ${headerTextColor} !important; }
  .geEditor { font-family: ${fontFamily} !important; }
  html td.mxPopupMenuItem {
    font-family: ${fontFamily} !important;
    font-size: 8pt !important;
  }
  `,
  customFonts: ['Charter'],
  compressXml: true,
};
