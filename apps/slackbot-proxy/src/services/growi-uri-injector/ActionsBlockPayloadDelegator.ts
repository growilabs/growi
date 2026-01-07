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
    const elements = actionsBlocks.flatMap(
      // biome-ignore lint/style/noNonNullAssertion: elements must be set --- IGNORE ---
      (actionBlock) => actionBlock.elements!,
    );

    this.childDelegators.forEach((delegator) => {
      if (delegator.shouldHandleToInject(elements)) {
        delegator.inject(elements, growiUri);
      }
    });
  }

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

    // biome-ignore lint/style/noNonNullAssertion: growiUriWithOriginalData must be set --- IGNORE ---
    return growiUriWithOriginalData!;
  }
}
