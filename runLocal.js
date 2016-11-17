const OspoCrawler = require('./lib/ospoCrawler');
const Crawler = require('ghcrawler').crawler;

const queues = OspoCrawler.createAmqpQueues();
const store = OspoCrawler.createStore();
const locker = OspoCrawler.createLocker();
const requestorInstance = OspoCrawler.createRequestor();
const options = OspoCrawler.createOptions();
// options.promiseTrace = true;
const logger = OspoCrawler.createLogger(false, true, 'verbose');
const crawler = new Crawler(queues, store, locker, requestorInstance, options, logger);
const seedRequests = [OspoCrawler.createSeedRequest('orgs', 'https://api.github.com/user/orgs', 'urn:microsoft/orgs')];

OspoCrawler.runCrawler(crawler, 20, seedRequests);