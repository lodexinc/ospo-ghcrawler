const Q = require('q');

class InMemoryCrawlQueue {
  constructor(name) {
    this.name = name;
    this.queue = [];
  }

  getName() {
    return this.name;
  }

  push(requests) {
    requests = Array.isArray(requests) ? requests : [requests];
    this.queue = this.queue.concat(requests);
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