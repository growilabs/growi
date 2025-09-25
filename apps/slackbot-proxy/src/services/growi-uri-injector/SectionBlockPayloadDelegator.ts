import { Inject, OnInit, Service } from '@tsed/di';

import {
  GrowiUriInjector,
  GrowiUriWithOriginalData,
  TypedBlock,
} from '~/interfaces/growi-uri-injector';

import { ButtonActionPayloadDelegator } from './block-elements/ButtonActionPayloadDelegator';
import { CheckboxesActionPayloadDelegator } from './block-elements/CheckboxesActionPayloadDelegator';

// see: https://api.slack.com/reference/block-kit/blocks#section
type SectionWithAccessoryElement = TypedBlock & {
  accessory: TypedBlock & any;
};

// see: https://api.slack.com/reference/interaction-payloads/block-actions
type BlockActionsPayload = TypedBlock & {
  actions: TypedBlock[];
};

@Service()
export class SectionBlockPayloadDelegator
  implements
    GrowiUriInjector<
      any,
      SectionWithAccessoryElement[],
      any,
      BlockActionsPayload
    >,
    OnInit
{
  @Inject()
  buttonActionPayloadDelegator: ButtonActionPayloadDelegator;

  @Inject()
  checkboxesActionPayloadDelegator: CheckboxesActionPayloadDelegator;

  private childDelegators: GrowiUriInjector<
    TypedBlock[],
    any,
    TypedBlock,
    any
  >[] = [];

  $onInit(): void | Promise<any> {
    this.childDelegators.push(
      this.buttonActionPayloadDelegator,
      this.checkboxesActionPayloadDelegator,
    );
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  shouldHandleToInject(data: any): data is SectionWithAccessoryElement[] {
    const sectionBlocks = data.filter(
      (blockElement) =>
        blockElement.type === 'section' && blockElement.accessory != null,
    );
    return sectionBlocks.length > 0;
  }

  inject(data: SectionWithAccessoryElement[], growiUri: string): void {
    const sectionBlocks = data.filter(
      (blockElement) =>
        blockElement.type === 'section' && blockElement.accessory != null,
    );

    // collect elements
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const accessories = sectionBlocks.flatMap(
      (sectionBlock) => sectionBlock.accessory,
    );

    this.childDelegators.forEach((delegator) => {
      if (delegator.shouldHandleToInject(accessories)) {
        delegator.inject(accessories, growiUri);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  shouldHandleToExtract(data: any): data is BlockActionsPayload {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  extract(data: BlockActionsPayload): GrowiUriWithOriginalData {
    throw new Error('No need to implement. Use ActionsBlockPayloadDelegator');
  }
}
