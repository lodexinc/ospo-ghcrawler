// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const aiLogger = require('winston-azure-application-insights').AzureApplicationInsightsLogger;
const amqp10 = require('amqp10');
const Amqp10Queue = require('./amqp10Queue');
const AmqpQueue = require('./amqpQueue');
const appInsights = require('applicationinsights');
const AzureStorage = require('azure-storage');
const AttenuatedQueue = require('./attenuatedQueue');
const AzureStorageDocStore = require('./storageDocStore');
const ComputeLimiter = require('./computeLimiter');
const config = require('painless-config');
const Crawler = require('ghcrawler').crawler;
const CrawlerService = require('ghcrawler').crawlerService;
const fs = require('fs');
const GitHubFetcher = require('ghcrawler').githubFetcher;
const GitHubProcessor = require('ghcrawler').githubProcessor;
const InMemoryCrawlQueue = require('./inmemorycrawlqueue');
const InMemoryDocStore = require('./inmemoryDocStore');
const InMemoryRateLimiter = require('./inmemoryRateLimiter');
const ip = require('ip');
const LimitedTokenFactory = require('./limitedTokenFactory');
const LoggingStore = require('./loggingStore');
const mockInsights = require('./mockInsights');
const MongoDocStore = require('./mongodocstore');
const policy = require('ghcrawler').policy;
const Q = require('q');
const QueueSet = require('ghcrawler').queueSet;
const RabbitQueueManager = require('./rabbitQueueManager');
const RateLimitedPushQueue = require('./ratelimitedPushQueue');
const redis = require('redis');
const RedisRequestTracker = require('./redisRequestTracker');
const RedisMetrics = require('redis-metrics');
const RedisRateLimiter = require('redis-rate-limiter');
const redlock = require('redlock');
const RefreshingConfig = require('refreshing-config');
const RefreshingConfigRedis = require('refreshing-config-redis');
const request = require('request');
const Request = require('ghcrawler').request;
const requestor = require('ghrequestor');
const ServiceBusQueueManager = require('./serviceBusQueueManager');
const TokenFactory = require('./tokenFactory');
const TrackedQueue = require('./trackedQueue');
const UrlToUrnMappingStore = require('./urlToUrnMappingStore');
const winston = require('winston');

const AmqpClient = amqp10.Client;
const AmqpPolicy = amqp10.Policy;

let factoryLogger;
let redisClient = null;

class OspoCrawler {

  static getDefaultOptions() {
    return {
      crawler: {
        name: config.get('CRAWLER_NAME') || 'crawler',
        count: 0,
        pollingDelay: 5000,
        processingTtl: 60 * 1000,
        promiseTrace: false,
        orgList: OspoCrawler.loadOrgs()
      },
      fetcher: {
        tokenLowerBound: 50,
        metricsStore: 'redis',
        callCapStore: 'memory',
        callCapWindow: 1,       // seconds
        callCapLimit: 30,       // calls
        computeLimitStore: 'memory',
        computeWindow: 15,      // seconds
        computeLimit: 15000,    // milliseconds
        baselineFrequency: 60,  // seconds
        deferDelay: 500
      },
      queuing: {
        provider: config.get('CRAWLER_QUEUE_PROVIDER') || 'amqp10',
        queueName: config.get('CRAWLER_QUEUE_PREFIX') || 'crawler',
        credit: 100,
        weights: { events: 10, immediate: 3, soon: 2, normal: 3, later: 2 },
        messageSize: 240,
        parallelPush: 10,
        pushRateLimit: 200,
        metricsStore: 'redis',
        events: {
          provider: config.get('CRAWLER_EVENT_PROVIDER') || 'amqp10',
          topic: config.get('CRAWLER_EVENT_TOPIC_NAME') || 'crawler',
          queueName: config.get('CRAWLER_EVENT_QUEUE_NAME') || 'crawler'
        },
        attenuation: {
          ttl: 3000
        },
        tracker: {
          // driftFactor: 0.01,
          // retryCount: 3,
          // retryDelay: 200,
          // locking: true,
          // lockTtl: 1000,
          ttl: 60 * 60 * 1000
        }
      },
      storage: {
        ttl: 3 * 1000,
        provider: config.get('CRAWLER_STORE_PROVIDER') || 'azure',
        delta: {
          provider: config.get('CRAWLER_DELTA_PROVIDER')
        }
      },
      locker: {
        provider: 'redis',
        retryCount: 3,
        retryDelay: 200
      }
    };
  }

