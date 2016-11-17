const azure = require('azure');
const promiseRetry = require('promise-retry');
const Q = require('q');
const qlimit = require('qlimit');

class ServiceBusCrawlQueue {
  constructor(url, topic, subscription, formatter) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.topic = topic;
    this.subscription = subscription;
    this.messageFormatter = formatter;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(1)(request => {
      const body = JSON.stringify(request);
      return this._retry(() => {
        return this._ensureTopic().then(Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body }));
      });
    })));
  }

  subscribe() {
    if (this.subscriptionExists) {
      return Q();
    }

    return this._retry(() => {
      return this._ensureTopic().then(() => {
        return Q.denodeify(this.serviceBusService.getSubscription.bind(this.serviceBusService))(this.topic, this.subscription).then(
          () => this.subscriptionExists = true,
          error => { return Q.denodeify(this.serviceBusService.createSubscription.bind(this.serviceBusService))(this.topic, this.subscription); });
      });
    });
  }

  unsubscribe() {
    return Q.denodeify(this.serviceBusService.deleteSubscription.bind(this.serviceBusService))(this.topic, this.subscription);
  }

  pop() {
    return this._retry(() => {
      return Q.denodeify(this.serviceBusService.receiveSubscriptionMessage.bind(this.serviceBusService))(this.topic, this.subscription, { isPeekLock: true }).then(values => {
        const message = values[0];
        const result = this.messageFormatter(message);
        result._message = message;
        return result;
      });
    });
  }

  done(request) {
    if (request._message) {
      return this._retry(() => { return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(request._message); });
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      return this._retry(() => { return Q.denodeify(this.serviceBusService.unlockMessage.bind(this.serviceBusService))(request._message); });
    }
    return Q();
  }

  _ensureTopic() {
    if (this.topicExists) {
      return Q();
    }

    return this._retry(() => {
      return Q.denodeify(this.serviceBusService.createTopicIfNotExists.bind(this.serviceBusService))(this.topic).then(() => {
        this.topicExists = true;
      });
    });
  }

  _retry(fn) {
    const start = Date.now();
    return Q(promiseRetry((retry, number) => {
      return Q.try(fn).catch(err => {
        if (err !== 'No messages to receive') {
          console.log(`Retrying ServiceBus call: ${Date.now() - start}`);
          retry();
        }
      });
    }))
      .finally(() => console.log(`ServiceBus call took: ${Date.now() - start}`));
  }
}

module.exports = ServiceBusCrawlQueue;