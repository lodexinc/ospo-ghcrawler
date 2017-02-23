// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const Q = require('q');
const request = require('request');

class RabbitQueueManager {
  constructor(amqpUrl, managementEndpoint) {
    this.url = amqpUrl;
    this.managementEndpoint = managementEndpoint;
  }

  flushQueue(name) {
    return this._call('delete', `${this.managementEndpoint}/api/queues/%2f/${name}/contents`, `Could not flush queue ${name}`, false);
  }

  getInfo(name) {
    return this._call('get', `${this.managementEndpoint}/api/queues/%2f/${name}`, `Could not get info for queue ${name}`).then(info => {
      return { count: info.messages };
    });
  }

  _call(method, url, errorMessage, json = true, body = null) {
    const deferred = Q.defer();
    const options = {};
    if (json) {
      options.json = json;
    }
    if (body) {
      options.body = body;
    }
    request[method](url, options, (error, response, body) => {
      if (error || response.statusCode > 299) {
        const detail = error ? error.message : (typeof body === 'string' ? body : body.message);
        return deferred.reject(new Error(`${errorMessage}: ${detail}.`));
      }
      deferred.resolve(body);
    });
    return deferred.promise;
  }
}

module.exports = RabbitQueueManager;