  static createService(name) {
    if (!factoryLogger) {
      factoryLogger = OspoCrawler.createLogger(true);
    }
    factoryLogger.info('appInitStart');
    const crawlerName = config.get('CRAWLER_NAME') || 'crawler';
    const optionsProvider = config.get('CRAWLER_OPTIONS_PROVIDER') || 'memory';
    const subsystemNames = ['crawler', 'fetcher', 'queuing', 'storage', 'locker'];
    const crawlerPromise = OspoCrawler.createRefreshingOptions(crawlerName, subsystemNames, optionsProvider).then(options => {
      factoryLogger.info(`creating refreshingOption completed`);
      name = name || 'InMemory';
      factoryLogger.info(`begin create crawler of type ${name}`);
      const crawler = OspoCrawler[`create${name}Crawler`](options);
      return [crawler, options];
    });
    return new CrawlerService(crawlerPromise);
  }

  static createStandardCrawler(options) {
    factoryLogger.info(`creating standard Crawler Started`);
    return OspoCrawler.createCrawler(options);
  }

  static createInMemoryCrawler(options) {
    OspoCrawler._configureInMemoryOptions(options);
    return OspoCrawler.createCrawler(options);
  }

  static _configureInMemoryOptions(options) {
    factoryLogger.info(`create in memory options`);
    options.crawler.count = 1;
    options.fetcher.computeLimitStore = 'memory';
    options.fetcher.metricsStore = null;
    delete options.queuing.events.provider;
    options.queuing.provider = 'memory';
    options.queuing.metricsStore = null;
    options.locker.provider = 'memory';
    options.storage.provider = 'memory';
  }

  static _decorateOptions(options) {
    Object.getOwnPropertyNames(options).forEach(key => {
      const logger = OspoCrawler.createLogger(true);
      options[key].logger = logger;
      const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
      const metricsFactory = OspoCrawler[`create${capitalized}Metrics`];
      if (metricsFactory) {
        factoryLogger.info('Creating metrics factory', { factory: capitalized });
        logger.metrics = metricsFactory(options.crawler.name, options[key]);
      }
    });
  }

