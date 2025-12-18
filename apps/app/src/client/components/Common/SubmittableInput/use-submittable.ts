import type {
  CompositionEvent,
  KeyboardEvent,
} from 'react';
import type React from 'react';
import {
  useCallback, useState,
} from 'react';

import type { KeyboardOnlySubmittableInputProps, KeyboardOnlySubmittableResult, SubmittableInputProps } from './types';


/**
 * Internal hook for composition-aware keyboard handling
 * Shared by both useSubmittable and useKeyboardSubmittable
 */
const useCompositionState = (props: {
  onCompositionStart?: React.CompositionEventHandler<HTMLInputElement>,
  onCompositionEnd?: React.CompositionEventHandler<HTMLInputElement>,
}) => {
  const { onCompositionStart, onCompositionEnd } = props;
  const [isComposing, setComposing] = useState(false);

  const compositionStartHandler = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    setComposing(true);
    onCompositionStart?.(e);
  }, [onCompositionStart]);

  const compositionEndHandler = useCallback((e: CompositionEvent<HTMLInputElement>) => {
    setComposing(false);
    onCompositionEnd?.(e);
  }, [onCompositionEnd]);

  return {
    isComposing,
    compositionStartHandler,
    compositionEndHandler,
  };
};


/**
 * Lightweight hook for keyboard-only submission handling
 * Only handles Enter/Escape keys with IME composition awareness
 * Does not manage value state or blur behavior
 * Useful when integrating with external state management (e.g., headless-tree)
 */
export const useKeyboardSubmittable = (props: KeyboardOnlySubmittableInputProps): KeyboardOnlySubmittableResult => {
  const {
    onSubmit, onCancel, onCompositionStart, onCompositionEnd,
  } = props;

  const {
    isComposing,
    compositionStartHandler,
    compositionEndHandler,
  } = useCompositionState({ onCompositionStart, onCompositionEnd });

  const keyDownHandler = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        if (isComposing) return;
        e.preventDefault();
        onSubmit?.();
        break;
      case 'Escape':
        if (isComposing) return;
        onCancel?.();
        break;
    }
  }, [isComposing, onCancel, onSubmit]);

  return {
    onKeyDown: keyDownHandler,
    onCompositionStart: compositionStartHandler,
    onCompositionEnd: compositionEndHandler,
  };
};


/**
 * Full-featured hook for submittable input with value management
 * Handles value state, blur submission, and keyboard events
 */
export const useSubmittable = (props: SubmittableInputProps): Partial<React.InputHTMLAttributes<HTMLInputElement>> => {

  const {
    value,
    onChange, onBlur,
    onCompositionStart, onCompositionEnd,
    onSubmit, onCancel,
  } = props;

  const [inputText, setInputText] = useState(value ?? '');
  const [lastSubmittedInputText, setLastSubmittedInputText] = useState<string|undefined>(value ?? '');

  const {
    isComposing,
    compositionStartHandler,
    compositionEndHandler,
  } = useCompositionState({ onCompositionStart, onCompositionEnd });

  const changeHandler = useCallback(async(e: React.ChangeEvent<HTMLInputElement>) => {
    const inputText = e.target.value;
    setInputText(inputText);

    onChange?.(e);
  }, [onChange]);

  const keyDownHandler = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
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
  }, [inputText, isComposing, onCancel, onSubmit]);

  const blurHandler = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    // suppress continuous calls to submit by blur event
    if (lastSubmittedInputText === inputText) {
      return;
    }

    // submit on blur
    setLastSubmittedInputText(inputText);
    onSubmit?.(inputText.trim());
    onBlur?.(e);
  }, [inputText, lastSubmittedInputText, onSubmit, onBlur]);

  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    value: _value, onSubmit: _onSubmit, onCancel: _onCancel,
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
