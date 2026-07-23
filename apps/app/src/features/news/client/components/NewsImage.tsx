import type { FC } from 'react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';

import { isSafeHttpUrl } from '../utils/is-safe-http-url';
import { resolveLocaleText } from '../utils/resolve-locale-text';

const MAX_IMAGE_HEIGHT_PX = 400;

type Props = {
  /** Absolute URL resolved + containment-validated at ingest time */
  url: string;
  /** Locale-keyed alt text, resolved with the same fallback chain as title/body */
  alt?: Record<string, string>;
};

/**
 * Image slot for a news item on /_news.
 *
 * Fallback contract: a load failure hides only this image (news text stays
 * readable, e.g. in client-egress-restricted networks). The error state is
 * component-local, so the CALLER MUST render this with `key={url}` — that
 * remounts the component when the URL changes and prevents a stale error
 * state from hiding a different, valid image after page navigation.
 */
export const NewsImage: FC<Props> = ({ url, alt }) => {
  const { i18n } = useTranslation();
  const [hasError, setHasError] = useState(false);

  if (hasError || !isSafeHttpUrl(url)) {
    return null;
  }

  const altText = alt != null ? resolveLocaleText(alt, i18n.language) : '';

  return (
    // biome-ignore lint/performance/noImgElement: next/image would route the vendor image through this GROWI server (optimizer proxy + remotePatterns config), defeating the hotlink design where image traffic never touches the instance
    <img
      src={url}
      alt={altText}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="mw-100 rounded"
      style={{ maxHeight: `${MAX_IMAGE_HEIGHT_PX}px`, objectFit: 'contain' }}
      onError={() => setHasError(true)}
    />
  );
};
