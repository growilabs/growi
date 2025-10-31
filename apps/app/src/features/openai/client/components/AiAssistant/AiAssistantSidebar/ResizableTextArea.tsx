import type {
  ChangeEventHandler,
  DetailedHTMLProps,
  JSX,
  TextareaHTMLAttributes,
} from 'react';
import { useCallback } from 'react';

type Props = DetailedHTMLProps<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  HTMLTextAreaElement
>;

export const ResizableTextarea = (props: Props): JSX.Element => {
  const { onChange: _onChange, ...rest } = props;

  const onChange: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      _onChange?.(e);

      // auto resize
      // refs: https://zenn.dev/soma3134/articles/1e2fb0eab75b2d
      e.target.style.height = 'auto';
      e.target.style.height = `${e.target.scrollHeight + 4}px`;
    },
    [_onChange],
  );

  return <textarea onChange={onChange} {...rest} />;
};
