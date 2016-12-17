const azure = require('azure');
const promiseRetry = require('promise-retry');
const Q = require('q');
const qlimit = require('qlimit');

class ServiceBusSubscription {
  constructor(url, topic, subscription, formatter, flagger, options) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.topic = topic;
    this.subscription = subscription;
    this.messageFormatter = formatter;
    this.flagger = flagger || { getFlag: () => { return Q(null); }, setFlag: () => { return Q(); }, removeFlag: () => { return Q(); } };
    this.options = options;
    this.logger = options.logger;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(1)(request => {
      let timestamp = 0;
      // if we can get a flag for the request, then it is already in the queue.  otherwise, queue it up for processing
      this.flagger.getFlag(request).then(value => timestamp = value).then(() => {
        if (timestamp) {
          return true;
        }
        const body = JSON.stringify(request);
        return this._retry(() => {
          return this._ensureTopic().then(
            Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body })).then(() => {
              return this.flagger.setFlag(request);
            });
        });
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
        const request = this.messageFormatter(message);
        request._message = message;
        return this.flagger.removeFlag(request).catch(error => {
          // fail this pop if we cannot remove the flag. Abandon the popped message.
          return this.abandon(request).finally(() => { throw error; });
        });
      });
    });
  }

  done(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._log(`ACKing: ${request.type} ${request.url}`);
      return this._retry(() => { return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(message); });
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._log(`NAKing: ${request.type} ${request.url}`);
      return this._retry(() => { return Q.denodeify(this.serviceBusService.unlockMessage.bind(this.serviceBusService))(message); });
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

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = ServiceBusCrawlQueue;