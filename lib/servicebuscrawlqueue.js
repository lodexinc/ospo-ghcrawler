const azure = require('azure');
const promiseRetry = require('promise-retry');
const Q = require('q');

class ServiceBusCrawlQueue {
  constructor(url, topic, subscription, formatter) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.topic = topic;
    this.subscription = subscription;
    this.messageFormatter = formatter;
  }

  push(request) {
    const body = JSON.stringify(request);
    return this._retry(() => {
      return this._ensureTopic()
        .then(() => { return Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body }) })
    });
  }

  subscribe() {
    if (this.subscriptionExists) {
      return Q.resolve();
    }

    return this._retry(() => {
      return this._ensureTopic().then(() => {
        return Q.denodeify(this.serviceBusService.getSubscription.bind(this.serviceBusService))(this.topic, this.subscription)
          .catch(error => {
            return Q.denodeify(this.serviceBusService.createSubscription.bind(this.serviceBusService))(this.topic, this.subscription);
          })
          .then(() => {
            this.subscriptionExists = true;
          })
      })
    });
  }

  pop() {
    return this._retry(() => { return Q.denodeify(this.serviceBusService.receiveSubscriptionMessage.bind(this.serviceBusService))(this.topic, this.subscription, { isPeekLock: true }).then(this.messageFormatter) });
  }

  done(request) {
    if (request._message) {
      return this._retry(() => { return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(request._message) });
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      return this._retry(() => { return Q.denodeify(this.serviceBusService.unlockMessage.bind(this.serviceBusService))(request._message) });
    }
    return Q();
  }

  _ensureTopic() {
    if (this.topicExists) {
      return Q.resolve();
    }

    return this._retry(() => {
      return Q.denodeify(this.serviceBusService.createTopicIfNotExists.bind(this.serviceBusService))(this.topic).then(() => {
        this.topicExists = true;
      })
    });
  }

  _retry(fn) {
    return Q(promiseRetry((retry, number) => {
      return fn().catch(err => {
        if (err !== 'No messages to receive') {
          retry();
        }
      });
    }));
  }
}

module.exports = ServiceBusCrawlQueue;