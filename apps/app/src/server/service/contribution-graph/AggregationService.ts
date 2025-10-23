// needs

// date utilities
// user id?
// pagination


// returns

//
// pipeline input
//
// stages

// returns
// activity data for a specific period
// activities from lastUpdated until now
// in minified JSON format, {"d":"", "c": "X"}

// IDEA
// another cheaper pipeline for getting current week data?

import type { PipelineStage } from 'mongoose';

import { ActivityLogActions } from '~/interfaces/activity';
import Activity from '~/server/models/activity';


class ContributionAggregationService {


  public runAggregationPipeline(params) {

    const pipeline = this.buildPipeline(params);

    const [activityResults] = Activity.aggregate(pipeline);
  }


  private buildPipeline(params) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          action: 'relevant action group',
          lastUpdated: 'date logic',
          timestamp: {
            $gte: lastUpdated,
            $lt: currentDate,
          },
        },


      },
    ];
  }

}
