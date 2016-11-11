const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const appInsights = require("applicationinsights");
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const fs = require('fs');
const mockInsights = require('./lib/mockInsights');
const ServiceBusCrawlQueue = require('./lib/servicebuscrawlqueue');
const InMemoryCrawlQueue = require('./lib/inmemorycrawlqueue');
const MongoDocStore = require('./lib/mongodocstore');
const InmemoryDocStore = require('./lib/inmemoryDocStore');
const request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const winston = require('winston');

// Create queue to crawl.  Use a service bus queue if configured, otherwise, use an in-memory implementation
const serviceBusUrl = config.get('GHCRAWLER_SERVICEBUS_URL');
const serviceBusTopic = config.get('GHCRAWLER_SERVICEBUS_TOPIC') || 'crawlqueue';

const normalQueue = createQueue(serviceBusUrl, serviceBusTopic + '-normal', 'normal');
const priorityQueue = createQueue(serviceBusUrl, serviceBusTopic + '-priority', 'priority');
const deadLetterQueue = createQueue(serviceBusUrl, serviceBusTopic + '-deadletter', 'deadletter');

// Create a requestor for talking to GitHub API
const requestorInstance = requestor.defaults({
  headers: {
    authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
  }
});

// Create the document store.
const store = new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'));
// const store = new InmemoryDocStore();

// Gather and configure the crawling options
const options = {
  orgFilter: loadLines(config.get('GHCRAWLER_ORGS_FILE'))
};

setupLogging(true);

// Create a crawler and start it working
const crawler = new Crawler(queue, priorityQueue, deadletterQueue, store, requestorInstance, options, winston);
const firstRequest = request.create('orgs', 'https://api.github.com/user/orgs');
firstRequest.force = true;
firstRequest.context = { qualifier: 'urn:microsoft/orgs' };
for (let i = 1; i <= 2; i++) {
  queue.subscribe()
    .then(() => queue.push(firstRequest))
    .then(store.connect.bind(store))
    .then(crawler.start.bind(crawler))
    .done();
}

// TODO need to reload from time to time to allow updating of the org filter list when new orgs are discovered.
// Harder than you'd think.  May be many agents running.  As soon as we discover a new org, we might start
// seeing events from it.  The agents all need to get the updated filter.
function loadLines(path) {
  if (!path || !fs.existsSync(path)) {
    return new Set();
  }
  let result = fs.readFileSync(path, 'utf8');
  result = result.split(/\s/);
  return new Set(result.filter(line => { return line; }).map(line => { return line.toLowerCase(); }));
}

function setupLogging(echo = false) {
  mockInsights.setup(config.get('GHCRAWLER_INSIGHTS_KEY'), echo);
  winston.add(aiLogger, {
    insights: appInsights,
    treatErrorsAsExceptions: true
  });
  winston.remove(winston.transports.Console);
}

function createQueue(url, topic, subscription) {
  if (!url) {
    return new InMemoryCrawlQueue();
  }
  const formatter = values => {
    const message = values[0];
    const result = JSON.parse(message.body);
    // convert the loaded object one of our requests and remember the original for disposal
    // TODO need to test this mechanism
    result.__proto__ = request.prototype;
    result.constructor.call(result);
    result._message = message;
    return result;
  };
  queue = new ServiceBusCrawlQueue(serviceBusUrl, serviceBusTopic, subscription, formatter);
}