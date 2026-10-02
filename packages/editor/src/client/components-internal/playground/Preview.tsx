import type { JSX } from 'react';

type Props = {
  markdown?: string;
};

export const Preview = (props: Props): JSX.Element => {
  return (
    <div className="container">
      <h3>Preview</h3>
      <div className="card" style={{ minHeight: '200px' }}>
        {props.markdown ?? ''}
      </div>
    </div>
  );
};
