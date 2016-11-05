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

Reserved link names:
* self
* siblings
* parent
*/

const config = require('painless-config');
const Crawler = require('ghcrawler');
const CrawlQueue = require('./lib/crawlqueue');
const MongoDocStore = require('./lib/mongodocstore');
const requestor = require('ghrequestor');
const winston = require('winston');

const queue = new CrawlQueue();
queue.push({ type: 'orgs', url: 'https://api.github.com/user/orgs' });

const requestorInstance = new requestor({
  headers: {
    authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
  }
});

const store = new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'));
store.connect(() => {
  const crawler = new Crawler(queue, store, requestorInstance, winston);
  crawler.start();
});