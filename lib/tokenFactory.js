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
    const candidates = this.tokens.filter(token => {
      return this._traitsMatch(token.traits, traits) && (!token.benchUntil || token.benchUntil < Date.now());
    });

    if (candidates.length === 0) {
      return null;
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