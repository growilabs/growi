/**
 * @typedef {import('../../../types').MigrationModule} MigrationModule
 */

module.exports = [
  /**
   * Adjust line breaks and indentation for any directives within HTML tags
   * @type {MigrationModule}
   */
  (body) => {
    const lines = body.split('\n');
    const directivePattern = /\$[\w\-_]+\([^)]*\)/;
    let lastDirectiveLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (directivePattern.test(lines[i])) {
        const currentLine = lines[i];
        const prevLine = i > 0 ? lines[i - 1] : '';
        const nextLine = i < lines.length - 1 ? lines[i + 1] : '';

        // Always remove indentation from directive line
        lines[i] = currentLine.trimStart();

        // Insert empty line only if:
        // 1. Previous line contains an HTML tag (ends with >)
        // 2. Previous line is not empty
        // 3. Previous line is not a directive line
        const isPrevLineHtmlTag = prevLine.match(/>[^\n]*$/) && !prevLine.match(directivePattern);
        const isNotAfterDirective = i - 1 !== lastDirectiveLineIndex;

        if (isPrevLineHtmlTag && prevLine.trim() !== '' && isNotAfterDirective) {
          lines.splice(i, 0, '');
          i++;
        }

        // Update the last directive line index
        lastDirectiveLineIndex = i;

        // Handle next line if it's a closing tag
        if (nextLine.match(/^\s*<\//)) {
          lines[i + 1] = nextLine.trimStart();
        }
      }
    }

    return lines.join('\n');
  },

  /**
   * Remove unnecessary parentheses in directive arguments
   * @type {MigrationModule}
   */
  (body) => {
    // Detect and process directive-containing lines in multiline mode
    return body.replace(/^.*\$[\w\-_]+\([^)]*\).*$/gm, (line) => {
      // Convert filter=(value) to filter=value
      let processedLine = line.replace(/filter=\(([^)]+)\)/g, 'filter=$1');

      // Convert except=(value) to except=value
      processedLine = processedLine.replace(/except=\(([^)]+)\)/g, 'except=$1');

      return processedLine;
    });
  },
];
