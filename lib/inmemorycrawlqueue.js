const Q = require('q');

class InMemoryCrawlQueue {
  constructor() {
    this.queues = { normal: [], priority: [], deadletter: [] };
  }

  push(requests, priority = 'normal') {
    requests = Array.isArray(requests) ? requests : [requests];
    const queue = this.queues[priority];
    requests.forEach(request => queue.push(request));
    return Q();
  }

  subscribe() {
    return Q();
  }

  unsubscribe() {
    return Q();
  }

  pop() {
    return this.queue.shift();
  }

  done() {
    return Q();
  }

  abandon(request) {
    this.queue.unshift(request);
    return Q();
  }
}
module.exports = InMemoryCrawlQueue;