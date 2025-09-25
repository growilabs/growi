import type { WebAPICallResult } from '@slack/web-api';

import { markdownSectionBlock } from './block-kit-builder';
import { respond } from './response-url';

export const respondRejectedErrors = async (
  rejectedResults: PromiseRejectedResult[],
  responseUrl: string,
): Promise<WebAPICallResult | undefined> => {
  if (rejectedResults.length > 0) {
    await respond(responseUrl, {
      text: 'Error occured.',
      blocks: [
        markdownSectionBlock('*Error occured:*'),
        ...rejectedResults.map((rejectedResult) => {
          const reason = rejectedResult.reason.toString();
          const resData = rejectedResult.reason.response?.data;
          const resDataMessage = resData?.message || resData?.toString();

          let errorMessage = reason;
          if (resDataMessage != null) {
            errorMessage += `\n  Cause: ${resDataMessage}`;
          }

          return markdownSectionBlock(errorMessage);
        }),
      ],
    });
  }

  return;
};
