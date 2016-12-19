const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const AmqpQueue = require('./amqpQueue');
const Amqp10Queue = require('./amqp10Queue');
const appInsights = require('applicationinsights');
const AzureStorage = require('azure-storage');
const AttenuatedQueue = require('./attenuatedQueue');
const AzureStorageDocStore = require('./storageDocStore');
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const CrawlerService = require('ghcrawler').crawlerService;
const fs = require('fs');
const GitHubFetcher = require('ghcrawler').githubFetcher;
const GitHubProcessor = require('ghcrawler').githubProcessor;
const InMemoryCrawlQueue = require('./inmemorycrawlqueue');
const InmemoryDocStore = require('./inmemoryDocStore');
const LoggingStore = require('./loggingStore');
const mockInsights = require('./mockInsights');
const MongoDocStore = require('./mongodocstore');
const MultiStore = require('./multiStore');
const ObjectObserver = require('./objectObserver');
const policy = require('ghcrawler').policy;
const Q = require('q');
const QueueSet = require('ghcrawler').queueSet;
const redis = require('redis');
const RedisRequestTracker = require('./redisRequestTracker');
const redlock = require('redlock');
const Request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const ServiceBusCrawlQueue = require('./servicebuscrawlqueue');
const ServiceBusSubscription = require('./serviceBusSubscription');
const TokenFactory = require('./tokenFactory');
const TrackedQueue = require('./trackedQueue');
const UrlToUrnMappingStore = require('./urlToUrnMappingStore');
const winston = require('winston');

redisClients = {};

class OspoCrawler {

  static createOptions() {
    const storageName = config.get('GHCRAWLER_STORAGE_NAME');
    const env = process.env.NODE_ENV;
    return {
      crawler: {
        count: 0,
        pollingDelay: 5000,
        processingTtl: 60 * 1000,
        promiseTrace: false,
        orgList: OspoCrawler._loadLines(config.get('GHCRAWLER_ORGS_FILE'))
      },
      fetcher: {
        tokenLowerBound: 50,
        forbiddenDelay: 120000,
        concurrency: 4
      },
      queuing: {
        weights: [3, 2, 3, 2],
        parallelPush: 10,
        provider: config.get('GHCRAWLER_QUEUE_PROVIDER') || 'amqp10',
        queueName: config.get('GHCRAWLER_QUEUE_NAME') || 'crawler',
        events: {
          weight: 4,
          topic: config.get('GHCRAWLER_EVENT_TOPIC_NAME') || 'crawler',
          queueName: config.get('GHCRAWLER_EVENT_QUEUE_NAME') || 'crawler'
        },
        attenuation: {
          ttl: 1000
        },
        tracker: {
          // driftFactor: 0.01,
          // retryCount: 3,
          // retryDelay: 200,
          // locking: true,
          // lockTtl: 1000,
          ttl: 60 * 60 * 1000
        },
        credit: 2
      },
      storage: {
        ttl: 6 * 1000,
        provider: config.get('GHCRAWLER_STORE_PROVIDER') || 'redisAzure'
      },
      locker: {
        retryCount: 3,
        retryDelay: 200
      }
    };
  }

  static createStandardService(options = null, logger = null) {
    logger = logger || OspoCrawler.createLogger(false, true, 'info');
    options = options || OspoCrawler.createOptions();
    OspoCrawler._addLoggerToOptions(options, logger);

    const store = OspoCrawler.createRedisAndStorageStore(options.storage);
    const loggingStore = OspoCrawler.createLoggingStore(store);
    const crawler = OspoCrawler.createCrawler(options, { store: loggingStore });
    return new CrawlerService(crawler, options);
  }

