const azure = require('azure');
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
    return this._ensureTopic()
      .then(Q.denodeify(this.serviceBusService.sendTopicMessage.bind(this.serviceBusService))(this.topic, { body: body }));
  }

  subscribe() {
    //TODO    return this._ensureTopic()
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
    // TODO figure out the return value when nothing is on the queue
    return Q.denodeify(this.serviceBusService.receiveSubscriptionMessage.bind(this.serviceBusService))(this.topic, this.subscription, { isPeekLock: true }).then(this.messageFormatter);
  }

  done(crawlRequest) {
    if (crawlRequest._message) {
      return Q.denodeify(this.serviceBusService.deleteMessage.bind(this.serviceBusService))(crawlRequest._message);
    }
    return Q();
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