import { StreamErrorCode } from '../../interfaces/message-error';

const OpenaiStreamErrorMessageRegExp = {
  BUDGET_EXCEEDED: /exceeded your current quota/i, // stream-error-message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors."
} as const;

export const getStreamErrorCode = (
  errorMessage: string,
): StreamErrorCode | undefined => {
  for (const [code, regExp] of Object.entries(OpenaiStreamErrorMessageRegExp)) {
    if (regExp.test(errorMessage)) {
      return StreamErrorCode[code];
    }
  }
};
