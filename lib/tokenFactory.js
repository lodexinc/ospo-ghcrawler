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

  getToken(traits) {
    // find all of the tokens that match the given traits and return a random on that is
    // not on the bench.  If no candidates are found return either the soonest time one will
    // come off the bench or null if there simply were none.
    let minBench = Number.MAX_SAFE_INTEGER;
    const candidates = this.tokens.filter(token => {
      if (this._traitsMatch(token.traits, traits)) {
        if (!token.benchUntil || Date.now() > token.benchUntil) {
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

  exhaust(value, until) {
    this.tokens.filter(token => token.value === value).forEach(token => token.benchUntil = until);
  }

  _traitsMatch(given, desired) {
    return desired.every(trait => { return given.indexOf(trait) !== -1; });
  }
}

module.exports = TokenFactory;