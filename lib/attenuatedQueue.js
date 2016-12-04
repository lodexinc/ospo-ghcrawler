const memoryCache = require('memory-cache');
const Q = require('q');
const qlimit = require('qlimit');

class AttenuatedQueue {
  constructor(queue, options) {
    this.queue = queue;
    this.options = options;
    this.logger = options.logger;
  }

  push(requests) {
    const self = this;
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      return self._pushOne(request);
    })));
  }

  _pushOne(request) {
    // include the attemp count in the key to allow for one concurrent requeue
    const attempCount = request.attempCount || 0;
    const key = `t:${attempCount}:${request.toUniqueString()}`;
    const timestamp = memoryCache.get(key);
    // if this is not a requeue and we've seen it before, don't bother queueing
    if (timestamp) {
      this._log(`Coalesced tag. Seen ${Date.now() - timestamp}ms ago: ${key}`);
      return Q(request);
    }
    const result = this.queue.push(request);
    const ttl = this.options.attenuation.ttl || 1000;
    result.then(() => memoryCache.put(key, Date.now(), ttl));
    return result;
  }

  pop() {
    return this.queue.pop();
  }

  done(request) {
    return this.queue.done(request);
  }

  abandon(request) {
    return this.queue.abandon(request);
  }

  subscribe() {
    return this.queue.subscribe();
  }

  unsubscribe() {
    return this.queue.unsubscribe();
  }

  getName() {
    return this.queue.getName();
  }

  _log(message) {
    return this.logger ? this.logger.silly(message) : null;
  }
}

module.exports = AttenuatedQueue;