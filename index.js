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
const Q = require('q');
const redis = require('redis');
const redlock = require('redlock');
const request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const winston = require('winston');

// Create queue to crawl.  Use a service bus queue if configured, otherwise, use an in-memory implementation
// const serviceBusUrl = null;
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

// Create the locker.
// let locker = null;
const redisOptions = { auth_pass: config.get('GHCRAWLER_REDIS_ACCESS_KEY') };
redisOptions.tls = { servername: config.get('GHCRAWLER_REDIS_URL') };
const redisClient = redis.createClient(config.get('GHCRAWLER_REDIS_PORT'), config.get('GHCRAWLER_REDIS_URL'), redisOptions);
locker = new redlock([redisClient], {
  driftFactor: 0.01,
  retryCount: 3,
  retryDelay: 200
});

// Gather and configure the crawling options
const options = {
  orgFilter: loadLines(config.get('GHCRAWLER_ORGS_FILE'))
};

setupLogging(true);

// Create a crawler and start it working
const crawler = new Crawler(normalQueue, priorityQueue, deadLetterQueue, store, locker, requestorInstance, options, winston);
const firstRequest = new request('orgs', 'https://api.github.com/user/orgs');
firstRequest.force = true;
firstRequest.context = { qualifier: 'urn:microsoft/orgs' };
Q.all([normalQueue.unsubscribe(), priorityQueue.unsubscribe()])
  .then(() => Q.all([normalQueue.subscribe(), priorityQueue.subscribe()]))
  .then(() => normalQueue.push(firstRequest))
  .then(store.connect.bind(store))
  .then(() => start(crawler, 1))
  .catch(error => console.log(error.stack))
  .done();

function start(crawler, count) {
  const promises = [];
  for (let i = 1; i <= count; i++) {
    promises.push(crawler.start(i));
  }
  return Q.allSettled(promises);
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
    treatErrorsAsExceptions: true,
    level: 'verbose'
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
    result._message = message;
    return result;
  };
  return new ServiceBusCrawlQueue(serviceBusUrl, serviceBusTopic, subscription, formatter);
}