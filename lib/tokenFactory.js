// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

class TokenFactory {

  static createToken(spec) {
    const parts = spec.split('#');
    const value = parts[0];
    const traits = parts[1].split(',');
    return { value: value, traits: traits };
  }

  constructor(tokens, options) {
    this.tokens = tokens;
    this.options = options;
    this.logger = options.logger;
  }

  /**
   * Find all of the tokens that match the given traits and return a random one that is
   * not on the bench.  If no candidates are found, return either the soonest time one will
   * come off the bench or null if there simply were none.
   */
  getToken(traits) {
    let minBench = Number.MAX_SAFE_INTEGER;
    const now = Date.now();
    const candidates = this.tokens.filter(token => {
      if (this._traitsMatch(token.traits, traits)) {
        if (!token.benchUntil || now > token.benchUntil) {
          return true;
        }
        minBench = Math.min(token.benchUntil, minBench);
        return false;
      }
      return false;
    });

    if (candidates.length === 0) {
      return minBench === Number.MAX_SAFE_INTEGER ? null : minBench;
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index].value;
  }

  /**
   * Mark the given token as exhausted until the given time and return the time at which it will be restored.
   * If the token is already on the bench, it's restore time is unaffected. Null is returned if the token
   * could not be found.
   **/
  exhaust(value, until) {
    const now = Date.now();
    let result = null;
    this.tokens.filter(token => token.value === value).forEach(token => {
      // If the token is not benched or the bench time is passed, update the bench time. Otherwise, leave it as is.
      if (!token.benchUntil || now > token.benchUntil) {
        result = token.benchUntil = until;
      } else {
        result = token.benchUntil;
      }
    });
    return result;
  }

  // desired can be an array of traits or an array of arrays of traits if there are fall backs
  _traitsMatch(given, desired) {
    if (desired.length === 0) {
      return true;
    }
    if (typeof desired[0] === 'string') {
      return desired.every(trait => { return given.indexOf(trait) !== -1; });
    }
    for (let i = 0; i < desired.length; i++) {
      const result = this._traitsMatch(given, desired[i]);
      if (result) {
        return result;
      }
    }
    return false;
  }
}

module.exports = TokenFactory;