/*
Graph Navigation:
* If a link has a type self then search for a match in links.self
* If a link has a type siblings then search for a match in links.siblings
* If a link has a hrefs then search each of the hrefs using the type semantics above
* If a link has a href and hrefs then union them together
* Don't assume that the target of a link exists
* Links are unordered
*/

const request = require('request');
const moment = require('moment');
const queue = [{ type: 'repo', url: 'https://api.github.com/repos/Microsoft/painless-config' }];
const seen = {};

processNext();

function processNext() {
  const crawlRequest = queue.shift();
  if (!crawlRequest) {
    return;
  }
  if (!seen[crawlRequest.url]) {
    request.get(crawlRequest.url + '?per_page=100', { headers: { 'User-Agent': 'ghcrawler' }, json: true }, function (err, response, body) {
      seen[crawlRequest.url] = true;
      body._metadata = {
        type: crawlRequest.type,
        url: crawlRequest.url,
        fetchedAt: moment.utc().toISOString(),
        links: []
      };
      switch (crawlRequest.type) {
        case 'repo': {
          processRepo(body, crawlRequest.context);
          break;
        }
        case 'login': {
          processLogin(body, crawlRequest.context);
          break;
        }
        case 'repos': {
          processRepos(body, crawlRequest.context);
          break;
        }
        case 'issues': {
          processIssues(body, crawlRequest.context);
          break;
        }
        case 'issue': {
          processIssue(body, crawlRequest.context);
          break;
        }
      }
      console.dir(body);
      setTimeout(processNext, 0);
    }).auth('', process.env['GITHUB_TOKEN']);
  }
  else {
    setTimeout(processNext, 0);
  }
}

function processRepo(document) {
  document._metadata.links.push({ 'self': { type: 'self', 'href': `urn:repo:${document.id}` } });
  document._metadata.links.push({ 'owner': { type: 'self', href: `urn:login:${document.owner.id}` } });
  document._metadata.links.push({ 'parent': { type: 'self', href: `urn:login:${document.owner.id}` } });
  document._metadata.links.push({ 'siblings': { type: 'siblings', href: `urn:login:${document.owner.id}:repos` } });
  queue.push({ type: 'login', url: document.owner.url });
  queue.push({ type: 'issues', url: document.issues_url.replace('{/number}', ''), context: {repo: document } });
  return document;
}

function processLogin(document) {
  document._metadata.links.push({ 'self': { type: 'self', href: `urn:login:${document.id}` } });
  document._metadata.links.push({ 'repos': { type: 'siblings', href: `urn:login:${document.id}:repos` } });
  document._metadata.links.push({ 'siblings': { type: 'siblings', href: 'urn:login' } });
  queue.push({ type: 'repos', url: document.repos_url });
  return document;
}

function processRepos(document) {
  document.forEach(repo => {
    queue.push({ type: 'repo', url: repo.url });
  });
  return null;
}

function processIssues(document, context) {
  document.forEach(issue => {
    queue.push({ type: 'issue', url: issue.url, context: context });
  });
  return null;
}

function processIssue(document, context) {
  document._metadata.links.push({ 'self': { type: 'self', href: `urn:repo:${context.repo.id}:issue:${document.id}` } });
  document._metadata.links.push({ 'siblings': { type: 'siblings', href: `urn:repo:${context.repo.id}:issues` } });
  document._metadata.links.push({ 'assignees': { type: 'self', hrefs: document.assignees.map(assignee => { return `urn:login:${assignee.id}`}) } });
  return document;
}