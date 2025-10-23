// needs
//
// date utilities
// user id?
// pagination

// count? in pipeline?

// returns

//
// pipeline
//
// match
//   for a certain user
//   within a specified period (since lastUpdate)
//   with certain action groups
//
// returns
// Activiy
//   user.id
//   createdAt
//   action
//
//
// activities from lastUpdated until now
// in minified JSON format, {"d":"", "c": "X"}


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
