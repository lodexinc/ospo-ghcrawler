const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const AmqpQueue = require('./amqpQueue');
const appInsights = require("applicationinsights");
const AzureStorageDocStore = require('./storageDocStore');
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const CrawlerService = require('ghcrawler').crawlerService;
const fs = require('fs');
const InMemoryCrawlQueue = require('./inmemorycrawlqueue');
const InmemoryDocStore = require('./inmemoryDocStore');
const mockInsights = require('./mockInsights');
const MongoDocStore = require('./mongodocstore');
const Q = require('q');
const QueueSet = require('ghcrawler').queueSet;
const redis = require('redis');
const RedisRequestFlagger = require('./redisRequestFlagger');
const redlock = require('redlock');
const request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const ServiceBusCrawlQueue = require('./servicebuscrawlqueue');
const winston = require('winston');

redisClient = null;

class OspoCrawler {

  static run(agentCount) {
    const crawler = OspoCrawler.createTypicalSetup(config.get('GHCRAWLER_QUEUE_PROVIDER'), config.get('GHCRAWLER_STORE_PROVIDER'));
    const service = new CrawlerService(crawler);
    service.reconfigure({ count: agentCount });
    return service;
  }

  static createTypicalSetup(queueProvider, storeProvider, topic = null) {
    const logger = OspoCrawler.createLogger(false, true);
    const queues = OspoCrawler.createQueues(queueProvider, topic, logger);
    const store = OspoCrawler.createStore(storeProvider);
    const locker = OspoCrawler.createLocker();
    const requestorInstance = OspoCrawler.createRequestor();
    const options = OspoCrawler.createOptions();
    const result = new Crawler(queues, store, locker, requestorInstance, options, logger);
    result.initialize = OspoCrawler._initialize.bind(result);
    return result;
  }

  static _initialize() {
    return Q.try(() => this.queues.subscribe())
      .then(this.store.connect.bind(this.store));
  }

  static getQueueWeights() {
    return [3, 2, 3, 2];
  }
  static createQueues(queueProvider, topic, logger) {
    return (queueProvider || 'amqp') === 'amqp' ? OspoCrawler.createAmqpQueues(topic, logger) : OspoCrawler.createServiceBusQueues(topic, logger);
  }

  static cleanRunCrawler(crawler, agentCount, seedRequests = null) {
    return crawler.queues.unsuscribe().then(() => {
      return OspoCrawler.run(crawler, agentCount, seedRequests);
    });
  }

  static runCrawler(crawler, agentCount, seedRequests = null) {
    return Q.try(() => crawler.queues.subscribe())
      .then(() => crawler.queues.push(seedRequests || []))
      .then(crawler.store.connect.bind(crawler.store))
      .then(() => OspoCrawler._start(crawler, agentCount))
      .catch(error =>
        crawler.logger.error(error))
      .done();
  }

  static _start(crawler, count) {
    const promises = [];
    const jobName = config.get('WEBJOBS_NAME') || 'default';
    for (let i = 1; i <= count; i++) {
      promises.push(crawler.start(`${jobName}-${i}`));
    }
    return Q.allSettled(promises).then(() => console.log('Done all crawler loops'));
  }

  static createSeedRequest(type, url, qualifier) {
    const result = new request(type, url);
    result.force = true;
    result.context = { qualifier: qualifier };
    return result;
  }

  static createRequestor() {
    return requestor.defaults({
      forbiddenDelay: 0,
      delayOnThrottle: false,
      headers: {
        authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
      }
    });
  }

  static createStore(provider) {
    return (provider || 'mongo') === 'mongo' ? OspoCrawler.createMongoDocStore() : OspoCrawler.createAzureStorageStore();
  }

  static createMongoStore() {
    return new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'));
  }

  static createAzureStorageStore() {
    return new AzureStorageDocStore(config.get('GHCRAWLER_STORAGE_ACCOUNT'), config.get('GHCRAWLER_STORAGE_KEY'), config.get('GHCRAWLER_NAME'));
  }

  static createOptions() {
    return {
      orgFilter: OspoCrawler._loadLines(config.get('GHCRAWLER_ORGS_FILE'))
    };
  }

  static getRedisClient() {
    if (redisClient) {
      return redisClient;
    }
    const redisOptions = { auth_pass: config.get('GHCRAWLER_REDIS_ACCESS_KEY') };
    redisOptions.tls = { servername: config.get('GHCRAWLER_REDIS_URL') };
    redisClient = redis.createClient(config.get('GHCRAWLER_REDIS_PORT'), config.get('GHCRAWLER_REDIS_URL'), redisOptions);
    return redisClient;
  }

