import React, { type JSX } from 'react';

type Props = {
  className?: string;
};

export const Hexagon = React.memo(
  (props: Props): JSX.Element => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 27.691 23.999"
      height="36px"
      className={props.className}
    >
      <title>Create</title>
      <g className="background" transform="translate(0 0)">
        <path
          d="M19.768,0.5 L25.691,10.5 A3,3 0 0,1 25.691,13.5 L19.768,23.5 A2,2 0 0,1 17.768,24 L7.923,24 A2,2 0 0,1 5.923,23.5 L0,13.5 A3,3 0 0,1 0,10.5 L5.923,0.5 A2,2 0 0,1 7.923,0 L17.768,0 A2,2 0 0,1 19.768,0.5 Z"
          transform="translate(0)"
        ></path>
      </g>
    </svg>
  ),
);
