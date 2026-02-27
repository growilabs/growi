import type { ReactElement } from 'react';

import type { SubmittableInputProps } from './types';
import { useSubmittable } from './use-submittable';

export const SubmittableInput = (
  props: SubmittableInputProps,
): ReactElement<HTMLInputElement> => {
  // // autoFocus
  // useEffect(() => {
  //   if (inputRef?.current == null) {
  //     return;
  //   }
  //   inputRef.current.focus();
  // });

  const submittableProps = useSubmittable(props);

  return <input {...submittableProps} />;
};
