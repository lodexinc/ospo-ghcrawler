// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const limiter = require('./inmemoryRateLimiter');
const Q = require('q');
const qlimit = require('qlimit');

class RateLimitedPushQueue {
  constructor(queue, limiter, options) {
    this.queue = queue;
    this.limiter = limiter;
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
    const deferred = Q.defer();
    const self = this;
    this.limiter(null, (error, rate) => {
      if (error) {
        return deferred.reject(error);
      }
      if (rate.over) {
        return deferred.resolve(Q.delay(Math.floor((this.options.pushRateWindow || 2) * 1000 / 4)).then(() => {
          return self._pushOne(request);
        }));
      }
      deferred.resolve(this.queue.push(request));
    });
    return deferred.promise;
  }

  pop() {
    return this.queue.pop();
  }

  done(request) {
    return this.queue.done(request);
  }

  defer(request) {
    return this.queue.defer(request);
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

module.exports = RateLimitedPushQueue;