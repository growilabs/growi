import { Service } from '@tsed/di';

import {
  GrowiUriInjector,
  GrowiUriWithOriginalData,
  isGrowiUriWithOriginalData,
  TypedBlock,
} from '~/interfaces/growi-uri-injector';

// see: https://api.slack.com/reference/interaction-payloads/views
type ViewElement = TypedBlock & {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  private_metadata?: any;
};

// see: https://api.slack.com/reference/interaction-payloads/views
type ViewInteractionPayload = TypedBlock & {
  view: {
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    private_metadata?: any;
  };
};

@Service()
export class ViewInteractionPayloadDelegator
  implements GrowiUriInjector<any, ViewElement, any, ViewInteractionPayload>
{
  shouldHandleToInject(data: any): data is ViewElement {
    return data.type != null && data.private_metadata != null;
  }

  inject(data: ViewElement, growiUri: string): void {
    const originalData = data.private_metadata;

    const urlWithOrgData: GrowiUriWithOriginalData = { growiUri, originalData };

    data.private_metadata = JSON.stringify(urlWithOrgData);
  }

  shouldHandleToExtract(data: any): data is ViewInteractionPayload {
    const { type, view } = data;
    if (type !== 'view_submission') {
      return false;
    }
    if (view.private_metadata == null) {
      return false;
    }

    try {
      const restoredData: any = JSON.parse(view.private_metadata);
      return isGrowiUriWithOriginalData(restoredData);
    } catch (err) {
      // when parsing failed
      return false;
    }
  }

  extract(data: ViewInteractionPayload): GrowiUriWithOriginalData {
    const restoredData: GrowiUriWithOriginalData = JSON.parse(
      // biome-ignore lint/style/noNonNullAssertion: private_metadata must be set --- IGNORE ---
      data.view.private_metadata!,
    ); // private_metadata must not be null at this moment
    data.view.private_metadata = restoredData.originalData;

    return restoredData;
  }
}
