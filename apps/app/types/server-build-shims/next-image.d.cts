// next/image runtime self-patches `module.exports` to the Image component.
import OrigImage from 'next/dist/shared/lib/image-external.js';
declare const Image: typeof OrigImage;
export = Image;
