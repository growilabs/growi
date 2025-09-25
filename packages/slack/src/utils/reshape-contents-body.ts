/**
 * RegExp for Slack message header
 * @type {RegExp}
 * @see https://regex101.com/r/wk24Z0/1
 */
const regexpMessageHeader = new RegExp(/.+\s\s[\d]{1,2}:[\d]{2}(\s[AP]{1}M)?$/);

/**
 * RegExp for Slack message Time with/without AM, PM
 * @type {RegExp}
 * @see https://regex101.com/r/Tz3ZPG/1
 */
const regexpTime = new RegExp(/\s\s[\d]{1,2}:[\d]{2}(\s[AP]{1}M)?$/);

/**
 * RegExp for Slack message Time without AM, PM
 * @type {RegExp}
 * @see https://regex101.com/r/e1Yi6t/1
 */
const regexpShortTime = new RegExp(/^[\d]{1,2}:[\d]{2}$/);

/**
 * RegExp for Slack message reaction
 * @type {RegExp}
 * @see https://regex101.com/r/LQX3s2/1
 */
const regexpReaction = new RegExp(/^:[+\w-]+:$/);

// Remove everything before the first Header
const devideLinesBeforeAfterFirstHeader = (lines: string[]) => {
  let i = 0;
  while (!regexpMessageHeader.test(lines[i]) && i <= lines.length) {
    i++;
  }
  const linesBeforeFirstHeader = lines.slice(0, i);
  const linesAfterFirstHeader = lines.slice(i);
  return { linesBeforeFirstHeader, linesAfterFirstHeader };
};

// Reshape linesAfterFirstHeader
export const reshapeContentsBody = (str: string): string => {
  const splitted = str.split('\n');
  const { linesBeforeFirstHeader, linesAfterFirstHeader } =
    devideLinesBeforeAfterFirstHeader(splitted);
  if (linesAfterFirstHeader.length === 0) {
    return linesBeforeFirstHeader.join('\n');
  }

  let didReactionRemoved = false;
  const reshapedArray = linesAfterFirstHeader.map((line) => {
    let copyline = line;
    // Check 1: Did a reaction removed last time?
    if (didReactionRemoved) {
      // remove reaction count
      copyline = '';
      didReactionRemoved = false;
    }
    // Check 2: Is this line a header?
    else if (regexpMessageHeader.test(copyline)) {
      // extract time from line
      const matched = copyline.match(regexpTime);
      let time = '';
      if (matched !== null && matched.length > 0) {
        time = matched[0];
      }
      // ##*username*  HH:mm AM
      copyline = '\n## **'.concat(copyline);
      copyline = copyline.replace(
        regexpTime,
        '**<span class="grw-keep-time">'.concat(time, '</span>\n'),
      );
    }
    // Check 3: Is this line a short time(HH:mm)?
    else if (regexpShortTime.test(copyline)) {
      // --HH:mm--
      copyline = '--'.concat(copyline, '--');
    }
    // Check 4: Is this line a reaction?
    else if (regexpReaction.test(copyline)) {
      // remove reaction
      copyline = '';
      didReactionRemoved = true;
    }
    return copyline;
  });
  // remove all blanks
  const blanksRemoved = reshapedArray.filter((line) => line !== '');
  // add <div> to the first line & add </div> to the last line
  blanksRemoved[0] = '\n<div class="grw-keep">\n'.concat(blanksRemoved[0]);
  blanksRemoved.push('</div>');
  // Add 2 spaces and 1 enter to all lines
  const completedArray = blanksRemoved.map((line) => line.concat('  \n'));
  // join all
  const contentsBeforeFirstHeader = linesBeforeFirstHeader.join('');
  const contentsAfterFirstHeader = completedArray.join('');
  return contentsBeforeFirstHeader.concat(contentsAfterFirstHeader);
};
