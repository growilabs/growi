import { memo, type JSX } from 'react';


type Props = {
  className?: string,
  width?: number,
  children?: React.ReactNode,
}

export const ResizableAreaFallback = memo((props: Props): JSX.Element => {
  const {
    className = '',
    width,
    children,
  } = props;

  return (
    <div
      className={className}
      style={{ width }}
    >
      {children}
    </div>
  );
});
