import React, { useEffect, useState, type JSX } from 'react';

type Props = {
  shouldRender: boolean | (() => boolean),
  children: JSX.Element,
}

export const LazyRenderer = (props: Props): JSX.Element => {
  const { shouldRender: _shouldRender, children } = props;

  const [isActivated, setActivated] = useState(false);

  const shouldRender = typeof _shouldRender === 'function'
    ? _shouldRender()
    : _shouldRender;

  useEffect(() => {
    if (isActivated) {
      return;
    }
    setActivated(shouldRender);
  }, [isActivated, shouldRender]);

  if (!isActivated) {
    return <></>;
  }

  const child = React.Children.only(children);

  return React.cloneElement(child, { visibility: shouldRender });

};
