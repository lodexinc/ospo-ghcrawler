// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');

class OperationLimiter {
  constructor(limiter, options) {
    this.limiter = limiter;
    this.queue = [];
    this.options = options;
    this.logger = options.logger;
    this.counter = 0;
  }

  /**
   * Run the given operation rate limiting it relative to the supplied key
   */
  run(key, operation) {
    // Create a promise to return now as the operation invocation may well be postponed
    const deferred = Q.defer();
    const wrapper = () => {
      return operation().then(
        result => deferred.resolve(result),
        error => deferred.reject(error));
    };
    this.queue.push({ key: key, operation: wrapper, deferred: deferred });
    this._run();
    return deferred.promise;
  }

  _run() {
    const spec = this.queue.shift();
    if (!spec) {
      return;
    }
    try {
      this.limiter(spec.key, (error, timeLeft, actionsLeft) => {
        if (error) {
          return spec.deferred.reject(error);
        }
        if (timeLeft) {
          // requeue the operation and wait for a slot
          this.logger.info(`================== ratelimited (${spec.id}, ${spec.key}, ${timeLeft}) ========================`);
          this.queue.unshift(spec);
          setTimeout(this._run.bind(this), timeLeft);
        } else {
          this.logger.info(`================== executing (${spec.id}, ${spec.key}) ========================`);
          // run the operation and trigger another operation to run
          spec.operation().finally(this._runNext.bind(this));
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