  static createOldNewService(options = null, logger = null) {
    logger = logger || OspoCrawler.createLogger(false, true, 'info');
    options = options || OspoCrawler.createOptions();
    OspoCrawler._addLoggerToOptions(options, logger);

    // copy and override the storage options to creat a read store
    const oldOptions = Object.assign({}, options.storage, { role: 'read' });
    const oldStore = OspoCrawler.createRedisAndStorageStore(oldOptions);

    const store = OspoCrawler.createRedisAndStorageStore(options.storage);
    const loggingStore = OspoCrawler.createLoggingStore(store);
    const multiStore = new MultiStore(oldStore, loggingStore, options);
    const crawler = OspoCrawler.createCrawler(options, { store: multiStore });
    return new CrawlerService(crawler, options);
  }

  static createInMemoryService(options = null, logger = null) {
    logger = logger || OspoCrawler.createLogger(true, true, 'info');
    options = options || OspoCrawler.createOptions();
    OspoCrawler._addLoggerToOptions(options, logger);

    const store = new InmemoryDocStore(true);
    const queues = OspoCrawler.createMemoryQueues();
    const locker = OspoCrawler.createNolock();

    const crawler = OspoCrawler.createCrawler(options, { store: store, queues: queues, locker: locker });
    return new CrawlerService(crawler, options);
  }

  static _addLoggerToOptions(options, logger) {
    Object.getOwnPropertyNames(options).forEach(key => {
      options[key].logger = logger;
      new ObjectObserver(options[key]);
    });
  }

  static createCrawler(
    options = OspoCrawler.createOptions(), {
      queues = OspoCrawler.createQueues(options.queuing),
      store = OspoCrawler.createStore(options.storage),
      locker = OspoCrawler.createLocker(options.locker),
      fetcher = null,
      processor = null
    } = {}) {

    fetcher = fetcher || OspoCrawler.createGitHubFetcher(store, options.fetcher);
    processor = processor || new GitHubProcessor(store);
    const result = new Crawler(queues, store, locker, fetcher, processor, options.crawler);
    result.initialize = OspoCrawler._initialize.bind(result);
    return result;
  }

  static _initialize() {
    return Q.try(this.queues.subscribe.bind(this.queues))
      .then(this.store.connect.bind(this.store));
  }

  static createGitHubFetcher(store, options) {
    const requestor = OspoCrawler.createRequestor();
    const tokenFactory = OspoCrawler.createTokenFactory(options);
    return new GitHubFetcher(requestor, store, tokenFactory, options);
  }

  static createTokenFactory(options) {
    const tokenSpecs = config.get('GHCRAWLER_GITHUB_TOKENS').split(';');
    const tokens = tokenSpecs.map(spec => TokenFactory.createToken(spec));
    return new TokenFactory(tokens, options);
  }

  static createRequestor() {
    return requestor.defaults({
      // turn off the requestor's throttle management mechanism in favor of ours
      forbiddenDelay: 0,
      delayOnThrottle: false
    });
  }

  static createStore(options) {
    return (options.provider || 'azure') === 'mongo' ? OspoCrawler.createMongoDocStore(options) : OspoCrawler.createRedisAndStorageStore(options);
  }

  static createMongoStore(options) {
    return new MongoDocStore(config.get('GHCRAWLER_MONGO_URL'), options);
  }

  static createRedisAndStorageStore(options, name = null) {
    const baseStore = OspoCrawler.createAzureStorageStore(options, name);
    return new UrlToUrnMappingStore(baseStore, OspoCrawler.getStorageRedisClient(options), baseStore.name, options);
  }

  static createAzureStorageStore(options, name = null) {
    const role = options.role ? `.${options.role}` : '';
    name = name || config.get(`GHCRAWLER_STORAGE_NAME${role}`) || config.get('GHCRAWLER_STORAGE_NAME');
    const account = config.get(`GHCRAWLER_STORAGE_ACCOUNT${role}`) || config.get('GHCRAWLER_STORAGE_ACCOUNT');
    const key = config.get(`GHCRAWLER_STORAGE_KEY${role}`) || config.get('GHCRAWLER_STORAGE_KEY');
    const blobService = OspoCrawler.createBlobService(account, key);
    return new AzureStorageDocStore(blobService, name, options);
  }

