import type { UseFormRegisterReturn } from 'react-hook-form';

/**
 * Adapt a react-hook-form `register()` result to reactstrap's `<Input>` props.
 *
 * reactstrap's `Input` (v9, a class component) wires the DOM node through its
 * own `innerRef` prop and ignores a plain `ref`. react-hook-form's `register`
 * returns the ref callback under the `ref` key, so spreading it directly would
 * silently drop the ref and leave RHF unable to read the field value on submit.
 * This remaps `ref` → `innerRef` while passing `name`/`onChange`/`onBlur`
 * through unchanged, so call sites can write
 * `<Input {...registerToInputProps(register('field'))} />`.
 */
export const registerToInputProps = (
  registration: UseFormRegisterReturn,
): Omit<UseFormRegisterReturn, 'ref'> & {
  innerRef: UseFormRegisterReturn['ref'];
} => {
  const { ref, ...rest } = registration;
  return { ...rest, innerRef: ref };
};
