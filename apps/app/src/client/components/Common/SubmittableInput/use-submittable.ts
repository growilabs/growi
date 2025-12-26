import type React from 'react';
import type { CompositionEvent } from 'react';
import { useCallback, useState } from 'react';

import type { SubmittableInputProps } from './types';

export const useSubmittable = (
  props: SubmittableInputProps,
): Partial<React.InputHTMLAttributes<HTMLInputElement>> => {
  const {
    value,
    onChange,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
    onSubmit,
    onCancel,
  } = props;

  const [inputText, setInputText] = useState(value ?? '');
  const [lastSubmittedInputText, setLastSubmittedInputText] = useState<
    string | undefined
  >(value ?? '');
  const [isComposing, setComposing] = useState(false);

  const changeHandler = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputText = e.target.value;
      setInputText(inputText);

      onChange?.(e);
    },
    [onChange],
  );

  const keyDownHandler = useCallback(
    (e) => {
      switch (e.key) {
        case 'Enter':
          // Do nothing when composing
          if (isComposing) {
            return;
          }
          setLastSubmittedInputText(inputText);
          onSubmit?.(inputText.trim());
          break;
        case 'Escape':
          if (isComposing) {
            return;
          }
          onCancel?.();
          break;
      }
    },
    [inputText, isComposing, onCancel, onSubmit],
  );

  const blurHandler = useCallback(
    (e) => {
      // suppress continuous calls to submit by blur event
      if (lastSubmittedInputText === inputText) {
        return;
      }

      // submit on blur
      setLastSubmittedInputText(inputText);
      onSubmit?.(inputText.trim());
      onBlur?.(e);
    },
    [inputText, lastSubmittedInputText, onSubmit, onBlur],
  );

  const compositionStartHandler = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      setComposing(true);
      onCompositionStart?.(e);
    },
    [onCompositionStart],
  );

  const compositionEndHandler = useCallback(
    (e: CompositionEvent<HTMLInputElement>) => {
      setComposing(false);
      onCompositionEnd?.(e);
    },
    [onCompositionEnd],
  );

  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    value: _value,
    onSubmit: _onSubmit,
    onCancel: _onCancel,
    ...cleanedProps
  } = props;

  return {
    ...cleanedProps,
    value: inputText,
    onChange: changeHandler,
    onKeyDown: keyDownHandler,
    onBlur: blurHandler,
    onCompositionStart: compositionStartHandler,
    onCompositionEnd: compositionEndHandler,
  };
};
