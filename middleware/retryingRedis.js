// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const appInsights = require('applicationinsights');
const redis = require('redis');
const async = require('async');

class RetryingRedisClient {

  constructor(url, key, port = 6380) {
    this.client = redis.RedisClient;
    var options = { auth_pass: key, tls: { servername: url }};
    this.client = redis.createClient(port, url, options);
    this.client.on('error', error => appInsights.client.trackException(error, { name: 'SvcRedisError' }));
    this.client.on('reconnecting', properties => appInsights.client.trackEvent('SvcRedisReconnecting', properties));
    setInterval(this.heartbeat.bind(this), 60 * 1000);
  }

  hgetall(key, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.hgetall(key, cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  hget(key, field, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.hget(key, field, cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  get(key, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.get(key, cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  set(key, value, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.set(key, value, cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  setnx(key, value, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.set(key, value, cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  setnxexpiry(key, value, expiry, callback) {
    async.retry({ times: 4, interval: 250 }, function (cb, results) {
      this.client.set([key, value, 'EX', expiry.toString(), 'NX'], cb);
    }.bind(this), this.logAndPassthru(callback));
  }

  heartbeat() {
    this.client.ping(function (err, result) {
      if (err) { appInsights.client.trackException(err, { name: 'SvcRedisPingFailure' }); }
    });
  }

  logAndPassthru(callback) {
    return function (err, reply) {
      if (err) { appInsights.client.trackException(err, { name: 'SvcRedisFailure' }); }
      callback(err, reply);
    };
  }
}

module.exports = RetryingRedisClient;