  static createLoggingStore(baseStore, name = null, options = {}) {
    name = name || config.get('GHCRAWLER_DOCLOG_STORAGE_NAME') || `${config.get('GHCRAWLER_STORAGE_NAME')}-log`;
    const account = config.get('GHCRAWLER_DOCLOG_STORAGE_ACCOUNT') || config.get('GHCRAWLER_STORAGE_ACCOUNT');
    const key = config.get('GHCRAWLER_DOCLOG_STORAGE_KEY') || config.get('GHCRAWLER_STORAGE_KEY');
    const blobService = OspoCrawler.createBlobService(account, key);
    return new LoggingStore(baseStore, blobService, name, options);
  }

  static getStorageRedisClient(options = {}) {
    const role = options.role ? `.${options.role}` : '';
    if (redisClients[role]) {
      return redisClients[role];
    }
    const url = config.get(`GHCRAWLER_STORAGE_REDIS_URL${role}`) || config.get('GHCRAWLER_STORAGE_REDIS_URL') || config.get('GHCRAWLER_REDIS_URL');
    const port = config.get(`GHCRAWLER_STORAGE_REDIS_PORT${role}`) || config.get('GHCRAWLER_STORAGE_REDIS_PORT') || config.get('GHCRAWLER_REDIS_PORT');
    const key = config.get(`GHCRAWLER_STORAGE_REDIS_ACCESS_KEY${role}`) || config.get('GHCRAWLER_STORAGE_REDIS_ACCESS_KEY') || config.get('GHCRAWLER_REDIS_ACCESS_KEY');

    const redisOptions = { auth_pass: key };
    redisOptions.tls = { servername: url };
    redisClients[role] = redis.createClient(port, url, redisOptions);
    return redisClients[role];
  }

  static getRedisClient() {
    const role = 'default';
    if (redisClients[role]) {
      return redisClients[role];
    }
    const url = config.get('GHCRAWLER_REDIS_URL');
    const port = config.get('GHCRAWLER_REDIS_PORT');
    const key = config.get('GHCRAWLER_REDIS_ACCESS_KEY');

    const redisOptions = { auth_pass: key };
    redisOptions.tls = { servername: url };
    redisClients[role] = redis.createClient(port, url, redisOptions);
    return redisClients[role];
  }

  static createBlobService(account, key) {
    const retryOperations = new AzureStorage.ExponentialRetryPolicyFilter();
    return AzureStorage.createBlobService(account, key).withFilter(retryOperations);
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
    const provider = options.provider || 'amqp10';
    if (provider === 'amqp10') {
      return OspoCrawler.createAmqp10Queues(options);
    } else if (provider === 'amqp') {
      return OspoCrawler.createAmqpQueues(options);
    } else {
      return OspoCrawler.createServiceBusQueues(options);
    }
  }

  static addEventQueue(queues, options) {
    if (options.events.weight) {
      options.weights.unshift(options.events.weight);
      queues.unshift(OspoCrawler.createEventQueue(options));
    }
    return queues;
  }

