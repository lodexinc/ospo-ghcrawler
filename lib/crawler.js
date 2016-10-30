const request = require('request');
const moment = require('moment');
const winston = require('winston');

class Crawler {
  constructor(queue, store) {
    this.seen = {};
    this.queue = queue;
    this.store = store;
  }

  start() {
    const self = this;
    const crawlRequest = this.queue.pop();
    if (!crawlRequest) {
      winston.info(`Queue empty`);
      return;
    }
    if (!this.seen[crawlRequest.url]) {
      request.get(crawlRequest.url + '?per_page=100', { headers: { 'User-Agent': 'ghcrawler' }, json: true }, function (err, response, body) {
        self.seen[crawlRequest.url] = true;
        body._metadata = {
          type: crawlRequest.type,
          url: crawlRequest.url,
          fetchedAt: moment.utc().toISOString(),
          links: {}
        };
        let document = null;
        switch (crawlRequest.type) {
          case 'orgs': {
            document = self._processCollection(body, 'login', crawlRequest.context);
            break;
          }
          case 'repo': {
            document = self._processRepo(body, crawlRequest.context);
            break;
          }
          case 'login': {
            document = self._processLogin(body, crawlRequest.context);
            break;
          }
          case 'repos': {
            document = self._processCollection(body, 'repo', crawlRequest.context);
            break;
          }
          case 'issues': {
            document = self._processCollection(body, 'issue', crawlRequest.context);
            break;
          }
          case 'issue': {
            document = self._processIssue(body, crawlRequest.context);
            break;
          }
          case 'issue_comments': {
            document = self._processCollection(body, 'issue_comment', crawlRequest.context);
            break;
          }
          case 'issue_comment': {
            document = self._processIssueComment(body, crawlRequest.context);
            break;
          }
        }

        winston.info(`Crawled ${crawlRequest.url} [${crawlRequest.type}]`);
        if (document && self.store) {
          self.store.upsert(document, () => {
            setTimeout(self.start.bind(self), 0);
          });
        } else {
          setTimeout(self.start.bind(self), 0);
        }
      }).auth('', process.env['GITHUB_TOKEN']);
    }
    else {
      winston.info(`Skipped ${crawlRequest.url} [${crawlRequest.type}]`);
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
    document._metadata.links.self = { type: 'self', 'href': `urn:repo:${document.id}` };
    document._metadata.links.owner = { type: 'self', href: `urn:login:${document.owner.id}` };
    document._metadata.links.parent = { type: 'self', href: `urn:login:${document.owner.id}` };
    document._metadata.links.siblings = { type: 'siblings', href: `urn:login:${document.owner.id}:repos` };
    this.queue.push({ type: 'login', url: document.owner.url });
    this.queue.push({ type: 'issues', url: document.issues_url.replace('{/number}', ''), context: {repo: document } });
    return document;
  }

  _processLogin(document) {
    document._metadata.links.self = { type: 'self', href: `urn:login:${document.id}` };
    document._metadata.links.repos = { type: 'siblings', href: `urn:login:${document.id}:repos` };
    document._metadata.links.siblings = { type: 'siblings', href: 'urn:login' };
    this.queue.push({ type: 'repos', url: document.repos_url });
    return document;
  }

  _processIssue(document, context) {
    document._metadata.links.self = { type: 'self', href: `urn:repo:${context.repo.id}:issue:${document.id}` };
    document._metadata.links.siblings = { type: 'siblings', href: `urn:repo:${context.repo.id}:issues` };
    document._metadata.links.assignees = { type: 'self', hrefs: document.assignees.map(assignee => { return `urn:login:${assignee.id}` }) };
    document._metadata.links.repo = { type: 'self', href: `urn:repo:${context.repo.id}` };
    document._metadata.links.parent = document._metadata.links.repo;
    document._metadata.links.user = { type: 'self', href: `urn:login:${document.user.id}` };
    this.queue.push({ type: 'login', url: document.user.url });
    if (document.assignee) {
      document._metadata.links.assignee = { type: 'self', href: `urn:login:${document.assignee.id}` };
      this.queue.push({ type: 'login', url: document.assignee.url });
    }
    if (document.closed_by) {
      document._metadata.links.closed_by = { type: 'self', href: `urn:login:${document.closed_by.id}` };
      this.queue.push({ type: 'login', url: document.closed_by.url });
    }

    // milestone
    // pull request
    // events
    // labels
    this.queue.push({ type: 'issue_comments', url: document.comments_url, context: { issue: document.id, repo: context.repo.id } });
    return document;
  }

  _processIssueComment(document, context) {
    document._metadata.links.self = { type: 'self', href: `urn:repo:${context.repo.id}:issue_comment:${document.id}` };
    document._metadata.links.user = { type: 'self', href: `urn:login:${document.user.id}` };
    document._metadata.links.siblings = { type: 'siblings', href: `urn:repo:${context.repo}:issue:${context.issue}:comments` };
    this.queue.push({ type: 'login', url: document.user.url });
    return document;
  }
}

module.exports = Crawler;