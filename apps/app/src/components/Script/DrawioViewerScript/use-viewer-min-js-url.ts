import urljoin from 'url-join';

export const useViewerMinJsUrl = (drawioUri: string): string => {
  // extract search from URL
  const url = new URL(drawioUri);
  const pathname = urljoin(url.pathname, '/js/viewer-static.min.js');

  return `${url.origin}${pathname}${url.search}`;
};
