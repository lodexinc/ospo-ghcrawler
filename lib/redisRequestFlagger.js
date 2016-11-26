const Q = require('q');

class RedisRequestFlagger {
  constructor(prefix, redisClient, options) {
    this.prefix = prefix;
    this.redisClient = redisClient;
    this.options = options;
    this.logger = options.logger;
  }

  setFlag(request) {
    const key = this._getKey(request);
    const deferred = Q.defer();
    const self = this;
    const value = Date.now().toString();
    this.redisClient.set([key, value, 'EX', this.options.ttl, 'NX'], function (err, reply) {
      if (err) {
        // resolve even if the set failed.  Failure to flag is not fatal to the queuing operation
        self._log(`Pushed and FAILED to tag request: ${request.type} ${request.url}`);
        deferred.resolve(null);
      } else {
        self._log(`Pushed and Tagged request: ${request.type} ${request.url}`);
        deferred.resolve(request);
      }
    });
    return deferred.promise;
  }

  removeFlag(request) {
    const key = this._getKey(request);
    const deferred = Q.defer();
    const self = this;
    this.redisClient.del(key, function (err, reply) {
      if (err) {
        // This is a BIG deal. If we fail to remove here then other agents will think that everything is ok
        // and decline to queue new entries for this request when in fact, we may not be successful here.
        // Log all the info and then ensure that we fail this and cause the request to get requeued
        self.logger.error(new Error(`Failed to remove queue tag: ${request.type} ${request.url}`));
        return deferred.reject(err);
      }
      self._log(`Removed queue tag: ${request.type} ${request.url}`);
      deferred.resolve(request);
    });
    return deferred.promise;
  }

  getFlag(request) {
    const key = this._getKey(request);
    const deferred = Q.defer();
    const self = this;
    this.redisClient.get(key, function (err, reply) {
      if (err) {
        return deferred.reject(err);
      }
      const timestamp = parseInt(reply);
      const diff = Date.now() - timestamp;
      self._log(`Request was already queued: ${request.type} ${request.url}, ${diff}ms ago`);
      deferred.resolve(timestamp);
    });
    return deferred.promise;
  }

  _getKey(request) {
    const env = process.env.NODE_ENV;
    return `${env}:${this.prefix}:${request.url}:transitivity:${request.transitivity}:fetch:${request.fetch}`;
  }

  _log(message) {
    if (this.logger) {
      this.logger.silly(message);
    }
  }
}
module.exports = RedisRequestFlagger;