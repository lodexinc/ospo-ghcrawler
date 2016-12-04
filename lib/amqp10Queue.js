const amqp10 = require('amqp10');
const Q = require('q');
const qlimit = require('qlimit');

const AmqpClient = amqp10.Client;
const AmqpPolicy = amqp10.Policy;
const AmqpConstants = amqp10.Constants;

class Amqp10Queue {
  constructor(url, queueName, logger = null, initialCredit = 2) {
    this.url = url;
    this.queueName = queueName;
    this.logger = logger;
    this.amqpInitialCredit = initialCredit;

    this.client = null;
    this.receiver = null;
    this.sender = null;
    this.messages = [];
  }

  subscribe() {
    if (this.client && this.receiver && this.sender) {
      return Q();
    }

    this.client = new AmqpClient(AmqpPolicy.ServiceBusQueue, AmqpPolicy.Utils.RenewOnSettle(this.amqpInitialCredit, AmqpConstants.receiverSettleMode.settleOnDisposition));
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
    return Q.all(requests.map(qlimit(10)(request => {
      const body = JSON.stringify(request);
      return this.sender.send(body);
    })));
  }

  pop() {
    let message = this.messages.shift();
    if (message) {
      return Q(message);
    }
    return Q(null);
  }

  done(message) {
    if (message) {
      this.receiver.accept(message);
    }
    return Q();
  }

  abandon(message) {
    if (message) {
      this.receiver.release(message);
    }
    return Q();
  }
}

module.exports = Amqp10Queue;