const OspoCrawler = require('./lib/ospoCrawler');

const logger = OspoCrawler.createLogger(false, true);
const queues = OspoCrawler.createServiceBusQueues(logger);
const seedRequests = [OspoCrawler.createSeedRequest('orgs', 'https://api.github.com/user/orgs', 'urn:microsoft/orgs')];

queues.push(seedRequests).finally(() => process.exit());