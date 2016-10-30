const moment = require('moment');
const config = require('painless-config');
const GitHubFetcher = require('./githubFetcher');

class Crawler {
  constructor(queue) {
    this.seen = {};
    this.queue = queue;
    this.fetcher = new GitHubFetcher({
      headers: {
        authorization: `token ${config.get("GITHUB_CRAWLER_TOKEN")}`
      }
    });
  }

  start() {
    const self = this;
    const crawlRequest = this.queue.pop();
    if (!crawlRequest) {
      return;
    }
    if (!this.seen[crawlRequest.url]) {
      this.fetcher.getAll(crawlRequest.url).then(body => {
        self.seen[crawlRequest.url] = true;
        body._metadata = {
          type: crawlRequest.type,
          url: crawlRequest.url,
          fetchedAt: moment.utc().toISOString(),
          links: []
        };
        switch (crawlRequest.type) {
          case 'orgs': {
            self._processCollection(body, 'login', crawlRequest.context);
            break;
          }
          case 'repo': {
            self._processRepo(body, crawlRequest.context);
            break;
          }
          case 'login': {
            self._processLogin(body, crawlRequest.context);
            break;
          }
          case 'repos': {
            self._processCollection(body, 'repo', crawlRequest.context);
            break;
          }
          case 'issues': {
            self._processCollection(body, 'issue', crawlRequest.context);
            break;
          }
          case 'issue': {
            self._processIssue(body, crawlRequest.context);
            break;
          }
        }
        console.dir(body);
        setTimeout(self.start.bind(self), 0);
      });
    }
    else {
      setTimeout(self.start.bind(self), 0);
    }
  }

  _processCollection(document, type, context) {
    document.forEach(item => {
      this.queue.push({ type: type, url: item.url, context: context });
    });
    return null;
  }

  _processRepo(document) {
    document._metadata.links.push({ 'self': { type: 'self', 'href': `urn: repo:${document.id}` } });
    document._metadata.links.push({ 'owner': { type: 'self', href: `urn: login:${document.owner.id}` } });
    document._metadata.links.push({ 'parent': { type: 'self', href: `urn: login:${document.owner.id}` } });
    document._metadata.links.push({ 'siblings': { type: 'siblings', href: `urn: login:${document.owner.id}:repos` } });
    this.queue.push({ type: 'login', url: document.owner.url });
    this.queue.push({ type: 'issues', url: document.issues_url.replace('{/number}', ''), context: { repo: document } });
    return document;
  }

  _processLogin(document) {
    document._metadata.links.push({ 'self': { type: 'self', href: `urn: login:${document.id}` } });
    document._metadata.links.push({ 'repos': { type: 'siblings', href: `urn: login:${document.id}:repos` } });
    document._metadata.links.push({ 'siblings': { type: 'siblings', href: 'urn:login' } });
    this.queue.push({ type: 'repos', url: document.repos_url });
    return document;
  }

  _processIssue(document, context) {
    document._metadata.links.push({ 'self': { type: 'self', href: `urn: repo:${context.repo.id}:issue: ${document.id}` } });
    document._metadata.links.push({ 'siblings': { type: 'siblings', href: `urn:repo:${context.repo.id}:issues` } });
    document._metadata.links.push({ 'assignees': { type: 'self', hrefs: document.assignees.map(assignee => { return `urn:login:${assignee.id}` }) } });
    return document;
  }
}

module.exports = Crawler;