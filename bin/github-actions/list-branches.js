/* eslint-disable no-console */

/*
 * USAGE:
 *  node list-branches [OPTION]
 *
 * OPTIONS:
 *  --inactive : Return inactive branches (default)
 *  --illegal : Return illegal named branches
 */

const { execSync } = require('child_process');
const url = require('url');

const EXCLUDE_TERM_DAYS = 14;
const EXCLUDE_PATTERNS = [
  /^support\/apply-tsed$/,
  // https://regex101.com/r/Lnx7Pz/3
  /^dev\/[\d.x]*$/,
  /^release\/.+$/,
  /^dependabot\/.+$/,
];
const LEGAL_PATTERNS = [
  /^master$/,
  // https://regex101.com/r/p9xswM/4
  /^(dev|feat|imprv|support|fix|rc|release|tmp)\/.+$/,
];
const GITHUB_REPOS_URI = 'https://github.com/growilabs/growi/';

class BranchSummary {

  constructor(line) {
    const splitted = line.split('\t'); // split with '%09'

    this.authorDate = new Date(splitted[0].trim());
    this.authorName = splitted[1].trim();
    this.branchName = splitted[2].trim().replace(/^origin\//, '');
    this.subject = splitted[3].trim();
  }

}

function getExcludeTermDate() {
  const date = new Date();
  date.setDate(date.getDate() - EXCLUDE_TERM_DAYS);
  return date;
}

function getBranchSummaries() {
  // exec git for-each-ref
  const out = execSync(`\
    git for-each-ref refs/remotes \
      --sort=-committerdate \
      --format='%(authordate:iso) %09 %(authorname) %09 %(refname:short) %09 %(subject)'
  `).toString();

  // parse
  const summaries = out
    .split('\n')
    .filter(v => v !== '') // trim empty string
    .map(line => new BranchSummary(line))
    .filter((summary) => { // exclude branches that matches to patterns
      return !EXCLUDE_PATTERNS.some(pattern => pattern.test(summary.branchName));
    });

  return summaries;
}

function getGitHubCommitsUrl(branchName) {
  return url.resolve(GITHUB_REPOS_URI, `commits/${branchName}`);
}

function getGitHubComparingLink(branchName) {
  const label = `master &lt;- ${branchName}`;
  const link = url.resolve(GITHUB_REPOS_URI, `compare/${branchName}`);
  return `<${link}|${label}>`;
}

/**
 * @see https://api.slack.com/messaging/composing/layouts#building-attachments
 * @see https://github.com/marketplace/actions/slack-incoming-webhook
 *
 * @param {string} mode
 * @param {BranchSummary} summaries
 */
function printSlackAttachments(mode, summaries) {
  const color = (mode === 'illegal') ? 'warning' : '#999999';

  const attachments = summaries.map((summary) => {
    const {
      authorName, authorDate, branchName, subject,
    } = summary;

    return {
      color,
      title: branchName,
      title_link: getGitHubCommitsUrl(branchName),
      fields: [
        {
          title: 'Author Date',
          value: authorDate,
          short: true,
        },
        {
          title: 'Author',
          value: authorName,
          short: true,
        },
        {
          title: 'Last Commit Subject',
          value: subject,
        },
        {
          title: 'Comparing Link',
          value: getGitHubComparingLink(branchName),
        },
      ],
    };
  });

  console.log(JSON.stringify(attachments));
}

async function main(mode) {
  const summaries = getBranchSummaries();

  let filteredSummaries;

  switch (mode) {
    case 'illegal':
      filteredSummaries = summaries
        .filter((summary) => { // exclude branches that matches to patterns
          return !LEGAL_PATTERNS.some(pattern => pattern.test(summary.branchName));
        });
      break;
    default: {
      const excludeTermDate = getExcludeTermDate();
      filteredSummaries = summaries
        .filter((summary) => {
          return summary.authorDate < excludeTermDate;
        });
      break;
    }
  }

  printSlackAttachments(mode, filteredSummaries);
}

const args = process.argv.slice(2);

let mode = 'inactive';
if (args.length > 0 && args[0] === '--illegal') {
  mode = 'illegal';
}

main(mode);
