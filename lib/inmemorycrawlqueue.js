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
    this._incrementMetric('push');
    requests = Array.isArray(requests) ? requests : [requests];
    this.queue = this.queue.concat(requests);
    return Q.resolve();
  }

  subscribe() {
    return Q(null);
  }

  pop() {
    this._incrementMetric('pop');
    return Q.resolve(this.queue.shift());
  }

  done() {
    this._incrementMetric('done');
    return Q(null);
  }

  abandon(request) {
    this._incrementMetric('abandon');
    this.queue.unshift(request);
    return Q.resolve();
  }

  _incrementMetric(operation) {
    const metrics = this.logger.metrics;
    if (metrics && metrics[this.name] && metrics[this.name][operation]) {
      metrics[this.name][operation].incr();
    }
  }
}
module.exports = InMemoryCrawlQueue;