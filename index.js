/*
Desired Overall Flow:
If our API rate limit is exceeded delay until it is reset
If we have called GitHub in the last X milliseconds delay until X milliseconds has elapsed since the last call
Pop a URL to crawl off the queue
Query the cache to see if we have retrieved that URL in the last N days, if so discard it
Perform a GET against the URL
If it fails (permanently) discard
If it fails (temporarily) return it to the end of the queue
If it succeeds:
  Generate hypermedia links from the response
  Store the document in the database with the hypermedia links
  Extract further crawl targets from the response
  Add the crawl targets to the queue

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
const queue = [{ type: 'orgs', url: 'https://api.github.com/user/orgs' }];
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
        case 'orgs': {
          processCollection(body, 'login', crawlRequest.context);
          break;
        }
        case 'repo': {
          processRepo(body, crawlRequest.context);
          break;
        }
        case 'login': {
          processLogin(body, crawlRequest.context);
          break;
        }
        case 'repos': {
          processCollection(body, 'repo', crawlRequest.context);
          break;
        }
        case 'issues': {
          processCollection(body, 'issue', crawlRequest.context);
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

function processCollection(document, type, context) {
  document.forEach(item => {
    queue.push({ type: type, url: item.url, context: context });
  });
  return null;
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

function processIssue(document, context) {
  document._metadata.links.push({ 'self': { type: 'self', href: `urn:repo:${context.repo.id}:issue:${document.id}` } });
  document._metadata.links.push({ 'siblings': { type: 'siblings', href: `urn:repo:${context.repo.id}:issues` } });
  document._metadata.links.push({ 'assignees': { type: 'self', hrefs: document.assignees.map(assignee => { return `urn:login:${assignee.id}`}) } });
  return document;
}