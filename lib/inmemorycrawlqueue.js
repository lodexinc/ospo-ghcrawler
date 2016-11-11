const Q = require('q');

class InMemoryCrawlQueue {
  constructor() {
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
}
module.exports = InMemoryCrawlQueue;