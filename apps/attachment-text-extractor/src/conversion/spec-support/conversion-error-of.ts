import { ConversionError } from '../conversion-error';

/** The ConversionError a call throws or rejects with; anything else fails the test. */
export const conversionErrorOf = async (
  run: () => unknown,
): Promise<ConversionError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConversionError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ConversionError, but the call succeeded');
};
