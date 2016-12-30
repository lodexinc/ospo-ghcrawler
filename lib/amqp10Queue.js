// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const amqp10 = require('amqp10');
const Q = require('q');
const qlimit = require('qlimit');

const AmqpClient = amqp10.Client;
const AmqpPolicy = amqp10.Policy;
const AmqpConstants = amqp10.Constants;

class Amqp10Queue {
  constructor(url, name, formatter, options) {
    this.url = url;
    this.name = name;
    this.queueName = `${options.queueName}-${name}`;
    this.messageFormatter = formatter;
    this.options = options;
    this.logger = options.logger;
    this.currentAmqpCredit = options.credit || 10;
    this.options._config.on('changed', this._reconfigure.bind(this));

    this.client = null;
    this.receiver = null;
    this.sender = null;
    this.messages = [];
  }

  subscribe() {
    if (this.client && this.receiver && this.sender) {
      return Q();
    }

    this.client = new AmqpClient(AmqpPolicy.ServiceBusQueue, AmqpPolicy.Utils.RenewOnSettle(this.currentAmqpCredit, AmqpConstants.receiverSettleMode.settleOnDisposition));
    return this.client.connect(this.url).then(() => {
      return Q.spread([
        this.client.createReceiver(this.queueName),
        this.client.createSender(this.queueName)
      ], (receiver, sender) => {
        this.logger.info(`Connecting to ${this.queueName}`);
        this.receiver = receiver;
        this.sender = sender;
        receiver.on('message', message => {
          this.messages.push(message);
        });
        receiver.on('errorReceived', err => {
          this.logger.error(err, `${this.queueName} - receiver error`);
        });
        sender.on('errorReceived', err => {
          this.logger.error(err, `${this.queueName} - sender error`);
        });
        process.once('SIGINT', () => {
          this.client.disconnect();
        });
        return Q();
      });
    }).catch(error => {
      this.logger.error(`${this.queueName} could not be instantiated. Error: ${error}`);
    });
  }

  unsubscribe() {
    this.logger.info(`Disconnecting from ${this.queueName}`);
    if (this.client) {
      this.client.disconnect();
    }
    return Q();
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      this._incrementMetric('push');
      const body = JSON.stringify(request);
      return this.sender.send(body);
    })));
  }

  pop() {
    let message = this.messages.shift();
    if (message && message.body) {
      this._incrementMetric('pop');
      const request = this.messageFormatter(message.body);
      request._message = message;
      return Q(request);
    }
    return Q(null);
  }

  done(request) {
    if (request && request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      this._incrementMetric('done');
      const message = request._message;
      delete request._message;
      this._silly(`ACKed: ${request.type} ${request.url}`);
      this.receiver.accept(message);
    }
    return Q();
  }

  abandon(request) {
    if (request && request._message) {
      // delete the message so a subsequent abandon or done does not retry the ack/nak
      this._incrementMetric('abandon');
      const message = request._message;
      delete request._message;
      this._silly(`NAKed: ${request.type} ${request.url}`);
      this.receiver.release(message);
    }
    return Q();
  }

  getName() {
    return this.name;
  }

  _reconfigure(current, changes) {
    if (changes.some(patch => patch.path === '/credit') && this.currentAmqpCredit !== this.options.credit) {
      this.logger.info(`Reconfiguring AMQP 1.0 credit from ${this.currentAmqpCredit} to ${this.options.credit} for ${this.getName()}`);
      this.receiver.addCredits(this.options.credit - this.currentAmqpCredit);
      this.currentAmqpCredit = this.options.credit;
    }
    return Q();
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

module.exports = Amqp10Queue;