// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const amqp10 = require('amqp10');
const moment = require('moment');
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
    let policy = AmqpPolicy.Utils.RenewOnSettle(this.currentAmqpCredit, AmqpConstants.receiverSettleMode.settleOnDisposition);
    const size = (this.options.messageSize || 128) * 1024;
    policy = AmqpPolicy.merge({
      senderLink: { attach: { maxMessageSize: size }, reconnect: { forever: true } },
      receiverLink: { attach: { maxMessageSize: size }, reconnect: { forever: true } }
    }, policy);
    this.client = new AmqpClient(AmqpPolicy.ServiceBusQueue, policy);
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
          this._logReceiverSenderError(err, 'receiver');
        });
        sender.on('errorReceived', err => {
          this._logReceiverSenderError(err, 'sender');
        });
        receiver.on('detached', () => {
          this.logger.info(`Receiver detached from ${this.getName()}`);
        });
        sender.on('detached', () => {
          this.logger.info(`Sender detached from ${this.getName()}`);
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
    this.client = null;
    this.receiver = null;
    this.sender = null;
    return Q();
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      this._incrementMetric('push');
      const body = JSON.stringify(request);
      this._silly(`Pushed: ${request.type} ${request.url}`);
      return this.sender.send(body);
    })));
  }

  pop() {
    const message = this._findMessage();
    if (!message || !message.body) {
      this._silly('Nothing to pop');
      return Q(null);
    }
    this._incrementMetric('pop');
    const request = this.messageFormatter(message.body);
    request._message = message;
    this._silly(`Popped: ${request.type} ${request.url}`);
    return Q(request);
  }

  _findMessage() {
    // Clean up and trim off any messages that have actually expired according to the queuing system
    const now = moment();
    const validIndex = this.messages.findIndex(message => now.isBefore(message.messageAnnotations['x-opt-locked-until']));
    if (validIndex < 0) {
      return null;
    }
    this.messages.splice(0, validIndex);

    // Find a candidate message -- one that is not expired or deferred
    const candidateIndex = this.messages.findIndex(message =>
      now.isBefore(message.messageAnnotations['x-opt-locked-until']) && (!message._deferUntil || message._deferUntil.isBefore(now)));
    if (candidateIndex < 0) {
      return null;
    }
    const result = this.messages[candidateIndex];
    this.messages.splice(candidateIndex, 1);
    return result;
  }

  done(request) {
    if (!request || !request._message) {
      return Q();
    }
    // delete the message so a subsequent abandon or done does not retry the ack/nak
    this._incrementMetric('done');
    const message = request._message;
    delete request._message;
    this._silly(`ACKed: ${request.type} ${request.url}`);
    try {
      return Q(this.receiver.accept(message));
    } catch (error) {
      this.logger.info(`Message could not be ACKed for ${this.queueName}. Error: ${error}`);
      return Q.delay(2000).then(() => this.receiver.accept(message));
    }
  }

  /**
   * Don't give up on the given request but also don't immediately try it again -- defer try
   */
  defer(request) {
    const message = request._message;
    if (!message) {
      return;
    }
    this._incrementMetric('defer');
    // TODO allow the caller to pass in the wake up time.
    message._deferUntil = moment().add(500, 'ms');
    this.messages.push(message);
    delete request._message;
    this._silly(`Deferred: ${request.type} ${request.url}`);
  }

  abandon(request) {
    if (!request || !request._message) {
      return Q();
    }
    // delete the message so a subsequent abandon or done does not retry the ack/nak
    this._incrementMetric('abandon');
    const message = request._message;
    delete request._message;
    this._silly(`NAKed: ${request.type} ${request.url}`);
    try {
      this.receiver.release(message);
    } catch (error) {
      this.logger.info(`Message could not be NAKed for ${this.queueName}. Error: ${error}`);
      return Q.delay(2000).then(() => this.receiver.release(message));
    }
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

  _logReceiverSenderError(err, type) {
    if (err.condition === 'amqp:link:detach-forced' || err.condition === 'amqp:connection:forced') {
      this.logger.info(`${this.queueName} - ${type} timeout: ${err.condition}`);
    } else {
      this.logger.error(err, `${this.queueName} - ${type} error`);
    }
  }
}

module.exports = Amqp10Queue;