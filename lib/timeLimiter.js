// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const moment = require('moment');

class ComputeTimeLimiter {
  constructor(limiter, options) {
    this.limiter = limiter;
    this.options = options;
    this.baseline = options.baseline;
    this.lastCalled = moment();
    this.lastUpdated = this.lastCalled;
  }

  consume(time, key, exhaust) {
    _update();
    this.lastCalled = moment();
    const consumedTime = time - (this.options.baseline || 50);
    if (this.limiter.increment(key, consumedTime)) {
      exhaust();
    }
  }

  _update() {
    if (!this.options.updater || lastUpdated.isAfter(lastCalled)) {
      return;
    }
    this.lastUpdated = moment();
    setTimeout(() => this.baseline = this.options.updater(), 1);
  }
}

module.exports.ComputeTimeLimiter = ComputeTimeLimiter;