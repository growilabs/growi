export type SubmittableInputProps<
  T extends
    InputHTMLAttributes<HTMLInputElement> = InputHTMLAttributes<HTMLInputElement>,
> = Omit<InputHTMLAttributes<T>, 'value' | 'onKeyDown' | 'onSubmit'> & {
  value?: string;
  onSubmit?: (inputText: string) => void;
  onCancel?: () => void;
};
