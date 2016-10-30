const config = require('painless-config');
const extend = require('extend');
const Q = require('q');
const request = require('requestretry');

class GitHubFetcher {
  constructor(options = {}) {
    this.options = extend({}, GitHubFetcher.defaultOptions, options);
    this.attempts = [];
  }

  static get defaultOptions() {
    return {
      json: true,
      headers: { 'User-Agent': 'ghcrawler' },
      maxAttempts: 5,
      retryDelay: 500,
      throttledSleep: 180,
      retryStrategy: GitHubFetcher.retryStrategy
    };
  }

  static retryStrategy(err, response, body) {
    if (err)
      return true;
    // if we received a 403 then extra ratelimiting has been applied.
    // Wait a few minutes and then try again.  If its a 5** then retry.
    // All others, do not retry as it won't help
    if (response.status === 403) {
      sleep(this.options.throttledSleep);
      return true;
    } else if (response.status >= 500) {
      return true;
    }
    return false;
  }

  // Ensure that the given URL has a per_page query parameter.
  // Either the one it already has or the max 100
  static ensureMaxPerPage(url) {
    if (url.includes('per_page')) {
      return url;
    }
    if (!url.includes('page')) {
      return url + '?per_page=100';
    }
    separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}per_page=100`;
  }

  static parseLinkHeader(header) {
    if (header.length === 0) {
      throw new Error("input must not be of zero length");
    }

    // Split parts by comma
    const parts = header.split(',');
    const links = {};
    // Parse each part into a named link
    for (var i = 0; i < parts.length; i++) {
      const section = parts[i].split(';');
      if (section.length !== 2) {
        throw new Error("section could not be split on ';'");
      }
      const url = section[0].replace(/<(.*)>/, '$1').trim();
      const name = section[1].replace(/rel="(.*)"/, '$1').trim();
      links[name] = url;
    }
    return links;
  }

  getAll(target, result = [], callback = null) {
    const deferred = Q.defer();
    const realCallback = callback || ((err, value) => {
      if (err)
        deferred.reject(err);
      else
        deferred.resolve(value);
    });
    target = GitHubFetcher.ensureMaxPerPage(target);
    this.get(target, (err, response, body) => {
      if (err) {
        realCallback(err);
      }

      let accumulatedValue = body;
      if (response.headers.link) {
        accumulatedValue = result.concat(body);
        const links = GitHubFetcher.parseLinkHeader(response.headers.link);
        if (links.next) {
          return this.getAll(links.next, accumulatedValue, realCallback);
        }
      }

      realCallback(null, accumulatedValue);
    });
    return callback ? null : deferred.promise;
  }

  get(target, callback = null) {
    const deferred = Q.defer();
    target = GitHubFetcher.ensureMaxPerPage(target);
    request.get(target, this.options, (err, response, body) => {
      this.attempts.push(response.attempts);
      if (err)
        return callback ? callback(err, response, body) : deferred.reject(err);

      // If we hit the low water mark for requests, sleep until the next ratelimit reset
      const remaining = parseInt(response.headers['x-ratelimit-remaining']) || 0;
      const reset = parseInt(response.headers['x-ratelimit-reset']) || 0;
      if (remaining < config.get('GITHUB_CRAWLER_REQUEST_LIMIT') && reset > 0) {
        const toSleep = Math.max(reset - Time.now.to_i + 2, 0);
      }
      // setTimeout(() => { }, toSleep);
      return callback ? callback(err, response, body) : deferred.resolve(body);
    });
    return callback ? null : deferred.promise;
  }
}

module.exports = GitHubFetcher;