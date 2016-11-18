const OspoCrawler = require('./lib/ospoCrawler');

const topic = process.argv[2];
const queueProvider = process.argv[3] || 'amqp';
const logger = OspoCrawler.createLogger(false, true);
const queues = OspoCrawler.createQueues(queueProvider, topic, logger);
const seedRequests = [OspoCrawler.createSeedRequest('orgs', 'https://api.github.com/user/orgs', 'urn:microsoft/orgs')];

queues.push(seedRequests).finally(() => process.exit());