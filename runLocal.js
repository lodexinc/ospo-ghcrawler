const OspoCrawler = require('./lib/ospoCrawler');
const Crawler = require('ghcrawler').crawler;

const logger = OspoCrawler.createLogger(true, true);
const options = OspoCrawler.createOptions();
const queues = OspoCrawler.createAmqpQueues(options.queuing);
const store = OspoCrawler.createStore(options.storage);
const locker = OspoCrawler.createLocker(options.locker);
const requestorInstance = OspoCrawler.createRequestor();
// options.promiseTrace = true;
const crawler = new Crawler(queues, store, locker, requestorInstance, options, logger);
const seedRequests = [OspoCrawler.createSeedRequest('orgs', 'https://api.github.com/user/orgs', 'urn:microsoft/orgs')];

OspoCrawler.runCrawler(crawler, 10, seedRequests);