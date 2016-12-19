const Amqp10Queue = require('../../lib/amqp10Queue');
const config = require('painless-config');
const expect = require('chai').expect;
const ObjectObserver = require('./objectObserver');
const OspoCrawler = require('../../lib/ospoCrawler');
const Q = require('q');
const Request = require('ghcrawler').request;

const url = config.get('GHCRAWLER_AMQP10_URL'); // URL should be: amqps://<keyName>:<key>@<host>
const name = 'test';
const formatter = message => {
  Request.adopt(message);
  return message;
};
const options = {
  logger: OspoCrawler.createLogger(true, true),
  topic: 'ghcrawler',
  credit: 2
};
new ObjectObserver(options);

describe('AMQP 1.0 Integration', () => {

  before(() => {
    if (!url) {
      throw new Error('GHCRAWLER_AMQP10_URL not configured.');
    }
    return drainTestQueue(100);
  });

  it('Should pop no message if the queue is empty', () => {
    const amqpQueue = new Amqp10Queue(url, name, formatter, options);
    return amqpQueue.subscribe().then(() => {
      return amqpQueue.pop().then(message => {
        expect(message).to.be.null;
        return amqpQueue.unsubscribe();
      });
    });
  });

  it('Should push, pop and ack a message', (done) => {
    const amqpQueue = new Amqp10Queue(url, name, formatter, options);
    amqpQueue.subscribe().then(() => {
      let msg = new Request('user', 'http://test.com/users/user1');
      console.log('Pushing message:', msg);
      amqpQueue.push(msg).then(() => {
        setTimeout(() => {
          amqpQueue.pop().then(message => {
            expect(message).to.exist;
            expect(message instanceof Request).to.be.true;
            console.log('Popped message:', message);
            amqpQueue.done(message).then(() => {
              amqpQueue.unsubscribe().then(done());
            });
          });
        }, 500);
      });
    });
  });

  it('Should push, pop and ack a message, then pop no message from the empty queue', (done) => {
    const amqpQueue = new Amqp10Queue(url, name, formatter, options);
    amqpQueue.subscribe().then(() => {
      let msg = new Request('user', 'http://test.com/users/user2');
      console.log('Pushing message:', msg);
      amqpQueue.push(msg).then(() => {
        setTimeout(() => {
          amqpQueue.pop().then(message => {
            expect(message).to.exist;
            expect(message instanceof Request).to.be.true;
            console.log('Popped message:', message);
            amqpQueue.done(message).then(() => {
              amqpQueue.pop().then(emptyMessage => {
                expect(emptyMessage).to.be.null;
                amqpQueue.unsubscribe().then(done());
              });
            });
          });
        }, 500);
      });
    });
  });

  it('Should push, pop, abandon, pop and ack a message', (done) => {
    const amqpQueue = new Amqp10Queue(url, name, formatter, options);
    amqpQueue.subscribe().then(() => {
      let msg = new Request('user', 'http://test.com/users/user3');
      console.log('Pushing message:', msg);
      amqpQueue.push(msg).then(() => {
        setTimeout(() => {
          amqpQueue.pop().then(message => {
            expect(message).to.exist;
            expect(message instanceof Request).to.be.true;
            console.log('Popped message:', message);
            amqpQueue.abandon(message).then(() => {
              setTimeout(() => {
                amqpQueue.pop().then(abandonedMessage => {
                  console.log('Popped abandoned message:', message);
                  expect(abandonedMessage).to.exist;
                  expect(abandonedMessage instanceof Request).to.be.true;
                  amqpQueue.done(abandonedMessage).then(() => {
                    amqpQueue.unsubscribe().then(done());
                  });
                });
              }, 500);
            });
          });
        }, 500);
      });
    });
  });

  it('Should push pop and ack 10 messages when initial credit is 10', () => {
    const pushPromises = [];
    const popPromises = [];
    options.credit = 10;
    const amqpQueue = new Amqp10Queue(url, name, formatter, options);
    return amqpQueue.subscribe().then(() => {
      for (let i = 1; i <= 10; i++) {
        let msg = new Request('user', 'http://test.com/users/user' + i);
        console.log(`Pushing message ${i}:`, msg);
        pushPromises.push(amqpQueue.push(msg));
      }
      return Q.all(pushPromises).then(() => {
        for (let i = 1; i <= 10; i++) {
          popPromises.push(amqpQueue.pop().then(message => {
            expect(message).to.exist;
            expect(message instanceof Request).to.be.true;
            console.log(`Popped message ${i}. Calling done on:`, message);
            return amqpQueue.done(message);
          }));
        }
        return Q.all(popPromises).then(() => {
          return amqpQueue.unsubscribe();
        });
      });
    });
  });
});

function drainTestQueue(numOfMessages) {
  console.log('Drain the testing queue.');
  const deferred = Q.defer();
  const popPromises = [];
  options.credit = numOfMessages;
  const amqpQueue = new Amqp10Queue(url, name, formatter, options);
  amqpQueue.subscribe().then(() => {
    setTimeout(() => { // Wait for messages to be read.
      for (let i = 0; i < numOfMessages; i++) {
        popPromises.push(amqpQueue.pop().then(message => {
          amqpQueue.done(message);
        }));
      }
      Q.all(popPromises).then(() => {
        amqpQueue.unsubscribe().then(deferred.resolve());
      });
    }, 2000);
  });
  return deferred.promise;
}