  static createCrawler(options, { queues = null, store = null, locker = null, fetcher = null, processor = null } = {}) {
    OspoCrawler._decorateOptions(options);
    queues = queues || OspoCrawler.createQueues(options.queuing);
    store = store || OspoCrawler.createStore(options.storage);
    locker = locker || OspoCrawler.createLocker(options.locker);
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

  static createRefreshingOptions(crawlerName, subsystemNames, provider = 'redis') {
    factoryLogger.info(`creating refreshing options with crawlerName:${crawlerName}`);
    const result = {};
    provider = provider.toLowerCase();
    return Q.all(subsystemNames.map(subsystemName => {
      factoryLogger.info(`creating refreshing options promise with crawlerName:${crawlerName} subsystemName ${subsystemName} provider ${provider}`);
      let config = null;
      if (provider === 'redis') {
        config = OspoCrawler.createRedisRefreshingConfig(crawlerName, subsystemName);
      } else if (provider === 'memory') {
        config = OspoCrawler.createInMemoryRefreshingConfig();
      } else {
        throw new Error(`Invalid options provider setting ${provider}`);
      }
      return config.getAll().then(values => {
        factoryLogger.info(`creating refreshingOption config get completed`);
        const defaults = OspoCrawler.getDefaultOptions();
        return OspoCrawler.initializeSubsystemOptions(values, defaults[subsystemName]).then(resolved => {
          factoryLogger.info(`subsystem options initialized`);
          result[subsystemName] = values;
        });
      });
    })).then(() => { return result; });
  }

  static initializeSubsystemOptions(config, defaults) {
    if (Object.getOwnPropertyNames(config).length > 1) {
      return Q(config);
    }
    return Q.all(Object.getOwnPropertyNames(defaults).map(optionName => {
      return config._config.set(optionName, defaults[optionName]);
    })).then(() => { return config._config.getAll(); });
  }

  static createRedisRefreshingConfig(crawlerName, subsystemName) {
    factoryLogger.info('Create refreshing redis config', { crawlerName: crawlerName, subsystemName: subsystemName });
    const redisClient = OspoCrawler.getRedisClient(OspoCrawler.createLogger(true));
    const key = `${crawlerName}:options:${subsystemName}`;
    const channel = `${key}-channel`;
    const configStore = new RefreshingConfigRedis.RedisConfigStore(redisClient, key);
    const config = new RefreshingConfig.RefreshingConfig(configStore)
      .withExtension(new RefreshingConfigRedis.RedisPubSubRefreshPolicyAndChangePublisher(redisClient, channel));
    return config;
  }

  static createInMemoryRefreshingConfig(values = {}) {
    factoryLogger.info('create in memory refreshing config');
    const configStore = new RefreshingConfig.InMemoryConfigStore(values);
    const config = new RefreshingConfig.RefreshingConfig(configStore)
      .withExtension(new RefreshingConfig.InMemoryPubSubRefreshPolicyAndChangePublisher());
    return config;
  }

  static createGitHubFetcher(store, options) {
    factoryLogger.info('create github fetcher');
    const requestor = OspoCrawler.createRequestor();
    const tokenFactory = OspoCrawler.createTokenFactory(options);
    const limiter = OspoCrawler.createComputeLimiter(options);
    return new GitHubFetcher(requestor, store, tokenFactory, limiter, options);
  }

  static createTokenFactory(options) {
    factoryLogger.info('create token factory');
    const factory = new TokenFactory(config.get('CRAWLER_GITHUB_TOKENS'), options);
    const limiter = OspoCrawler.createTokenLimiter(options);
    return new LimitedTokenFactory(factory, limiter, options);
  }

  static createRequestor() {
    factoryLogger.info('create requestor');
    return requestor.defaults({
      // turn off the requestor's throttle management mechanism in favor of ours
      forbiddenDelay: 0,
      delayOnThrottle: false
    });
  }

  static createFetcherMetrics(crawlerName, options) {
    factoryLogger.info('create fetcher metrics', { metricsStore: options.metricsStore });
    if (options.metricsStore !== 'redis') {
      return null;
    }
    const metrics = new RedisMetrics({ client: OspoCrawler.getRedisClient(options.logger) });
    const names = ['fetch'];
    const result = {};
    names.forEach(name => {
      const fullName = `${crawlerName}:github:${name}`;
      result[name] = metrics.counter(fullName, { timeGranularity: 'second', namespace: 'crawlermetrics' }); // Stored in Redis as {namespace}:{name}:{period}
    });
    return result;
  }

  static createTokenLimiter(options) {
    factoryLogger.info('create token limiter', { capStore: options.capStore });
    return options.capStore === 'redis'
      ? OspoCrawler.createRedisTokenLimiter(getRedisClient(options.logger), options)
      : OspoCrawler.createInMemoryTokenLimiter(options);
  }

  static createRedisTokenLimiter(redisClient, options) {
    factoryLogger.info('create redis token limiter', { callCapWindow: options.callCapWindow, callCapLimit: options.callCapLimit });
    const ip = '';
    return RedisRateLimiter.create({
      redis: redisClient,
      key: request => `${ip}:token:${request.key}`,
      window: () => options.callCapWindow || 1,
      limit: () => options.callCapLimit
    });
  }

  static createInMemoryTokenLimiter(options) {
    factoryLogger.info('create in memory token limiter', { callCapWindow: options.callCapWindow, callCapLimit: options.callCapLimit });
    return InMemoryRateLimiter.create({
      key: request => 'token:' + request.key,
      window: () => options.callCapWindow || 1,
      limit: () => options.callCapLimit
    });
  }

  static createComputeLimiter(options) {
    factoryLogger.info('create compute limiter', { computeLimitStore: options.computeLimitStore });
    const limiter = options.computeLimitStore === 'redis'
      ? OspoCrawler.createRedisComputeLimiter(OspoCrawler.getRedisClient(options.logger), options)
      : OspoCrawler.createInMemoryComputeLimiter(options);
    options.baselineUpdater = OspoCrawler._networkBaselineUpdater.bind(null, options.logger);
    return new ComputeLimiter(limiter, options);
  }

  static _networkBaselineUpdater(logger) {
    return Q.allSettled([0, 1, 2, 3].map(number => {
      return Q.delay(number * 50).then(() => {
        const deferred = Q.defer();
        request({
          url: 'https://api.github.com/rate_limit',
          headers: {
            'User-Agent': 'ghrequestor'
          },
          time: true
        }, (error, response, body) => {
          if (error) {
            return deferred.reject(error);
          }
          deferred.resolve(response.elapsedTime);
        });
        return deferred.promise;
      });
    })).then(times => {
      let total = 0;
      let count = 0;
      for (let index in times) {
        if (times[index].state === 'fulfilled') {
          total += times[index].value;
          count++;
        }
      }
      const result = Math.floor(total / count);
      logger.info(`New GitHub request baseline: ${result}`);
      return result;
    });
  }

  static createRedisComputeLimiter(redisClient, options) {
    const address = ip.address().toString();
    factoryLogger.info('create redis compute limiter', { address: address, computeWindow: options.computeWindow, computeLimit: options.computeLimit });
    return RedisRateLimiter.create({
      redis: redisClient,
      key: request => `${address}:compute:${request.key}`,
      incr: request => request.amount,
      window: () => options.computeWindow || 15,
      limit: () => options.computeLimit || 15000
    });
  }

  static createInMemoryComputeLimiter(options) {
    factoryLogger.info('create in memory compute limiter', { computeWindow: options.computeWindow, computeLimit: options.computeLimit });
    return InMemoryRateLimiter.create({
      key: request => 'compute:' + request.key,
      incr: request => request.amount,
      window: () => options.computeWindow || 15,
      limit: () => options.computeLimit || 15000
    });
  }

  static createStore(options) {
    const provider = options.provider || 'azure';
    factoryLogger.info(`Create store for provider ${options.provider}`);
    let store = null;
    switch (options.provider) {
      case 'azure': {
        store = OspoCrawler.createRedisAndStorageStore(options);
        break;
      }
      case 'mongo': {
        store = OspoCrawler.createMongoStore(options);
        break;
      }
      case 'memory': {
        store = new InMemoryDocStore(true);
        break;
      }
      default: throw new Error(`Invalid store provider: ${provider}`);
    }
    store = OspoCrawler.createDeltaStore(store, options);
    return store;
  }

  static createMongoStore(options) {
    return new MongoDocStore(config.get('CRAWLER_MONGO_URL'), options);
  }

  static createRedisAndStorageStore(options, name = null) {
    factoryLogger.info(`creating azure store`, { name: name });
    const baseStore = OspoCrawler.createAzureStorageStore(options, name);
    return new UrlToUrnMappingStore(baseStore, OspoCrawler.getRedisClient(options.logger), baseStore.name, options);
  }

  static createAzureStorageStore(options, name = null) {
    factoryLogger.info(`creating azure storage store`);
    name = name || config.get('CRAWLER_STORAGE_NAME');
    const account = config.get('CRAWLER_STORAGE_ACCOUNT');
    const key = config.get('CRAWLER_STORAGE_KEY');
    const blobService = OspoCrawler.createBlobService(account, key);
    return new AzureStorageDocStore(blobService, name, options);
  }

  static createDeltaStore(inner, options) {
    if (!options.delta || !options.delta.provider) {
      return inner;
    }
    factoryLogger.info(`creating delta store`);
    switch (options.delta.provider) {
      case 'azure': {
        return OspoCrawler.createAzureDeltaStore(inner, null, options);
      }
      default: throw new Error(`Invalid delta store provider: ${options.delta.provider}`);
    }
    return store;
  }

  static createAzureDeltaStore(inner, name = null, options = {}) {
    name = name || config.get('CRAWLER_DELTA_STORAGE_NAME') || `${config.get('CRAWLER_STORAGE_NAME')}-log`;
    const account = config.get('CRAWLER_DELTA_STORAGE_ACCOUNT') || config.get('CRAWLER_STORAGE_ACCOUNT');
    const key = config.get('CRAWLER_DELTA_STORAGE_KEY') || config.get('CRAWLER_STORAGE_KEY');
    factoryLogger.info('creating delta store', { name: name, account: account });
    const blobService = OspoCrawler.createBlobService(account, key);
    return new LoggingStore(inner, blobService, name, options);
  }

  static getRedisClient(logger) {
    factoryLogger.info('retrieving redis client');
    if (redisClient) {
      return redisClient;
    }
    const url = config.get('CRAWLER_REDIS_URL');
    const port = config.get('CRAWLER_REDIS_PORT');
    const key = config.get('CRAWLER_REDIS_ACCESS_KEY');
    const tls = config.get('CRAWLER_REDIS_TLS') === 'true';
    redisClient = OspoCrawler.createRedisClient(url, key, port, tls, logger);
    return redisClient;
  }

  static createRedisClient(url, key, port, tls, logger) {
    factoryLogger.info(`creating redis client`, { url: url, port: port, tls: tls });
    const options = {};
    if (key) {
      options.auth_pass = key;
    }
    if (tls) {
      options.tls = {
        servername: url
      };
    }
    const redisClient = redis.createClient(port, url, options);
    redisClient.on('error', error => logger.info(`Redis client error: ${error}`));
    redisClient.on('reconnecting', properties => logger.info(`Redis client reconnecting: ${JSON.stringify(properties)}`));
    setInterval(() => {
      redisClient.ping(err => {
        if (err) {
          logger.info(`Redis client ping failure: ${err}`);
        }
      });
    }, 60 * 1000);
    return redisClient;
  }

  static createBlobService(account, key) {
    factoryLogger.info(`creating blob service`);
    const retryOperations = new AzureStorage.ExponentialRetryPolicyFilter();
    return AzureStorage.createBlobService(account, key).withFilter(retryOperations);
  }

  static createLocker(options) {
    factoryLogger.info(`creating locker`, { provider: options.provider });
    if (options.provider === 'memory') {
      return OspoCrawler.createNolock();
    }
    return new redlock([OspoCrawler.getRedisClient(options.logger)], {
      driftFactor: 0.01,
      retryCount: options.retryCount,
      retryDelay: options.retryDelay
    });
  }

  static createLogger(echo = false, level = 'info') {
    mockInsights.setup(config.get('CRAWLER_INSIGHTS_KEY') || 'mock', echo);
    const result = new winston.Logger();
    result.add(aiLogger, {
      insights: appInsights,
      treatErrorsAsExceptions: true,
      exitOnError: false,
      level: level
    });
    // winston.remove(winston.transports.Console);
    return result;
  }

  static createRequestTracker(prefix, options) {
    let locker = null;
    if (options.tracker.locking) {
      locker = new redlock([OspoCrawler.getRedisClient(options.logger)], options.tracker);
    } else {
      locker = OspoCrawler.createNolock();
    }
    return new RedisRequestTracker(prefix, OspoCrawler.getRedisClient(options.logger), locker, options);
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
    } else if (provider === 'memory') {
      return OspoCrawler.createMemoryQueues(options);
    } else {
      throw new Error(`Invalid queue provider option: ${provider}`);
    }
  }

