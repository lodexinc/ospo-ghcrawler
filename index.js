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

const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const appInsights = require("applicationinsights");
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const fs = require('fs');
const ServiceBusCrawlQueue = require('./lib/servicebuscrawlqueue');
const InMemoryCrawlQueue = require('./lib/inmemorycrawlqueue');
const MongoDocStore = require('./lib/mongodocstore');
const InmemoryDocStore = require('./lib/inmemoryDocStore');
const requestor = require('ghrequestor');
const winston = require('winston');

// Create queue to crawl.  Use a service bus queue if configured, otherwise, use an in-memory implementation
const serviceBusUrl = config.get('GHCRAWLER_SERVICEBUS_URL');
const serviceBusTopic = config.get('GHCRAWLER_SERVICEBUS_TOPIC') || 'crawlqueue';
let queue = null;
if (serviceBusUrl) {
  const formatter = values => {
    const message = values[0];
    const crawlRequest = JSON.parse(message.body);
    crawlRequest.message = message;
    return crawlRequest;
  };
  queue = new ServiceBusCrawlQueue(serviceBusUrl, serviceBusTopic, 'ghcrawler', formatter);
} else {
  queue = new InMemoryCrawlQueue();
}
const priorityQueue = new InMemoryCrawlQueue();

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

setupLogging();

// Create a crawler and start it working
const crawler = new Crawler(queue, priorityQueue, store, requestorInstance, options, winston);
queue.subscribe()
  .then(() => queue.push({ type: 'orgs', url: 'https://api.github.com/user/orgs', force: true, context: { qualifier: 'urn:microsoft/orgs' } }))
  .then(store.connect.bind(store))
  .then(crawler.start.bind(crawler))
  .done();

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

function setupLogging() {
  setupAppInsights();
  winston.add(aiLogger, {
    insights: appInsights,
    treatErrorsAsExceptions: true
  });
  winston.remove(winston.transports.Console);
}

function setupAppInsights(key) {
  key = key || config.get('GHCRAWLER_INSIGHTS_KEY');
  if (!key || key === 'mock') {
    appInsights.client = new mockInsights();
  } else {
    appInsights.setup(key).start();
  }
}

function mockInsights() {
  const self = this;
  const severities = ['Verbose', 'Info', 'Warning', 'Error', 'Critical'];
  self.trackEvent = function (name, properties, measurements) { console.log('Event: ' + name + ', properties: ' + JSON.stringify(properties)); };
  self.trackException = function (exception, properties) { console.error('Exception: ' + exception.message + ', properties: ' + JSON.stringify(properties)); };
  self.trackMetric = function (name, value, count, min, max, stdDev) { console.log('Metric: ' + name + ' = ' + value); };
  self.trackRequest = function (request, response, properties) { console.log('Request: '); };
  self.trackTrace = function (message, severityLevel = 1, properties = null) {
    const hasProperties = properties && Object.keys(properties).length > 0;
    const propertyString = hasProperties ? `${JSON.stringify(properties)}` : '';
    console.log(`Trace: [${severities[severityLevel]}] ${message}${propertyString}`);
  };
  self.trackDependency = function (name, commandName, elapsedTimeMs, success, dependencyTypeName, properties, dependencyKind, async, dependencySource) { console.log('Dependency: ' + name); };
}