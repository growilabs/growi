import type { UseFormRegisterReturn } from 'react-hook-form';

// reactstrap's Input takes the DOM ref as `innerRef` and ignores `ref`.
export const registerToInputProps = (
  registration: UseFormRegisterReturn,
): Omit<UseFormRegisterReturn, 'ref'> & {
  innerRef: UseFormRegisterReturn['ref'];
} => {
  const { ref, ...rest } = registration;
  return { ...rest, innerRef: ref };
};
