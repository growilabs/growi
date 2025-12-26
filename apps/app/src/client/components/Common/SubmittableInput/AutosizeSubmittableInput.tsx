import type { ReactElement } from 'react';
import type { AutosizeInputProps } from 'react-input-autosize';
import AutosizeInput from 'react-input-autosize';

import type { SubmittableInputProps } from './types';
import { useSubmittable } from './use-submittable';

export const getAdjustedMaxWidthForAutosizeInput = (
  parentMaxWidth: number,
  size: 'sm' | 'md' | 'lg' = 'md',
  isValid?: boolean,
): number => {
  // eslint-disable-next-line no-nested-ternary
  const bsFormPaddingSize = size === 'sm' ? 8 : size === 'md' ? 12 : 16; // by bootstrap form
  // eslint-disable-next-line no-nested-ternary
  const bsValidationIconSize = size === 'sm' ? 25 : size === 'md' ? 24 : 26; // by bootstrap form validation

  return (
    parentMaxWidth -
    bsFormPaddingSize * 2 - // minus the padding (12px * 2) because AutosizeInput has "box-sizing: content-box;"
    (isValid === false ? bsValidationIconSize : 0)
  ); // minus the width for the exclamation icon
};

export const AutosizeSubmittableInput = (
  props: SubmittableInputProps<AutosizeInputProps>,
): ReactElement<AutosizeInput> => {
  const submittableProps = useSubmittable(props);

  return (
    <AutosizeInput
      {...submittableProps}
      type="text"
      data-testid="autosize-submittable-input"
    />
  );
};
