const azure = require('azure');
const Q = require('q');
const qlimit = require('qlimit');

class ServiceBusSubscription {
  constructor(url, name, topic, subscription, formatter, flagger, options) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.name = name;
    this.topic = topic;
    this.subscription = subscription;
    this.messageFormatter = formatter;
    this.flagger = flagger || { getFlag: () => { return Q(null); }, setFlag: request => { return Q(request); }, removeFlag: request => { return Q(request); } };
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
        return this._ensureTopic().then(
          Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body })).then(() => {
            return this.flagger.setFlag(request);
          });
      });
    })));
  }

  subscribe() {
    if (this.subscriptionExists) {
      return Q();
    }

    return this._ensureTopic().then(() => {
      return Q.denodeify(this.serviceBusService.getSubscription.bind(this.serviceBusService))(this.topic, this.subscription).then(
        () => this.subscriptionExists = true,
        error => { return Q.denodeify(this.serviceBusService.createSubscription.bind(this.serviceBusService))(this.topic, this.subscription); });
    });
  }

  unsubscribe() {
    return Q.denodeify(this.serviceBusService.deleteSubscription.bind(this.serviceBusService))(this.topic, this.subscription);
  }

  pop() {
    return Q.denodeify(this.serviceBusService.receiveSubscriptionMessage.bind(this.serviceBusService))(this.topic, this.subscription, { isPeekLock: true }).then(values => {
      const message = values[0];
      const request = this.messageFormatter(message);
      if (!request) {
        // if the formatter didn't find anything interesting, complete the message.
        // TODO should we remove the flag.  We don't have a url and since this one was ignored, it'so
        // probably ok to ignore all others that are the same.  That assumes somethings about the formatter
        // that may change over time...
        this.done({ type: 'ignored_request', _message: message });
        return null;
      }
      request._message = message;
      return this.flagger.removeFlag(request).catch(error => {
        // fail this pop if we cannot remove the flag. Abandon the popped message.
        return this.abandon(request).finally(() => { throw error; });
      });
    });
  }

  done(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._log(`ACKing: ${request.type} ${request.url}`);
      return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(message).catch(error => {
        // if the error is a 404, this is a stale lock or some such.  Eat the error.  Otherwise, rethrow
        if (error.code === '404') {
          return request;
        }
        throw error;
      });
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._log(`NAKing: ${request.type} ${request.url}`);
      return Q.denodeify(this.serviceBusService.unlockMessage.bind(this.serviceBusService))(message).catch(error => {
        // if the error is the STRING '404', this is a stale lock or some such.  Eat the error.  Otherwise, rethrow
        if (error.code === '404') {
          return request;
        }
        throw error;
      });
    }
    return Q();
  }

  getName() {
    return this.name;
  }

  _ensureTopic() {
    if (this.topicExists) {
      return Q();
    }

    return Q.denodeify(this.serviceBusService.createTopicIfNotExists.bind(this.serviceBusService))(this.topic).then(() => {
      this.topicExists = true;
    });
  }

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = ServiceBusSubscription;