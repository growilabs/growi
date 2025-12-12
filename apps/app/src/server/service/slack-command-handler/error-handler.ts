import type { RespondBodyForResponseUrl } from '@growi/slack';
import { markdownSectionBlock } from '@growi/slack/dist/utils/block-kit-builder';
import { respond } from '@growi/slack/dist/utils/response-url';
import { type ChatPostEphemeralResponse, WebClient } from '@slack/web-api';
import assert from 'assert';

import { SlackCommandHandlerError } from '../../models/vo/slack-command-handler-error';

function generateRespondBodyForInternalServerError(
  message,
): RespondBodyForResponseUrl {
  return {
    text: message,
    blocks: [
      markdownSectionBlock(
        `*GROWI Internal Server Error occured.*\n \`${message}\``,
      ),
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleErrorWithWebClient(
  error: Error,
  client: WebClient,
  body: any,
): Promise<ChatPostEphemeralResponse> {
  const isInteraction = !body.channel_id;

  // this method is expected to use when system couldn't response_url
  assert(
    !(error instanceof SlackCommandHandlerError) || error.responseUrl == null,
  );

  const payload = JSON.parse(body.payload);

  const channel = isInteraction ? payload.channel.id : body.channel_id;
  const user = isInteraction ? payload.user.id : body.user_id;

  return client.chat.postEphemeral({
    channel,
    user,
    ...generateRespondBodyForInternalServerError(error.message),
  });
}

export async function handleError(
  error: SlackCommandHandlerError | Error,
  responseUrl?: string,
): Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleError(
  error: Error,
  client: WebClient,
  body: any,
): Promise<ChatPostEphemeralResponse>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleError(
  error: SlackCommandHandlerError | Error,
  ...args: any[]
): Promise<void | ChatPostEphemeralResponse> {
  // handle a SlackCommandHandlerError
  if (error instanceof SlackCommandHandlerError) {
    const responseUrl = args[0] || error.responseUrl;

    assert(responseUrl != null, 'Specify responseUrl.');

    return respond(responseUrl, error.respondBody);
  }

  const secondArg = args[0];
  assert(
    secondArg != null,
    "Couldn't handle Error without the second argument.",
  );

  // handle a normal Error with response_url
  if (typeof secondArg === 'string') {
    const respondBody = generateRespondBodyForInternalServerError(
      error.message,
    );
    return respond(secondArg, respondBody);
  }

  assert(args[0] instanceof WebClient);

  // handle with WebClient
  return handleErrorWithWebClient(error, args[0], args[1]);
}
