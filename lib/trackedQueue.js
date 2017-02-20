// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');
const qlimit = require('qlimit');

class TrackedQueue {
  constructor(queue, tracker, options) {
    this.queue = queue;
    this.tracker = tracker;
    this.options = options;
    this.logger = options.logger;
  }

  push(requests) {
    const self = this;
    requests = Array.isArray(requests) ? requests : [requests];
    return Q.all(requests.map(qlimit(this.options.parallelPush || 1)(request => {
      return self.tracker.track(request, self.queue.push.bind(self.queue));
    })));
  }

  pop() {
    const self = this;
    return this.queue.pop().then(request => {
      if (!request) {
        return null;
      }
      return self.tracker.untrack(request).then(
        () => { return request; },
        error => {
          // if we cannot untrack, abandon the popped message and fail the pop.
          return self.abandon(request).finally(() => { throw error; });
        });
    });
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

  flush() {
    return this.tracker.flush().then(() => {
      return this.queue.flush();
    });
  }

  getName() {
    return this.queue.getName();
  }
}

module.exports = TrackedQueue;