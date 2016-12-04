const Q = require('q');

class InMemoryCrawlQueue {
  constructor(name) {
    this.name = name;
    this.queue = [];
  }

  push(request) {
    this.queue.push(request);
    return Q.resolve();
  }

  subscribe() {
    return Q(null);
  }

  pop() {
    return Q.resolve(this.queue.shift());
  }

  done() {
    return Q(null);
  }

  abandon(request) {
    this.queue.unshift(request);
    return Q.resolve();
  }
}
module.exports = InMemoryCrawlQueue;