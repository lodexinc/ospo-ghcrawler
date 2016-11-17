const amqp = require('amqplib');
const Q = require('q');
const qlimit = require('qlimit');
const redis = require('redis');

class AmqpQueue {
  constructor(url, queueName, formatter, redisClient, logger = null) {
    this.url = url;
    this.messageFormatter = formatter;
    this.queueName = queueName;
    this.messageFormatter = formatter;
    this.connection = null;
    this.channel = null;
    this.redisClient = redisClient;
    this.logger = logger;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(10)(request => {
      this._hasCacheTag(request).then(alreadyQueued => {
        if (alreadyQueued) {
          this._log(`Request is already in the queue: ${request.type} ${request.url}`);
          return true;
        }
        const body = JSON.stringify(request);
        const deferred = Q.defer();
        this.channel.sendToQueue(this.queueName, new Buffer(body), {}, (err, ok) => {
          if (err) {
            deferred.reject(`Unable to queue ${request.type} for ${request.url}`);
          } else {
            this._setCacheTag(request).then(() => {
              this._log(`Pushed and Tagged request: ${request.type} ${request.url}`);
              deferred.resolve('tagged');
            });
          }
        });
        return deferred.promise;
      });
    })));
  }

  subscribe() {
    if (this.connection && this.channel) {
      return Q();
    }

    return amqp.connect(this.url).then(connection => {
      this.connection = connection;
      process.once('SIGINT', function () { connection.close(); });
      return connection.createConfirmChannel().then(channel => {
        this.channel = channel;
        return channel.assertQueue(this.queueName, { durable: true });
      });
    });
  }

  unsubscribe() {
    return Q();
  }

  pop() {
    return this.channel.get(this.queueName).then(response => {
      if (!response) {
        return null;
      }
      const message = new Buffer(response.content).toString();
      const request = this.messageFormatter(message);
      request._message = response;
      return this._removeCacheTag(request).then(() => {
        this._log(`Removed queue tag: ${request.type} ${request.url}`);
        return request;
      });
    });
  }

  done(request) {
    if (request._message) {
      this._log(`ACKing: ${request.type} ${request.url}`);
      // TODO oddly there is no promise returned for this call.
      this.channel.ack(request._message);
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      delete request._message;
      this._log(`NAKing: ${request.type} ${request.url}`);
      this.channel.nack(request._message);
    }
    return Q();
  }

  _setCacheTag(request) {
    const key = this._getCacheKey(request);
    const deferred = Q.defer();
    this.redisClient.set([key, 'true', 'EX', '300', 'NX'], function (err, reply) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve(reply);
      }
    });
    return deferred.promise;
  }

  _removeCacheTag(request) {
    const key = this._getCacheKey(request);
    const deferred = Q.defer();
    this.redisClient.del(key, function (err, reply) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve(reply);
      }
    });
    return deferred.promise;
  }

  _hasCacheTag(request) {
    const key = this._getCacheKey(request);
    const deferred = Q.defer();
    this.redisClient.get(key, function (err, reply) {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve(!!reply);
      }
    });
    return deferred.promise;
  }

  _getCacheKey(request) {
    const env = process.env.NODE_ENV;
    return `${env}:amqp:${this.queueName}:${request.url}:force:${!!request.force}`;
  }

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = AmqpQueue;