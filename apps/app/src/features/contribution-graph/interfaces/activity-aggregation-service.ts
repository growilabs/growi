import type { Aggregate } from 'mongoose';

import type { PipelineParams } from '../server/services/activity-aggregation-service';
import type { IContributionDay } from './contribution-graph';

export interface IActivityAggregationService {
  runAggregationPipeline(params: PipelineParams): Aggregate<IContributionDay[]>;
}
