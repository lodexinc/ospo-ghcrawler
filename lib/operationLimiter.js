// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');

class OperationLimiter {

  constructor(limiter, options) {
    this.limiter = limiter;
    this.options = options;
    this.queues = {};
    this.logger = options.logger;
    this.counter = 0;
  }

  /**
   * Run the given operation rate limiting it relative to the supplied key
   */
  run(key, operation) {
    return this._runOne(this._getQueue(key), key, operation);
  }

  _getQueue(key) {
    const result = this.queues[key] || [];
    this.queues[key] = result;
    return result;
  }

  /**
   * Run the given operation rate limiting it relative to the supplied key
   */
  _runOne(queue, key, operation) {
    // Create a promise to return now as the operation invocation may well be postponed
    const deferred = Q.defer();
    const wrapper = () => {
      return operation().then(
        result => deferred.resolve(result),
        error => deferred.reject(error));
    };
    queue.push({ key: key, operation: wrapper, deferred: deferred, id: this.counter++});
    this._run(queue);
    return deferred.promise;
  }

  _run(queue) {
    const spec = queue.shift();
    if (!spec) {
      return;
    }
    try {
      this.limiter(spec, (error, rate) => {
        if (error) {
          return spec.deferred.reject(error);
        }
        if (rate.over) {
          // requeue the operation and wait for a slot
          const retryTime = 500;
          this.logger.verbose(`ratelimited (${spec.id}, ${spec.key}, ${retryTime})`);
          queue.unshift(spec);
          setTimeout(this._run.bind(this, queue), retryTime);
        } else {
          this.logger.verbose(`executing (${spec.id}, ${spec.key})`);
          spec.operation();
        }
      });
    } catch (error) {
      // if error in the limiter itself, bail on this request and rely on caller to retry
      spec.deferred.reject(error);
    }
  }
}

module.exports = OperationLimiter;