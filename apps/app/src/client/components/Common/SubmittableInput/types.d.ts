/**
 * Props for full submittable input with value management
 */
export type SubmittableInputProps<T extends InputHTMLAttributes<HTMLInputElement> = InputHTMLAttributes<HTMLInputElement>> =
  Omit<InputHTMLAttributes<T>, 'value' | 'onKeyDown' | 'onSubmit'>
  & {
    value?: string,
    onSubmit?: (inputText: string) => void,
    onCancel?: () => void,
  }

/**
 * Props for keyboard-only mode (lightweight)
 * Only handles Enter/Escape keys with IME composition awareness
 * Does not manage value state or blur behavior
 * Useful when integrating with external state management (e.g., headless-tree)
 */
export type KeyboardOnlySubmittableInputProps = Partial<Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'onCompositionStart' | 'onCompositionEnd'
>> & {
  onSubmit?: () => void,
  onCancel?: () => void,
}

/**
 * Return type for keyboard-only mode
 */
export type KeyboardOnlySubmittableResult = Required<Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'onKeyDown' | 'onCompositionStart' | 'onCompositionEnd'
>>
