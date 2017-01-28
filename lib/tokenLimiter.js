// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

class LimitedTokenFactory {
  constructor(factory, limiter, options) {
    this.factory = factory;
    this.limiter = limiter;
    this.logger = options.logger;
    this.options = options;
  }

  getToken(traits) {
    const token = this.factory.getToken(traits);
    if (!token || typeof token === 'number') {
      return Q(token);
    }
    const deferred = Q.defer();
    const key = `${token.slice(0, 2)}..${token.slice(-2)}`;
    this.limiter({ key: key }, (error, rate) => {
      if (error) {
        return deferred.reject(error);
      }
      if (rate.over) {
        // too many asks for this token too fast, exhaust this token for a bit to cool down.
        const retryTime = this.options.clientCallCap || 500;
        this.logger.verbose(`Client call rate capped (${key}, ${retryTime})`);
        this.factory.exhaust(token, Date.now() + retryTime);
        return deferred.resolve(retryTime);
      }
      deferred.resolve(token);
    });
    return deferred.promise;
  }
}

module.exports.LimitedTokenFactory = LimitedTokenFactory;