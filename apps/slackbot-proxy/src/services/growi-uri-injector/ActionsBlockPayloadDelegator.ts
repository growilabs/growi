import { Inject, OnInit, Service } from '@tsed/di';

import {
  GrowiUriInjector,
  GrowiUriWithOriginalData,
  TypedBlock,
} from '~/interfaces/growi-uri-injector';

import { ButtonActionPayloadDelegator } from './block-elements/ButtonActionPayloadDelegator';
import { CheckboxesActionPayloadDelegator } from './block-elements/CheckboxesActionPayloadDelegator';

// see: https://api.slack.com/reference/block-kit/blocks
type BlockElement = TypedBlock & {
  elements: (TypedBlock & any)[];
};

// see: https://api.slack.com/reference/interaction-payloads/block-actions
type BlockActionsPayload = TypedBlock & {
  actions: TypedBlock[];
};

@Service()
export class ActionsBlockPayloadDelegator
  implements
    GrowiUriInjector<any, BlockElement[], any, BlockActionsPayload>,
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
  shouldHandleToInject(data: any): data is BlockElement[] {
    const actionsBlocks = data.filter(
      (blockElement) => blockElement.type === 'actions',
    );
    return actionsBlocks.length > 0;
  }

  inject(data: BlockElement[], growiUri: string): void {
    const actionsBlocks = data.filter(
      (blockElement) => blockElement.type === 'actions',
    );

    // collect elements
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const elements = actionsBlocks.flatMap(
      (actionBlock) => actionBlock.elements!,
    );

    this.childDelegators.forEach((delegator) => {
      if (delegator.shouldHandleToInject(elements)) {
        delegator.inject(elements, growiUri);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  shouldHandleToExtract(data: any): data is BlockActionsPayload {
    if (data.actions == null || data.actions.length === 0) {
      return false;
    }

    const action = data.actions[0];
    return this.childDelegators
      .map((delegator) => delegator.shouldHandleToExtract(action))
      .includes(true);
  }

  extract(data: BlockActionsPayload): GrowiUriWithOriginalData {
    let growiUriWithOriginalData: GrowiUriWithOriginalData;

    const action = data.actions[0];
    for (const delegator of this.childDelegators) {
      if (delegator.shouldHandleToExtract(action)) {
        growiUriWithOriginalData = delegator.extract(action);
        break;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return growiUriWithOriginalData!;
  }
}
