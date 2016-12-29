const amqp = require('amqplib');
const Q = require('q');
const qlimit = require('qlimit');

class AmqpQueue {
  constructor(url, name, formatter, options) {
    this.url = url;
    this.messageFormatter = formatter;
    this.name = name;
    this.queueName = `${options.queueName}-${name}`;
    this.options = options;
    this.logger = options.logger;

    this.channel = null;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      const body = JSON.stringify(request);
      const deferred = Q.defer();
      this.channel.then(channel => {
        channel.sendToQueue(this.queueName, new Buffer(body), {}, (err, ok) => {
          if (err) {
            return deferred.reject(err);
          }
          this._incrementMetric('push');
          const attemptString = request.attemptCount ? ` (attempt ${request.attemptCount})` : '';
          this.logger.verbose(`Queued ${request.policy.getShortForm()} ${request.toString()}${attemptString}`);
          deferred.resolve();
        });
      });
      return deferred.promise;
    })));
  }

  subscribe() {
    if (this.channel && (this.channel.isFulfilled() || this.channel.isPending())) {
      return this.channel;
    }
    return this._reconnect();
  }

  _reconnect() {
    if (this.channel) {
      this.logger.warn(`Reconnecting ${this.name} using AMQP at ${this.url}`);
    }
    // Create a channel promise that is (or will be) connected to the queue.
    const self = this;
    this.channel = Q
      .try(() => {
        return amqp.connect(this.url);
      })
      .then(connection => {
        connection.on('error', self._reconnect.bind(self));
        process.once('SIGINT', function () { connection.close(); });
        return connection.createConfirmChannel().then(channel => {
          channel.on('error', self._reconnect.bind(self));
          return channel.assertQueue(self.queueName, { durable: true }).then(() => channel);
        });
      })
      .then(
        channel => {
          this.logger.info(`Connected ${this.name} using AMQP at ${this.url}`);
          return channel;
        },
        error =>
          this.logger.warn(`Reconnection Failed for ${this.name} using AMQP at ${this.url}`));
    return this.channel;
  }

  unsubscribe() {
    if (this.channel) {
      this.channel.then(channel => { return channel.close(); });
    }
    return Q();
  }

  pop() {
    const self = this;
    return this.channel.then(channel => {
      return channel.get(self.queueName).then(response => {
        if (!response) {
          return null;
        }
        this._incrementMetric('pop');
        const message = new Buffer(response.content).toString();
        const request = self.messageFormatter(message);
        request._message = response;
        return request;
      });
    });
  }

  done(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      this._incrementMetric('done');
      const message = request._message;
      delete request._message;
      this._silly(`ACKed: ${request.type} ${request.url}`);
      // ACK and don't worry if it fails. The request will go back on the queue and be processed again.
      this.channel.then(channel => channel.ack(message));
    }
    return Q();
  }

  abandon(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      this._incrementMetric('abandon');
      const message = request._message;
      delete request._message;
      this._silly(`NAKed: ${request.type} ${request.url}`);
      this.channel.then(channel => channel.nack(message));
    }
    return Q();
  }

  getName() {
    return this.name;
  }

  _incrementMetric(operation) {
    const metrics = this.logger.metrics;
    if (metrics && metrics[this.name] && metrics[this.name][operation]) {
      metrics[this.name][operation].incr();
    }
  }

  _silly(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = AmqpQueue;