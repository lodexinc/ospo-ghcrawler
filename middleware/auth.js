// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const expressSession = require('express-session');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const azureAdOAuth2Strategy = require('passport-azure-ad-oauth2');
const redisStore = require('connect-redis')(expressSession);
const express = require('express');

let config = null;

function initialize(app, givenConfig) {
  config = givenConfig;
  // if running on localhost, don't bother to validate
  if (process.env.NODE_ENV === 'localhost' && !config.forceAuth) {
    return;
  }

  // TODO temporarily skip using auth and rely on a token header or local host
  if (process.env.NODE_ENV) return;

  // const redis = new RetryingRedis(config.redisUrl, config.redisAccessKey, config.redisPort);
  // app.use(expressSession({ store: new redisStore({ client: redis.client, prefix: `${process.env.NODE_ENV}:session:` }), secret: config.sessionSecret, resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());

  function authCallback(accessToken, refreshToken, params, profile, done) {
    const waadProfile = jwt.decode(params.id_token);
    const user = {
      provider: 'azure-ad',
      id: waadProfile.upn,
      displayName: waadProfile.given_name,
      name: { familyName: waadProfile.family_name, givenName: waadProfile.given_name, middleName: '' },
      emails: [{ value: waadProfile.upn, type: 'work' }],
      photos: []
    };
    done(null, user);
  }

  // TODO add back VSO .use
  passport.use('aad', new azureAdOAuth2Strategy(config.aadConfig, authCallback));

  passport.serializeUser(function (user, done) {
    done(null, user);
  });

  passport.deserializeUser(function (user, done) {
    done(null, user);
  });

  app.get('/auth/callback',
    passport.authenticate('aad', { failureRedirect: '/' }),
    function (req, res) {
      res.redirect(req.session['redirectTo'] || '/help');
    }
  );
}
exports.initialize = initialize;

function validate(request, response, next) {
  // if running on localhost, don't bother to validate
  if (process.env.NODE_ENV === 'localhost' && !config.forceAuth) {
    return next();
  }

  // TODO temporary poor man's token management
  if (request.header('X-token') === 'test1') {
    return next();
  }

  if (request.isAuthenticated()) {
    return next();
  }

  const authProviders = ['vso'];
  if ((request.header('X-Witness-FedRedirect') || '').toLowerCase() !== 'suppress') {
    request.session['redirectTo'] = request.originalUrl;
    authProviders.push('aad');
  }

  passport.authenticate(authProviders)(request, response, next);
}
exports.validate = validate;

function none(request, response, next) {
  return next();
}
exports.none = none;