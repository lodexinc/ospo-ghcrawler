// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');
const RateLimiter = require('ratelimiter');

class OperationLimiter {

  constructor(redis, options) {
    this.redis = redis;
    this.options = options;
    this.limiters = {};
    this.logger = options.logger;
    this.counter = 0;
  }

  /**
   * Run the given operation rate limiting it relative to the supplied key
   */
  run(key, operation) {
    return this._runOne(this._getLimiter(key), operation);
  }

  _getLimiter(key) {
    let limiter = this.limiters[key];
    if (limiter) {
      return limiter;
    }
    const options = { id: key, db: this.redis, max: this.options.rate, duration: 1000 };
    limiter = new RateLimiter(options);
    limiter.queue = [];
    limiter.key = key;
    this.limiters[key] = limiter;
    return limiter;
  }

  /**
   * Run the given operation rate limiting it relative to the supplied key
   */
  _runOne(limiter, operation) {
    // Create a promise to return now as the operation invocation may well be postponed
    const deferred = Q.defer();
    const wrapper = () => {
      return operation().then(
        result => deferred.resolve(result),
        error => deferred.reject(error));
    };
    limiter.queue.push({ operation: wrapper, deferred: deferred });
    this._run(limiter);
    return deferred.promise;
  }

  _run(limiter) {
    const spec = limiter.queue.shift();
    if (!spec) {
      return;
    }
    try {
      limiter.get((error, limit) => {
        if (error) {
          return spec.deferred.reject(error);
        }
        if (limit.remaining) {
          this.logger.info(`================== executing (${limiter.key}) ========================`);
          spec.operation();
        } else {
          // requeue the operation and wait for a slot
          this.logger.info(`================== ratelimited (${limiter.key}, ${limit.reset}) ========================`);
          limiter.queue.unshift(spec);
          const retryTime = Math.max(0, limit.reset - Date.now() + 10);
          setTimeout(this._run.bind(this, limiter), retryTime);
        }
      });
    } catch (error) {
      spec.deferred.reject(error);
    }
  }

  _runNext(time = 50) {
    setTimeout(this._run.bind(this), time);
  }
}

module.exports = OperationLimiter;