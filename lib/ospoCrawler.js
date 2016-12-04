const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const AmqpQueue = require('./amqpQueue');
const appInsights = require("applicationinsights");
const AttenuatedQueue = require('./attenuatedQueue');
const AzureStorageDocStore = require('./storageDocStore');
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const CrawlerService = require('ghcrawler').crawlerService;
const fs = require('fs');
const InMemoryCrawlQueue = require('./inmemorycrawlqueue');
const InmemoryDocStore = require('./inmemoryDocStore');
const mockInsights = require('./mockInsights');
const MongoDocStore = require('./mongodocstore');
const MultiStore = require('./multiStore');
const policy = require('ghcrawler').policy;
const Q = require('q');
const QueueSet = require('ghcrawler').queueSet;
const redis = require('redis');
const RedisRequestTracker = require('./redisRequestTracker');
const redlock = require('redlock');
const request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const ServiceBusCrawlQueue = require('./servicebuscrawlqueue');
const TrackedQueue = require('./trackedQueue');
const UrlToUrnMappingStore = require('./urlToUrnMappingStore');
const winston = require('winston');

redisClient = null;

class OspoCrawler {

  static createOptions() {
    const storageName = config.get('GHCRAWLER_STORAGE_NAME');
    const env = process.env.NODE_ENV;
    return {
      crawler: {
        count: 0,
        processingTtl: 60 * 1000,
        promiseTrace: false,
        orgList: OspoCrawler._loadLines(config.get('GHCRAWLER_ORGS_FILE')),
        fetcher: {
          tokenLowerBound: 50,
          forbiddenDelay: 120000
        }
      },
      queuing: {
        weights: [3, 2, 3, 2],
        parallelPush: 10,
        provider: config.get('GHCRAWLER_QUEUE_PROVIDER') || 'amqp',
        topic: config.get('GHCRAWLER_SERVICEBUS_TOPIC') || 'ghcrawler',
        attenuation: {
          ttl: 1000
        },
        tracker: {
          // driftFactor: 0.01,
          // retryCount: 3,
          // retryDelay: 200,
          // locking: true,
          // lockTtl: 1000,
          ttl: 6 * 60 * 1000
        }
      },
      storage: {
        ttl: 60000,
        provider: config.get('GHCRAWLER_STORE_PROVIDER') || 'redisAzure'
      },
      locker: {
        retryCount: 3,
        retryDelay: 200
      },
      requestor: {
      }
    };
  }

  static createCrawlerService(options = null, logger = null) {
    logger = logger || OspoCrawler.createLogger(false, true);
    options = options || OspoCrawler.createOptions();
    OspoCrawler._addLoggerToOptions(options, logger);
    const crawler = OspoCrawler.createCrawler(options);
    return new CrawlerService(crawler, options);
  }

  static createReprocessorService(options = null, logger = null) {
    logger = logger || OspoCrawler.createLogger(false, true, 'info');
    options = options || OspoCrawler.createOptions();
    OspoCrawler._addLoggerToOptions(options, logger);

    const name = config.get('GHCRAWLER_STORAGE_NAME');
    const oldOptions = Object.assign({}, options.storage);
    oldOptions.blobKey = 'url';
    const oldStore = OspoCrawler.createAzureStorageStore(oldOptions, name);

    const newName = config.get('GHCRAWLER_STORAGE_NEW_NAME') || name + '-new';
    const newStore = OspoCrawler.createRedisAndStorageStore(options.storage, newName);
    const multiStore = new MultiStore(oldStore, newStore, options);
    // const multiStore = new MultiStore(oldStore, newStore, options);
    const crawler = OspoCrawler.createCrawler(options, { store: multiStore });
    return new CrawlerService(crawler, options);
  }

  static _addLoggerToOptions(options, logger) {
    Object.getOwnPropertyNames(options).forEach(key => options[key].logger = logger);
  }

  static createCrawler(
    options = OspoCrawler.createOptions(), {
      queues = OspoCrawler.createQueues(options.queuing),
      store = OspoCrawler.createStore(options.storage),
      locker = OspoCrawler.createLocker(options.locker),
      requestor = OspoCrawler.createRequestor(options.requestor) } = {}) {

    const result = new Crawler(queues, store, locker, requestor, options.crawler);
    result.initialize = OspoCrawler._initialize.bind(result);
    return result;
  }

  static _initialize() {
    return Q.try(this.queues.subscribe.bind(this.queues))
      .then(this.store.connect.bind(this.store));
  }

  static createRequestor(options) {
    return requestor.defaults({
      // turn off the requestor's throttle management mechanism in favor of ours
      forbiddenDelay: 0,
      delayOnThrottle: false,
      headers: {
        authorization: `token ${config.get('GHCRAWLER_GITHUB_TOKEN')}`
      }
    });
  }

