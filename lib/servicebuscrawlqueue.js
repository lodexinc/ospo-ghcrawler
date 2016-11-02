const azure = require('azure');

class ServiceBusCrawlQueue {
  constructor(url, topic, subscription) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.topic = topic;
    this.subscription = subscription;
  }

  push(type, url, callback) {
    const body = JSON.stringify({type: type, url: url});
    this._ensureTopic(error => {
      if (error) {
        return callback(error);
      }

      this.serviceBusService.sendTopicMessage(this.topic, { body: body }, error => {
        return callback(error);
      });
    });
  }

  pop(callback) {
    this._ensureSubscription(error => {
      if (error) {
        return callback(error);
      }

      return this.serviceBusService.receiveSubscriptionMessage(this.topic, this.subscription, { isPeekLock: true }, callback);
    });
  }

  done(message, callback) {
    this.serviceBusService.deleteMessage(message, callback);
  }

  _ensureTopic(callback) {
    if (this.topicExists) {
      return callback(null);
    }

    this.serviceBusService.createTopicIfNotExists(this.topic, error => {
      if (error) {
        return callback(error);
      }

      this.topicExists = true;
      return callback(null);
    });
  }

  _ensureSubscription(callback) {
    if (this.subscriptionExists) {
      return callback(null);
    }

    this.serviceBusService.getSubscription(this.topic, this.subscription, (error, subscription) => {
      if (!error && subscription) {
        this.subscriptionExists = true;
        return callback(null);
      };

      this.serviceBusService.createSubscription(this.topic, this.subscription, error => {
        if (error) {
          return callback(error);
        }

        this.subscriptionExists = true;
        return callback(null);
      });
    });
  }
}

module.exports = ServiceBusCrawlQueue;