  static createServiceBusQueues(options) {
    const url = config.get('GHCRAWLER_SERVICEBUS_URL');
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:SB:${options.queueName}`, options);
    const immediate = OspoCrawler.createServiceBusQueue(url, 'immediate', tracker, options);
    const soon = OspoCrawler.createServiceBusQueue(url, 'soon', tracker, options);
    const normal = OspoCrawler.createServiceBusQueue(url, 'normal', tracker, options);
    const later = OspoCrawler.createServiceBusQueue(url, 'later', tracker, options);
    const deadletter = OspoCrawler.createServiceBusQueue(url, 'deadletter', tracker, options);
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createAmqpQueues(options) {
    const url = config.get('GHCRAWLER_AMQP_URL');
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:AMQP:${options.queueName}`, options);
    const immediate = OspoCrawler.createAmqpQueue(url, 'immediate', tracker, options);
    const soon = OspoCrawler.createAmqpQueue(url, 'soon', tracker, options);
    const normal = OspoCrawler.createAmqpQueue(url, 'normal', tracker, options);
    const later = OspoCrawler.createAmqpQueue(url, 'later', tracker, options);
    const deadletter = OspoCrawler.createAmqpQueue(url, 'deadletter', tracker, options);
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createAmqp10Queues(options) {
    const url = config.get('GHCRAWLER_AMQPS_URL');
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:AMQP10:${options.queueName}`, options);
    const immediate = OspoCrawler.createAmqp10Queue(url, 'immediate', tracker, options);
    const soon = OspoCrawler.createAmqp10Queue(url, 'soon', tracker, options);
    const normal = OspoCrawler.createAmqp10Queue(url, 'normal', tracker, options);
    const later = OspoCrawler.createAmqp10Queue(url, 'later', tracker, options);
    const deadletter = OspoCrawler.createAmqp10Queue(url, 'deadletter', tracker, options);
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createMemoryQueues(options) {
    const immediate = OspoCrawler.createMemoryQueue('immediate');
    const soon = OspoCrawler.createMemoryQueue('soon');
    const normal = OspoCrawler.createMemoryQueue('normal');
    const later = OspoCrawler.createMemoryQueue('later');
    const deadletter = OspoCrawler.createMemoryQueue('deadletter');
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createMemoryQueue(name) {
    return new InMemoryCrawlQueue(name);
  }

  static createServiceBusQueue(url, name, flagger, options) {
    const formatter = message => {
      return Request.adopt(JSON.parse(message.body));
    };
    return new ServiceBusCrawlQueue(url, name, formatter, flagger, options);
  }

  static createAmqpQueue(url, name, tracker, options) {
    const formatter = message => {
      return Request.adopt(JSON.parse(message));
    };
    const queue = new AmqpQueue(url, name, formatter, options);
    return new AttenuatedQueue(new TrackedQueue(queue, tracker, options), options);
  }

  static createAmqp10Queue(url, name, tracker, options) {
    const formatter = message => {
      return Request.adopt(message);
    };
    const queue = new Amqp10Queue(url, name, formatter, options);
    return new AttenuatedQueue(new TrackedQueue(queue, tracker, options), options);
  }

  static createEventQueue(options) {
    // Setup the event trigger mechanism to read off a service bus topic and format
    // the events as { type: type, qualifier: qualifier } if they are relevant
    const formatter = new EventFormatter(options);
    options.on('change', formatter.reconfigure.bind(formatter));

    const url = config.get('GHCRAWLER_EVENT_SERVICEBUS_URL');
    return new ServiceBusSubscription(url, 'events', options.events.topic, options.events.queueName, formatter.format.bind(formatter), null, options);
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

class EventFormatter {
  constructor(options) {
    this.options = options;
    this.repoEvents = new Set(options.events.repoEvents || ['commit_comment', 'create', 'delete', 'deployment', 'deployment_status', 'gollum', 'issue_comment', 'issues', 'label', 'milestone', 'page_build', 'public', 'pull_request', 'pull_request_review', 'pull_request_review_comment','push', 'release', 'repository', 'status', 'watch']);
    this.orgEvents = new Set(options.events.orgEvents || ['member', 'membership', 'organization', 'team', 'team_add']);
  }

  reconfigure(patches) {
    if (patches.some(patch => patch.path === '/events/repoEvents') || patches.some(patch => patch.path === '/events/orgEvents')) {
      this.repoEvents = new Set(options.events.repoEvents);
      this.orgEvents = new Set(options.events.orgEvents);
    }
    return Q();
  }

  format(message) {
    const type = message.customProperties.event;
    const event = JSON.parse(message.body);
    let request = null;
    if (this.repoEvents.has(type)) {
      request = new Request('update_events', event.repository.events_url, { qualifier: `urn:repo:${event.repository.id}` });
    } else if (this.orgEvents.has(type)) {
      request = new Request('update_events', event.organization.events_url, { qualifier: `urn:repo:${event.organization.id}` });
    }
    // TODO temporary debugging check to see what private events look like
    if (event.public === false)
      console.log('private event found');
    request._retryQueue = 'immediate';
    return request;
  }
}
