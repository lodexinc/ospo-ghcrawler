// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const amqp10 = require('amqp10');
const moment = require('moment');
const Q = require('q');
const qlimit = require('qlimit');

const AmqpPolicy = amqp10.Policy;

class Amqp10Queue {
  constructor(client, name, queueName, formatter, manager, options) {
    this.client = client;
    this.name = name;
    this.queueName = queueName;
    this.messageFormatter = formatter;
    this.manager = manager;
    this.options = options;
    this.logger = options.logger;
    this.currentAmqpCredit = options.credit || 10;
    this.options._config.on('changed', this._reconfigure.bind(this));

    this.receiver = null;
    this.sender = null;
    this.messages = [];
  }

  subscribe() {
    if (this.receiver && this.sender) {
      return Q();
    }
    // no formatter implies you don't want to receive
    const receive = !!this.messageFormatter;
    // bit of a hack but if the queue name has a / then it is likely a topic so don't hook up a sender
    const send = !this.queueName.includes('/');
    return this.client.then(client => {
      const queuePromise = this.manager ? this.manager.createQueue(this.queueName) : Q();
      queuePromise.then(() => {
        const size = (this.options.messageSize || 200) * 1024;
        const basePolicy = {
          senderLink: { attach: { maxMessageSize: size } },
          receiverLink: { attach: { maxMessageSize: size } }
        };
        const receivePolicy = AmqpPolicy.Utils.RenewOnSettle(this.currentAmqpCredit || 10, 1, basePolicy).receiverLink;
        return Q.spread([
          receive ? client.createReceiver(this.queueName, receivePolicy) : Q(null),
          send ? client.createSender(this.queueName, basePolicy.senderLink) : Q(null)
        ], (receiver, sender) => {
          this.logger.info(`Connecting to ${this.queueName}`);
          if (sender) {
            this.sender = sender;
            sender.on('errorReceived', err => {
              this._logReceiverSenderError(err, 'sender');
            });
            sender.on('attached', () => {
              this.logger.info(`Sender attached to ${this.getName()}`);
            });
            sender.on('detached', () => {
              this.logger.info(`Sender detached from ${this.getName()}`);
            });
          }
          if (receiver) {
            this.receiver = receiver;
            receiver.on('message', message => {
              this.messages.push(message);
            });
            receiver.on('errorReceived', err => {
              this._logReceiverSenderError(err, 'receiver');
            });
            receiver.on('attached', () => {
              this.logger.info(`Receiver attached to ${this.getName()}`);
            });
            receiver.on('detached', () => {
              this.logger.info(`Receiver detached from ${this.getName()}`);
            });
          }
          process.once('SIGINT', () => {
            client.disconnect();
          });
          return Q();
        });
      });
    }).catch(error => {
      this.logger.error(`${this.queueName} could not be instantiated. Error: ${error}`);
    });
  }

  unsubscribe() {
    this.logger.info(`Detaching from ${this.queueName}`);
    if (this.sender) {
      this.sender.detach({ closed: true });
    }
    if (this.receiver) {
      this.receiver.detach({ closed: true });
    }
    this.receiver = null;
    this.sender = null;
    this.messages = [];
    return Q();
  }

  push(requests) {
    if (!this.sender) {
      return Q();
    }
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
    const request = this.messageFormatter(message);
    if (!request) {
      // We are never going to process this message (no formatter).  Make sure to accept the message to
      // ensure the queuing system gives back the credits.
      this._accept(message);
      return Q(null);
    }
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
    // remove any expired messages.  Make sure to release them so the AMPQ client does the proper accounting and sends more messages.
    const expired = this.messages.splice(0, validIndex);
    if (expired && expired.length > 0) {
      this.logger.info(`Releasing ${expired.length} expired messages from ${this.queueName}.`);
      expired.forEach(message => this._release(message));
    }
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

  _release(message, delay = 0) {
    try {
      return Q(this.receiver.release(message));
    } catch (error) {
      this.logger.info(`Could not release message for ${this.queueName}. Error: ${error.message}`);
      if (delay) {
        return Q.delay(delay).then(() => this.receiver.release(message));
      }
    }
  }

  _accept(message, delay = 0) {
    try {
      return Q(this.receiver.accept(message));
    } catch (error) {
      this.logger.info(`Could not accept message for ${this.queueName}. Error: ${error.message}`);
      if (delay) {
        return Q.delay(delay).then(() => this.accept.release(message));
      }
    }
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
    return this._accept(message, 2000);
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
    this._release(message, 2000);
  }

  flush() {
    if (!this.manager) {
      return Q();
    }
    return Q
      .try(this.unsubscribe.bind(this))
      .then(this.manager.flushQueue.bind(this.manager, this.queueName))
      .then(this.subscribe.bind(this))
      .then(() => { return this; });
  }

  getInfo() {
    if (!this.manager) {
      return Q(null);
    }
    return this.manager.getInfo(this.queueName).then(info => {
      if (!info) {
        return null;
      }
      info.metricsName = `${this.options.queueName}:${this.name}`;
      return info;
    });
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