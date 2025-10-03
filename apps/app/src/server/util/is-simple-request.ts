import type { Request } from 'express';

import type { AccessTokenParserReq } from '~/server/middlewares/access-token-parser/interfaces';

const allowedMethods = ['GET', 'HEAD', 'POST'] as const;
type AllowedMethod = typeof allowedMethods[number];
function isAllowedMethod(method: string): method is AllowedMethod {
  return allowedMethods.includes(method as AllowedMethod);
}

const safeRequestHeaders = [
  'accept',
  'accept-language',
  'content-language',
  'content-type',
  'range',
  'referer',
  'dpr',
  'downlink',
  'save-data',
  'viewport-width',
  'width',
] as const;
type SafeRequestHeader = typeof safeRequestHeaders[number];

function isSafeRequestHeader(header: string): header is SafeRequestHeader {
  return safeRequestHeaders.includes(header.toLowerCase() as SafeRequestHeader);
}

const allowedContentTypes = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
] as const;
type AllowedContentType = typeof allowedContentTypes[number];

function isAllowedContentType(contentType: string): contentType is AllowedContentType {
  return allowedContentTypes.some(allowed => contentType.toLowerCase().startsWith(allowed));
}

const isSimpleRequest = (req: Request | AccessTokenParserReq): boolean => {
  // 1. Check if the request method is allowed
  if (!isAllowedMethod(req.method)) {
    return false;
  }

  // 2. Check if the request headers are safe
  const nonSafeHeaders = Object.keys(req.headers).filter((header) => {
    return !isSafeRequestHeader(header);
  });
  if (nonSafeHeaders.length > 0) {
    return false;
  }

  // 3. Content-Type is
  const contentType = req.headers['content-type'];
  if (contentType != null && !isAllowedContentType(contentType)) {
    return false;
  }

  // Return true if all conditions are met
  return true;
};

export default isSimpleRequest;
