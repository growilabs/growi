import {
  type GrowiEventProcessor,
  REQUEST_TIMEOUT_FOR_PTOG,
} from '@growi/slack';
import type { WebClient } from '@slack/web-api';
import { Inject, Service } from '@tsed/di';
import axios from 'axios';

// needed to import class (not type) for injection
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RelationRepository } from '~/repositories/relation';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('slackbot-proxy:services:LinkSharedService');

type LinkSharedEventLink = {
  url: string;
  domain: string;
};

// aliases
type GrowiOrigin = string;
type TokenPtoG = string;

export type LinkSharedRequestEvent = {
  channel: string;

  // eslint-disable-next-line camelcase
  message_ts: string;

  links: LinkSharedEventLink[];
};

type PrivateData = {
  isPublic: false;
  path: string;
};

type PublicData = {
  isPublic: true;
  path: string;
  pageBody: string;
  updatedAt: string;
  commentCount: number;
};

export type DataForLinkShared = PrivateData | PublicData;

@Service()
export class LinkSharedService
  implements GrowiEventProcessor<LinkSharedRequestEvent>
{
  @Inject()
  relationRepository: RelationRepository;

  shouldHandleEvent(eventType: string): boolean {
    return eventType === 'link_shared';
  }

  async processEvent(
    client: WebClient,
    event: LinkSharedRequestEvent,
  ): Promise<void> {
    const { links } = event;

    const origins: string[] = links.map(
      (link: LinkSharedEventLink) => new URL(link.url).origin,
    );
    const originToTokenPtoGMap: Map<GrowiOrigin, TokenPtoG> =
      await this.generateOriginToTokenPtoGMapFromOrigins(origins); // get tokenPtoG at once

    // forward to GROWI
    const result = await this.forwardToEachGrowiOrigin(
      origins,
      event,
      originToTokenPtoGMap,
    );

    // log error
    this.logErrorRejectedResults(result);
  }

  // generate Map<GrowiOrigin, TokenPtoG>
  async generateOriginToTokenPtoGMapFromOrigins(
    origins: GrowiOrigin[],
  ): Promise<Map<GrowiOrigin, TokenPtoG>> {
    const originToTokenPtoGMap: Map<GrowiOrigin, TokenPtoG> = new Map();

    // get relations using origins at once
    const relations = await this.relationRepository.findAllByGrowiUris(origins);

    // increment map using relation.growiUri & relation.tokenPtoG
    relations.forEach((relation) => {
      originToTokenPtoGMap.set(relation.growiUri, relation.tokenPtoG);
    });

    return originToTokenPtoGMap;
  }

  async forwardToEachGrowiOrigin(
    origins: string[],
    event: LinkSharedRequestEvent,
    originToTokenPtoGMap: Map<GrowiOrigin, TokenPtoG>,
  ): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(
      origins.map(async (origin) => {
        const requestBody = {
          growiBotEvent: {
            eventType: 'link_shared',
            event,
          },
          data: {
            origin,
          },
        };
        try {
          // ensure tokenPtoG exists
          const tokenPtoG = originToTokenPtoGMap.get(origin);
          if (tokenPtoG == null) throw new Error('tokenPtoG is null');

          const url = new URL(
            '/_api/v3/slack-integration/proxied/events',
            origin,
          );

          await axios.post(url.toString(), requestBody, {
            headers: {
              'x-growi-ptog-tokens': tokenPtoG,
            },
            timeout: REQUEST_TIMEOUT_FOR_PTOG,
          });
        } catch (err) {
          logger.error(
            `Error occurred while request to growi (origin=${origin}):`,
            err,
          );
          throw err;
        }
      }),
    );
  }

  // Promise util method to output rejected results
  private logErrorRejectedResults<T>(results: PromiseSettledResult<T>[]): void {
    const rejectedResults: PromiseRejectedResult[] = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    rejectedResults.forEach((rejected, i) => {
      logger.error(
        `Error occurred (count: ${i}): `,
        rejected.reason.toString(),
      );
    });
  }
}
