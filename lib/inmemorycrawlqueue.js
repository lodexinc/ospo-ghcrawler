const Q = require('q');

class InMemoryCrawlQueue {
  constructor() {
    this.queue = [];
  }

  push(type, url, context) {
    this.queue.push({ type: type, url: url, context: context });
    return Q.resolve();
  }

  subscribe() {
    return Q(null);
  }

  pop() {
    return Q.resolve(this.queue.shift());
  }

  done() {
    // We don't support transactions
  }
}
module.exports = InMemoryCrawlQueue;