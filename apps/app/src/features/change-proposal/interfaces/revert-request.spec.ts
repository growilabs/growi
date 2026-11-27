import { body, validationResult } from 'express-validator';

import {
  countRevertRequestMessageLength,
  REVERT_REQUEST_MESSAGE_MAX_LENGTH,
} from './revert-request';

// The same rule the revert-request route applies to the message.
const isAcceptedByServerValidator = async (
  message: string,
): Promise<boolean> => {
  const req = { body: { message } };
  await body('message')
    .isLength({ max: REVERT_REQUEST_MESSAGE_MAX_LENGTH })
    .run(req);
  return validationResult(req).isEmpty();
};

const UNITS = [
  ['ASCII letter', 'a'],
  ['Japanese character', 'あ'],
  ['surrogate-pair emoji', '\u{1F600}'],
  ['emoji with a variation selector', '❤️'],
  ['text-style variation selector', '❤︎'],
  ['ZWJ emoji sequence', '\u{1F468}‍\u{1F469}‍\u{1F467}'],
] as const;

const BOUNDARY_CASES = UNITS.flatMap(([label, unit]) =>
  [
    REVERT_REQUEST_MESSAGE_MAX_LENGTH - 1,
    REVERT_REQUEST_MESSAGE_MAX_LENGTH,
    REVERT_REQUEST_MESSAGE_MAX_LENGTH + 1,
  ].map((repeat) => [label, repeat, unit] as const),
);

describe('countRevertRequestMessageLength', () => {
  it.each(
    BOUNDARY_CASES,
  )('agrees with the server validator for a %s repeated %i times', async (_label, repeat, unit) => {
    const message = unit.repeat(repeat);

    const acceptedByClient =
      countRevertRequestMessageLength(message) <=
      REVERT_REQUEST_MESSAGE_MAX_LENGTH;

    expect(acceptedByClient).toBe(await isAcceptedByServerValidator(message));
  });

  it('counts a surrogate-pair emoji and an emoji with a variation selector as one character each', () => {
    expect(countRevertRequestMessageLength('\u{1F600}')).toBe(1);
    expect(countRevertRequestMessageLength('❤️')).toBe(1);
    expect(countRevertRequestMessageLength('abc')).toBe(3);
  });
});