  static createAmqpQueues(options) {
    const managementEndpoint = config.get('CRAWLER_RABBIT_MANAGER_ENDPOINT');
    const url = config.get('CRAWLER_AMQP_URL');
    const manager = new RabbitQueueManager(url, managementEndpoint);
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:AMQP:${options.queueName}`, options);
    const immediate = OspoCrawler.createAmqpQueue(manager, 'immediate', tracker, options);
    const soon = OspoCrawler.createAmqpQueue(manager, 'soon', tracker, options);
    const normal = OspoCrawler.createAmqpQueue(manager, 'normal', tracker, options);
    const later = OspoCrawler.createAmqpQueue(manager, 'later', tracker, options);
    const deadletter = OspoCrawler.createAmqpQueue(manager, 'deadletter', tracker, options);
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createAmqp10Queues(options) {
    const managementEndpoint = config.get('CRAWLER_SERVICEBUS_MANAGER_ENDPOINT');
    const amqpUrl = config.get('CRAWLER_AMQP10_URL');
    const manager = new ServiceBusQueueManager(amqpUrl, managementEndpoint);
    const env = process.env.NODE_ENV;
    const tracker = OspoCrawler.createRequestTracker(`${env}:AMQP10:${options.queueName}`, options);
    const immediate = OspoCrawler.createAmqp10Queue(manager, 'immediate', tracker, options);
    const soon = OspoCrawler.createAmqp10Queue(manager, 'soon', tracker, options);
    const normal = OspoCrawler.createAmqp10Queue(manager, 'normal', tracker, options);
    const later = OspoCrawler.createAmqp10Queue(manager, 'later', tracker, options);
    const deadletter = OspoCrawler.createAmqp10Queue(manager, 'deadletter', tracker, options, { receive: 'onDemand', send: 'send' });
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createMemoryQueues(options) {
    const immediate = OspoCrawler.createMemoryQueue('immediate', options);
    const soon = OspoCrawler.createMemoryQueue('soon', options);
    const normal = OspoCrawler.createMemoryQueue('normal', options);
    const later = OspoCrawler.createMemoryQueue('later', options);
    const deadletter = OspoCrawler.createMemoryQueue('deadletter', options);
    const queues = OspoCrawler.addEventQueue([immediate, soon, normal, later], options);
    return new QueueSet(queues, deadletter, options);
  }

  static createMemoryQueue(name, options) {
    return new AttenuatedQueue(new InMemoryCrawlQueue(name, options), options);
  }

  static createAmqpQueue(manager, name, tracker, options) {
    const formatter = message => {
      return Request.adopt(JSON.parse(message));
    };
    const queue = new AmqpQueue(manager, name, formatter, options);
    return new AttenuatedQueue(new TrackedQueue(queue, tracker, options), options);
  }

  static createAmqp10Queue(manager, name, tracker, options, mode = { receive: 'receive', send: 'send' }) {
    const formatter = message => {
      // make sure the message/request object is copied to enable deferral scenarios (i.e., the request is modified
      // and then put back on the in-memory queue)
      return Request.adopt(Object.assign({}, message.body));
    };
    let queue = manager.createQueueClient(name, formatter, options);
    queue.mode = mode;
    if (tracker) {
      queue = new TrackedQueue(queue, tracker, options);
    }
    if (options.pushRateLimit) {
      const limiter = InMemoryRateLimiter.create({
        key: () => 'queue:' + name,
        window: () => options.pushRateWindow || 2,
        limit: () => options.pushRateLimit || 300
      });

      queue = new RateLimitedPushQueue(queue, limiter, options);
    }
    return new AttenuatedQueue(queue, options);
  }

  static addEventQueue(queues, options) {
    if (options.events.provider && options.events.provider !== 'none') {
      queues.unshift(OspoCrawler.createEventQueue(options));
    }
    return queues;
  }

  static createEventQueue(options) {
    if (options.events.provider === 'amqp10') {
      return OspoCrawler.createAmqp10EventSubscription(options);
    }
    throw new Error(`No event provider for ${options.events.provider}`);
  }

  static createAmqp10EventSubscription(options) {
    const amqpUrl = config.get('CRAWLER_EVENT_AMQP10_URL');
    const actualClient = new AmqpClient(AmqpPolicy.ServiceBusQueue);
    const client = actualClient.connect(amqpUrl).then(() => { return actualClient; });
    const formatter = new EventFormatter(options);
    options._config.on('change', formatter.reconfigure.bind(formatter));
    const queueName = `${options.events.topic}/Subscriptions/${options.events.queueName}`;
    const result = new Amqp10Queue(client, 'events', queueName, formatter.format.bind(formatter), null, options);
    result.mode = { receive: 'receive' };
    return result;
  }

  static createQueuingMetrics(crawlerName, options) {
    if (options.metricsStore !== 'redis') {
      return null;
    }
    const metrics = new RedisMetrics({ client: OspoCrawler.getRedisClient(options.logger) });
    const queueNames = ['immediate', 'soon', 'normal', 'later', 'deadletter', 'events'];
    const operations = ['push', 'repush', 'done', 'abandon'];
    const queuesMetrics = {};
    const queueNamePrefix = options.queueName;
    queueNames.forEach(queueName => {
      queuesMetrics[queueName] = {};
      operations.forEach(operation => {
        const name = `${queueNamePrefix}:${queueName}:${operation}`;
        queuesMetrics[queueName][operation] = metrics.counter(name, { timeGranularity: 'second', namespace: 'crawlermetrics' }); // Stored in Redis as {namespace}:{name}:{period}
      });
    });
    return queuesMetrics;
  }

  static loadOrgs() {
    let orgList = config.get('CRAWLER_ORGS');
    if (orgList) {
      orgList = orgList.split(';').map(entry => entry.toLowerCase().trim());
    } else {
      orgList = OspoCrawler._loadLines(config.get('CRAWLER_ORGS_FILE'));
    }
    return orgList;
  }

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
    this.logger = options.logger;
    this.repoEvents = new Set(options.events.repoEvents || ['commit_comment', 'create', 'delete', 'deployment', 'deployment_status', 'gollum', 'issue_comment', 'issues', 'label', 'milestone', 'page_build', 'public', 'pull_request', 'pull_request_review', 'pull_request_review_comment', 'push', 'release', 'repository', 'status', 'watch']);
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
    // const type = message.customProperties.event;
    // const event = JSON.parse(message.body);
    const type = message.applicationProperties.event;
    const event = message.body;
    let request = null;
    if (this.repoEvents.has(type)) {
      request = new Request('event_trigger', event.repository.events_url, { qualifier: `urn:repo:${event.repository.id}` });
    } else if (this.orgEvents.has(type)) {
      request = new Request('event_trigger', event.organization.events_url, { qualifier: `urn:repo:${event.organization.id}` });
    } else {
      this.logger.info('Ignored  ', 'Unknown event type', { type: type });
    }
    // if we found something interesting, tweak the request to reflect the event
    if (request) {
      // if the event is for a private repo, mark the request as needing private access.
      if (event.repository && event.repository.private) {
        request.context.repoType = 'private';
      }
      // mark it to be retried on the immediate queue as we don't want to requeue it on this shared topic
      request._retryQueue = 'immediate';
      // Add a payload mostly to ensure the request's url is not fetched.
      request.payload = { body: { type: type }, etag: 1 };
      // requests off directly off the event feed do not need exclusivity
      request.requiresLock = false;
    }
    return request;
  }
}
