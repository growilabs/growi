import { Service } from '@tsed/di';

import {
  GrowiUriInjector,
  GrowiUriWithOriginalData,
  TypedBlock,
} from '~/interfaces/growi-uri-injector';

type ButtonElement = TypedBlock & {
  value: string;
};

type ButtonActionPayload = TypedBlock & {
  value: string;
};

@Service()
export class ButtonActionPayloadDelegator
  implements
    GrowiUriInjector<
      TypedBlock[],
      ButtonElement[],
      TypedBlock,
      ButtonActionPayload
    >
{
  shouldHandleToInject(elements: TypedBlock[]): elements is ButtonElement[] {
    const buttonElements = elements.filter(
      (element) => element.type === 'button',
    );
    return buttonElements.length > 0;
  }

  inject(elements: ButtonElement[], growiUri: string): void {
    const buttonElements = elements.filter(
      (blockElement) => blockElement.type === 'button',
    );

    buttonElements.forEach((element) => {
      const urlWithOrgData: GrowiUriWithOriginalData = {
        growiUri,
        originalData: element.value,
      };
      element.value = JSON.stringify(urlWithOrgData);
    });
  }

  shouldHandleToExtract(action: TypedBlock): action is ButtonActionPayload {
    return action.type === 'button';
  }

  extract(action: ButtonActionPayload): GrowiUriWithOriginalData {
    const restoredData: GrowiUriWithOriginalData = JSON.parse(
      action.value || '{}',
    );

    if (restoredData.originalData != null) {
      action.value = restoredData.originalData;
    }

    return restoredData;
  }
}