  static createLocker(fake = false) {
    if (fake) {
      return null;
    }
    return new redlock([OspoCrawler.getRedisClient()], {
      driftFactor: 0.01,
      retryCount: 3,
      retryDelay: 200
    });
  }

  // TODO need to reload from time to time to allow updating of the org filter list when new orgs are discovered.
  // Harder than you'd think.  May be many agents running.  As soon as we discover a new org, we might start
  // seeing events from it.  The agents all need to get the updated filter.
  static _loadLines(path) {
    if (!path || !fs.existsSync(path)) {
      return new Set();
    }
    let result = fs.readFileSync(path, 'utf8');
    result = result.split(/\s/);
    return new Set(result.filter(line => { return line; }).map(line => { return line.toLowerCase(); }));
  }

  static createLogger(fake = false, echo = false, level = 'info') {
    mockInsights.setup(fake ? null : config.get('GHCRAWLER_INSIGHTS_KEY'), echo);
    winston.add(aiLogger, {
      insights: appInsights,
      treatErrorsAsExceptions: true,
      exitOnError: false,
      level: level
    });
    winston.remove(winston.transports.Console);
    return winston;
  }

  static createRequestFlagger(prefix, redisClient, logger = null) {
    return new RedisRequestFlagger(prefix, OspoCrawler.getRedisClient(), logger);
  }

  static createServiceBusQueues(topic = null, logger = null) {
    const url = config.get('GHCRAWLER_SERVICEBUS_URL');
    topic = topic || config.get('GHCRAWLER_SERVICEBUS_TOPIC') || 'crawlqueue';
    const flagger = OspoCrawler.createRequestFlagger(`SB:${topic}`, OspoCrawler.getRedisClient(), logger);
    const immediate = OspoCrawler.createServiceBusQueue(url, 'immediate', topic, flagger, logger);
    const soon = OspoCrawler.createServiceBusQueue(url, 'soon', topic, flagger, logger);
    const normal = OspoCrawler.createServiceBusQueue(url, 'normal', topic, flagger, logger);
    const later = OspoCrawler.createServiceBusQueue(url, 'later', topic, flagger, logger);
    const deadletter = OspoCrawler.createServiceBusQueue(url, 'deadletter', topic, flagger, logger);
    return new QueueSet([immediate, soon, normal, later], deadletter, OspoCrawler.getQueueWeights());
  }

  static createAmqpQueues(topic = null, logger = null) {
    const url = config.get('GHCRAWLER_AMQP_URL');
    topic = topic || config.get('GHCRAWLER_SERVICEBUS_TOPIC') || 'crawlqueue';
    const flagger = OspoCrawler.createRequestFlagger(`AMQP:${topic}`, OspoCrawler.getRedisClient(), logger);
    const immediate = OspoCrawler.createAmqpQueue(url, 'immediate', topic, flagger, logger);
    const soon = OspoCrawler.createAmqpQueue(url, 'soon', topic, flagger, logger);
    const normal = OspoCrawler.createAmqpQueue(url, 'normal', topic, flagger, logger);
    const later = OspoCrawler.createAmqpQueue(url, 'later', topic, flagger, logger);
    const deadletter = OspoCrawler.createAmqpQueue(url, 'deadletter', topic, flagger, logger);
    return new QueueSet([immediate, soon, normal, later], deadletter, OspoCrawler.getQueueWeights());
  }

  static createMemoryQueues() {
    const immediate = OspoCrawler.createMemoryQueue('immediate');
    const soon = OspoCrawler.createMemoryQueue('soon');
    const normal = OspoCrawler.createMemoryQueue('normal');
    const later = OspoCrawler.createMemoryQueue('later');
    const deadletter = OspoCrawler.createMemoryQueue('deadletter');
    return new QueueSet([immediate, soon, normal, later], deadletter, OspoCrawler.getQueueWeights());
  }

  static createMemoryQueue() {
    return new InMemoryCrawlQueue();
  }

  static createServiceBusQueue(url, name, topic, flagger, logger) {
    const formatter = message => {
      const result = JSON.parse(message.body);
      // Attach our "request" functionality to the loaded object
      result.__proto__ = request.prototype;
      return result;
    };
    return new ServiceBusCrawlQueue(url, name, topic, formatter, flagger, logger);
  }

  static createAmqpQueue(url, name, topic, flagger, logger) {
    const formatter = message => {
      const result = JSON.parse(message);
      // Attach our "request" functionality to the loaded object
      result.__proto__ = request.prototype;
      return result;
    };
    return new AmqpQueue(url, name, topic, formatter, flagger, logger);
  }
}

module.exports = OspoCrawler;
