const amqp = require('amqplib');
const Q = require('q');
const qlimit = require('qlimit');

class AmqpQueue {
  constructor(url, name, formatter, options) {
    this.url = url;
    this.messageFormatter = formatter;
    this.name = name;
    this.queueName = `${options.topic}-${name}`;
    this.options = options;
    this.logger = options.logger;

    this.connection = null;
    this.channel = null;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      const body = JSON.stringify(request);
      const deferred = Q.defer();
      this.channel.sendToQueue(this.queueName, new Buffer(body), {}, (err, ok) => {
        if (err) {
          return deferred.reject(err);
        }
        this.logger.verbose(`Queued ${request.policy.getShortForm()} ${request.type}@${request.url} `);
        // set the tracking flag and resolve regardless of success
        deferred.resolve();
      });
      return deferred.promise;
    })));
  }

  subscribe() {
    if (this.connection && this.channel) {
      return Q();
    }

    const self = this;
    return amqp.connect(this.url).then(connection => {
      self.connection = connection;
      connection.on('error', self._reconnect.bind(self));
      process.once('SIGINT', function () { connection.close(); });
      return connection.createConfirmChannel().then(channel => {
        self.channel = channel;
        channel.on('error', self._reconnect.bind(self));
        return self.channel.assertQueue(self.queueName, { durable: true });
      });
    });
  }

  _reconnect() {
    this.logger.warn(`Reconnecting ${this.name} using AMQP at ${this.url}`);
    this.connection = null;
    this.channel = null;
    this.subscribe();
  }

  unsubscribe() {
    if (this.channel) {
      this.channel.close();
    }
    return Q();
  }

  pop() {
    const self = this;
    return this.channel.get(this.queueName).then(response => {
      if (!response) {
        return null;
      }
      const message = new Buffer(response.content).toString();
      const request = self.messageFormatter(message);
      request._message = response;
      return request;
    });
  }

  done(request) {
    if (request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      const message = request._message;
      delete request._message;
      this._silly(`ACKed: ${request.type} ${request.url}`);
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
      this._silly(`NAKed: ${request.type} ${request.url}`);
      this.channel.nack(message);
    }
    return Q();
  }

  getName() {
    return this.name;
  }

  _silly(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}

module.exports = AmqpQueue;