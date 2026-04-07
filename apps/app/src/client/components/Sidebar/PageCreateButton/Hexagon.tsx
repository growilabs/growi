import React, { type JSX } from 'react';

type Props = {
  className?: string;
};

export const Hexagon = React.memo(
  (props: Props): JSX.Element => (
    <svg
      width="41"
      height="36"
      viewBox="0 0 41 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
    >
      <title>Create</title>
      <g className="background" transform="translate(0 0)">
        <path d="M28.5717 0C29.9943 0 31.3099 0.755645 32.0268 1.98452L40.1934 15.9845C40.92 17.23 40.92 18.77 40.1934 20.0155L32.0268 34.0155C31.3099 35.2444 29.9943 36 28.5717 36H12.1666C10.744 36 9.42835 35.2444 8.71151 34.0155L0.544839 20.0155C-0.181674 18.77 -0.181673 17.23 0.54484 15.9845L8.71151 1.98451C9.42835 0.755643 10.744 0 12.1666 0H28.5717Z" />
      </g>
    </svg>
  ),
);
