import type {
  ActionsBlock,
  ActionsBlockElement,
  Button,
  Checkboxes,
  Datepicker,
  DividerBlock,
  HeaderBlock,
  InputBlock,
  MultiSelect,
  Option,
  PlainTextInput,
  RadioButtons,
  SectionBlock,
  Select,
} from '@slack/types';

export function divider(): DividerBlock {
  return {
    type: 'divider',
  };
}

export function markdownHeaderBlock(text: string): HeaderBlock {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text,
    },
  };
}

export function markdownSectionBlock(text: string): SectionBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

export function inputSectionBlock(
  blockId: string,
  labelText: string,
  actionId: string,
  isMultiline: boolean,
  placeholder: string,
): InputBlock {
  return {
    type: 'input',
    block_id: blockId,
    label: {
      type: 'plain_text',
      text: labelText,
    },
    element: {
      type: 'plain_text_input',
      action_id: actionId,
      multiline: isMultiline,
      placeholder: {
        type: 'plain_text',
        text: placeholder,
      },
    },
  };
}

export function actionsBlock(...elements: ActionsBlockElement[]): ActionsBlock {
  return {
    type: 'actions',
    elements,
  };
}

export function inputBlock(
  element:
    | Select
    | MultiSelect
    | Datepicker
    | PlainTextInput
    | RadioButtons
    | Checkboxes,
  blockId: string,
  labelText: string,
): InputBlock {
  return {
    type: 'input',
    block_id: blockId,
    element,
    label: {
      type: 'plain_text',
      text: labelText,
    },
  };
}

type ButtonElement = {
  text: string;
  actionId: string;
  style?: string;
  value?: string;
};

/**
 * Button element
 * https://api.slack.com/reference/block-kit/block-elements#button
 */
export function buttonElement({
  text,
  actionId,
  style,
  value,
}: ButtonElement): Button {
  const button: Button = {
    type: 'button',
    text: {
      type: 'plain_text',
      text,
    },
    action_id: actionId,
    value,
  };
  if (style === 'primary' || style === 'danger') {
    button.style = style;
  }
  return button;
}

/**
 * Option object
 * https://api.slack.com/reference/block-kit/composition-objects#option
 */
export function checkboxesElementOption(
  text: string,
  description: string,
  value: string,
): Option {
  return {
    text: {
      type: 'mrkdwn',
      text,
    },
    description: {
      type: 'plain_text',
      text: description,
    },
    value,
  };
}
