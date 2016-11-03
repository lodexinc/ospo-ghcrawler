const azure = require('azure');
const Q = require('q');

class ServiceBusCrawlQueue {
  constructor(url, topic, subscription) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.topic = topic;
    this.subscription = subscription;
  }

  push(type, url, context) {
    const body = JSON.stringify({type: type, url: url, context: context});
    return this._ensureTopic()
      .then(Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body }));
  }

  subscribe() {
    if (this.subscriptionExists) {
      return Q.resolve();
    }

    return Q.denodeify(this.serviceBusService.getSubscription.bind(this.serviceBusService))(this.topic, this.subscription)
      .catch(error => {
        return Q.denodeify(this.serviceBusService.createSubscription.bind(this.serviceBusService))(this.topic, this.subscription);
      })
      .then(() => {
        this.subscriptionExists = true;
      });
  }

  pop() {
    return Q.denodeify(this.serviceBusService.receiveSubscriptionMessage.bind(this.serviceBusService))(this.topic, this.subscription, { isPeekLock: true }).then(values => {
      const message = values[0];
      const crawlRequest = JSON.parse(message.body);
      crawlRequest.message = message;
      return body;
    });
  }

  done(crawlRequest) {
    return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(crawlRequest.message)
      .catch();
  }

  _ensureTopic() {
    if (this.topicExists) {
      return Q.resolve();
    }

    return Q.denodeify(this.serviceBusService.createTopicIfNotExists.bind(this.serviceBusService))(this.topic).then(() => {
      this.topicExists = true;
    });
  }
}

module.exports = ServiceBusCrawlQueue;