  static createStore(options) {
    return (options.provider || 'azure') === 'mongo' ? OspoCrawler.createMongoDocStore(options) : OspoCrawler.createAzureStorageStore(options);
  }

  static createMongoStore(options) {
    return new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'), options);
  }

  static createRedisAndStorageStore(options, name = config.get('GHCRAWLER_STORAGE_NAME')) {
    const baseStore = new AzureStorageDocStore(config.get('GHCRAWLER_STORAGE_ACCOUNT'), config.get('GHCRAWLER_STORAGE_KEY'), name, options);
    return new UrlToUrnMappingStore(OspoCrawler.getRedisClient(), baseStore, name, options);
  }

  static createAzureStorageStore(options, name = config.get('GHCRAWLER_STORAGE_NAME')) {
    return new AzureStorageDocStore(config.get('GHCRAWLER_STORAGE_ACCOUNT'), config.get('GHCRAWLER_STORAGE_KEY'), name, options);
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

  static createLocker(options) {
    return new redlock([OspoCrawler.getRedisClient()], {
      driftFactor: 0.01,
      retryCount: options.retryCount,
      retryDelay: options.retryDelay
    });
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

  static createRequestTracker(prefix, options) {
    let locker = null;
    if (options.tracker.locking) {
      locker = new redlock([OspoCrawler.getRedisClient()], options.tracker);
    } else {
      locker = { lock: () => null, unlock: () => { } };
    }
    return new RedisRequestTracker(prefix, OspoCrawler.getRedisClient(), locker, options);
  }

  static createNolock() {
    return { lock: () => null, unlock: () => { } };
  }
  static createQueues(options) {
    return (options.provider || 'amqp') === 'amqp' ? OspoCrawler.createAmqpQueues(options) : OspoCrawler.createServiceBusQueues(options);
  }

  static createServiceBusQueues(options) {
    const url = config.get('GHCRAWLER_SERVICEBUS_URL');
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:SB:${options.topic}`, options);
    const immediate = OspoCrawler.createServiceBusQueue(url, 'immediate', tracker, options);
    const soon = OspoCrawler.createServiceBusQueue(url, 'soon', tracker, options);
    const normal = OspoCrawler.createServiceBusQueue(url, 'normal', tracker, options);
    const later = OspoCrawler.createServiceBusQueue(url, 'later', tracker, options);
    const deadletter = OspoCrawler.createServiceBusQueue(url, 'deadletter', tracker, options);
    return new QueueSet([immediate, soon, normal, later], deadletter, options);
  }

  static createAmqpQueues(options) {
    const url = config.get('GHCRAWLER_AMQP_URL');
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:AMQP:${options.topic}`, options);
    const immediate = OspoCrawler.createAmqpQueue(url, 'immediate', tracker, options);
    const soon = OspoCrawler.createAmqpQueue(url, 'soon', tracker, options);
    const normal = OspoCrawler.createAmqpQueue(url, 'normal', tracker, options);
    const later = OspoCrawler.createAmqpQueue(url, 'later', tracker, options);
    const deadletter = OspoCrawler.createAmqpQueue(url, 'deadletter', tracker, options);
    return new QueueSet([immediate, soon, normal, later], deadletter, options);
  }

  static createMemoryQueues() {
    const immediate = OspoCrawler.createMemoryQueue('immediate');
    const soon = OspoCrawler.createMemoryQueue('soon');
    const normal = OspoCrawler.createMemoryQueue('normal');
    const later = OspoCrawler.createMemoryQueue('later');
    const deadletter = OspoCrawler.createMemoryQueue('deadletter');
    return new QueueSet([immediate, soon, normal, later], deadletter, options);
  }

  static createMemoryQueue() {
    return new InMemoryCrawlQueue();
  }

  static createServiceBusQueue(url, name, flagger, options) {
    const formatter = message => {
      const result = JSON.parse(message.body);
      request.adopt(result);
      return result;
    };
    return new ServiceBusCrawlQueue(url, name, formatter, flagger, options);
  }

  static createAmqpQueue(url, name, tracker, options) {
    const formatter = message => {
      const result = JSON.parse(message);
      request.adopt(result);
      return result;
    };
    const queue = new AmqpQueue(url, name, formatter, options);
    return new AttenuatedQueue(new TrackedQueue(queue, tracker, options), options);
  }

  // TODO need to reload from time to time to allow updating of the org filter list when new orgs are discovered.
  // Harder than you'd think.  May be many agents running.  As soon as we discover a new org, we might start
  // seeing events from it.  The agents all need to get the updated filter.
  static _loadLines(path) {
    if (!path || !fs.existsSync(path)) {
      return [];
    }
    let result = fs.readFileSync(path, 'utf8');
    result = result.split(/\s/);
    return result.filter(line => { return line; }).map(line => { return line.toLowerCase(); });
  }
}

module.exports = OspoCrawler;
