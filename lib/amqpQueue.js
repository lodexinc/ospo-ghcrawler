const amqp = require('amqplib');
const Q = require('q');
const qlimit = require('qlimit');
const redis = require('redis');

class AmqpQueue {
  constructor(url, queueName, formatter, flagger, logger = null) {
    this.url = url;
    this.messageFormatter = formatter;
    this.queueName = queueName;
    this.messageFormatter = formatter;
    this.flagger = flagger;
    this.logger = logger;

    this.connection = null;
    this.channel = null;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(10)(request => {
      let timestamp = 0;
      // if we can get a flag for the request, then it is already in the queue.  otherwise, queue it up for processing
      return this.flagger.getFlag(request).then(value => timestamp = value).then(() => {
        if (timestamp) {
          return true;
        }
        const body = JSON.stringify(request);
        const deferred = Q.defer();
        this.channel.sendToQueue(this.queueName, new Buffer(body), {}, (err, ok) => {
          if (err) {
            return deferred.reject(err);
          }
          this.flagger.setFlag(request).then(() => deferred.resolve(), () => deferred.resolve());
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
        return this.channel.assertQueue(this.queueName, { durable: true });
      });
    });
  }

  unsubscribe() {
    if (this.channel) {
      this.channel.close();
    }
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
      // ACK and don't worry if it fails. The request will go back on the queue and be processed again.
      this.channel.ack(message);
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._log(`NAKing: ${request.type} ${request.url}`);
      this.channel.nack(message);
    }
    return Q();
  }

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = AmqpQueue;