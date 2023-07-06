import { GitHubUrl } from './github-url';

describe('GitHubUrl Constructor throws an error when the url string is', () => {

  it.concurrent.each`
    url
    ${'//example.com/org/repos'}
    ${'https://example.com'}
    ${'https://github.com/org/repos/foo'}
  `("'$url'", ({ url }) => {
    // when
    const caller = () => new GitHubUrl(url);

    // then
    expect(caller).toThrowError(`The specified URL is invalid. : url='${url}'`);
  });

});

describe('The constructor is successfully processed', () => {

  it('with http schemed url', () => {
    // when
    const githubUrl = new GitHubUrl('http://github.com/org/repos');

    // then
    expect(githubUrl).not.toBeNull();
    expect(githubUrl.organizationName).toEqual('org');
    expect(githubUrl.reposName).toEqual('repos');
    expect(githubUrl.branchName).toEqual('main');
  });

  it('with https schemed url', () => {
    // when
    const githubUrl = new GitHubUrl('https://github.com/org/repos');

    // then
    expect(githubUrl).not.toBeNull();
    expect(githubUrl.organizationName).toEqual('org');
    expect(githubUrl.reposName).toEqual('repos');
    expect(githubUrl.branchName).toEqual('main');
  });

  it('with branchName', () => {
    // when
    const githubUrl = new GitHubUrl('https://github.com/org/repos', 'fix/bug');

    // then
    expect(githubUrl).not.toBeNull();
    expect(githubUrl.organizationName).toEqual('org');
    expect(githubUrl.reposName).toEqual('repos');
    expect(githubUrl.branchName).toEqual('fix/bug');
  });

});

describe('archiveUrl()', () => {
  it('returns zip url', () => {
    // setup
    const githubUrl = new GitHubUrl('https://github.com/org/repos', 'fix/bug');

    // when
    const { archiveUrl } = githubUrl;

    // then
    expect(archiveUrl).toEqual('https://github.com/org/repos/archive/refs/heads/fix/bug.zip');
  });
});
