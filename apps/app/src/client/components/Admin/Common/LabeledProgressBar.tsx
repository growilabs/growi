import React, { type JSX } from 'react';
import { Progress } from 'reactstrap';

type Props = {
  header: string;
  currentCount: number;
  totalCount: number;
  isInProgress?: boolean;
};

const LabeledProgressBar = (props: Props): JSX.Element => {
  const { header, currentCount, totalCount, isInProgress } = props;

  const clampedCount = Math.min(currentCount, totalCount);
  const progressingColor = isInProgress ? 'info' : 'success';

  return (
    <>
      <h6 className="my-1">
        {header}
        <div className="float-end">
          {clampedCount} / {totalCount}
        </div>
      </h6>
      <Progress multi>
        <Progress
          bar
          max={totalCount}
          color={progressingColor}
          striped={isInProgress}
          animated={isInProgress}
          value={clampedCount}
        />
      </Progress>
    </>
  );
};

export default LabeledProgressBar;
