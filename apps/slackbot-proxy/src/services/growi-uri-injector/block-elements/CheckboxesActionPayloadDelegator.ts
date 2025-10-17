import { Service } from '@tsed/di';

import {
  GrowiUriInjector,
  GrowiUriWithOriginalData,
  TypedBlock,
} from '~/interfaces/growi-uri-injector';

type CheckboxesElement = TypedBlock & {
  options: { value: string }[];
};

type CheckboxesActionPayload = TypedBlock & {
  selected_options: { value: string }[];
};

@Service()
export class CheckboxesActionPayloadDelegator
  implements
    GrowiUriInjector<
      TypedBlock[],
      CheckboxesElement[],
      TypedBlock,
      CheckboxesActionPayload
    >
{
  shouldHandleToInject(
    elements: TypedBlock[],
  ): elements is CheckboxesElement[] {
    const buttonElements = elements.filter(
      (element) => element.type === 'checkboxes',
    );
    return buttonElements.length > 0;
  }

  inject(elements: CheckboxesElement[], growiUri: string): void {
    const cbElements = elements.filter(
      (blockElement) => blockElement.type === 'checkboxes',
    );

    cbElements.forEach((element) => {
      element.options.forEach((option) => {
        const urlWithOrgData: GrowiUriWithOriginalData = {
          growiUri,
          originalData: option.value,
        };
        option.value = JSON.stringify(urlWithOrgData);
      });
    });
  }

  shouldHandleToExtract(action: TypedBlock): action is CheckboxesActionPayload {
    return (
      action.type === 'checkboxes' &&
      (action as CheckboxesActionPayload).selected_options != null &&
      // ...Unsolved problem...
      // slackbot-proxy can't determine growiUri when selected_options is empty -- 2021.07.12 Yuki Takei
      (action as CheckboxesActionPayload).selected_options.length > 0
    );
  }

  extract(action: CheckboxesActionPayload): GrowiUriWithOriginalData {
    let oneOfRestoredData: GrowiUriWithOriginalData;

    action.selected_options.forEach((selectedOption) => {
      const restoredData = JSON.parse(selectedOption.value);
      selectedOption.value = restoredData.originalData;

      // update oneOfRestoredData
      oneOfRestoredData = restoredData;
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return oneOfRestoredData!;
  }
}
