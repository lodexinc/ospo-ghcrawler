const azure = require('azure');
const promiseRetry = require('promise-retry');
const Q = require('q');
const qlimit = require('qlimit');

class ServiceBusCrawlQueue {
  constructor(url, name, topic, formatter, flagger, logger = null) {
    const retryOperations = new azure.ExponentialRetryPolicyFilter();
    this.serviceBusService = azure.createServiceBusService(url).withFilter(retryOperations);
    this.name = name;
    this.queueName = `${topic}-${name}`;
    this.messageFormatter = formatter;
    this.flagger = flagger;
    this.logger = logger;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(1)(request => {
      let timestamp = 0;
      // if we can get a flag for the request, then it is already in the queue.  otherwise, queue it up for processing
      return this.flagger.getFlag(request).then(value => timestamp = value).then(() => {
        if (timestamp) {
          return true;
        }
        const body = JSON.stringify(request);
        const deferred = Q.defer();
        const start = Date.now();
        this.serviceBusService.sendQueueMessage(this.queueName, body, error => {
          // console.log(`ServiceBus call took: ${Date.now() - start}`);
          if (error) {
            return deferred.reject(error);
          }
          this.flagger.setFlag(request).then(() => deferred.resolve(), () => deferred.resolve());
        });
        return deferred.promise;
      });
    })));
  }

  subscribe() {
    const deferred = Q.defer();
    this.serviceBusService.createQueueIfNotExists(this.queueName, error => {
      if (error) return deferred.reject(error);
      deferred.resolve();
    });
    return deferred.promise;
  }

  unsubscribe() {
    const deferred = Q.defer();
    this.serviceBusService.deleteQueue(this.queueName, error => {
      deferred.resolve(error);
    });
    return deferred.promise;
  }

  pop() {
    const deferred = Q.defer();
    const start = Date.now();
    this.serviceBusService.receiveQueueMessage(this.queueName, { isPeekLock: true }, (error, message) => {
      // console.log(`ServiceBus call took: ${Date.now() - start}`);
      if (error) {
        if (error === 'No messages to receive') {
          return deferred.resolve(null);
        } else {
          return deferred.reject(error);
        }
      }
      const request = this.messageFormatter(message);
      request._message = message;
      this.flagger.removeFlag(request).then(
        () => deferred.resolve(request),
        error => {
          // fail this pop if we cannot remove the flag. Abandon the popped message.
          return this.abandon(request).finally(() => { throw error; });
        });
    });
    return deferred.promise;
  }

  done(request) {
    if (request._message) {
      return Q();
    }
    // delete the message so a subsequent abandon or done does not retry the ack/nak
    const message = request._message;
    delete request._message;
    this._log(`ACKing: ${request.type} ${request.url}`);

    const deferred = Q.defer();
    this.serviceBusService.deleteMessage(message, error => {
      if (error) {
        this.logger.info(`Unable to delete request from queue: ${request.type} for ${request.url}`);
      }
      deferred.resolve();
    });
    return deferred.promise;
  }

  abandon(request) {
    if (request._message) {
      return Q();
    }
    // delete the message so a subsequent abandon or done does not retry the ack/nak
    const message = request._message;
    delete request._message;
    this._log(`NAKing: ${request.type} ${request.url}`);

    const deferred = Q.defer();
    this.serviceBusService.unlockMessage(message, error => {
      if (error) {
        this.logger.info(`Unable to delete request from queue: ${request.type} for ${request.url}`);
      }
      deferred.resolve();
    });
    return deferred.promise;
  }

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = ServiceBusCrawlQueue;