const expressSession = require('express-session');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const redis = require('./retryingRedis');
const azureAdOAuth2Strategy = require('passport-azure-ad-oauth2');
const config = require('painless-config');
const redisStore = require('connect-redis')(expressSession);
const express = require('express');

function initialize(app) {
  // if running on localhost, don't bother to validate
  if (config.get('NODE_ENV') === 'localhost' && !config.get('FORCE_AUTH')) {
    return;
  }

  app.use(expressSession({ store: new redisStore({ client: redis.client, prefix: `${config.get('NODE_ENV')}:session:` }), secret: config.get('WITNESS_SESSION_SECRET'), resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure Passport Module with Azure AD OAuth Strategy.
  const aadConfig = {
    clientID: config.get('WITNESS_AAD_CLIENT_ID'),
    clientSecret: config.get('WITNESS_AAD_CLIENT_SECRET'),
    callbackURL: config.get('WITNESS_AAD_CALLBACK_URL'),
    resource: config.get('WITNESS_AAD_RESOURCE'),
    useCommonEndpoint: true
  };

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

  passport.use('aad', new azureAdOAuth2Strategy(aadConfig, authCallback));

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

function validate(req, res, next) {
  // if running on localhost, don't bother to validate
  if (config.get('NODE_ENV') === 'localhost' && !config.get('FORCE_AUTH')) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }

  const authProviders = ['vso'];
  if ((req.header('X-Witness-FedRedirect') || '').toLowerCase() !== 'suppress') {
    req.session['redirectTo'] = req.originalUrl;
    authProviders.push('aad');
  }

  passport.authenticate(authProviders)(req, res, next);
}
exports.validate = validate;

function none(req, res, next) {
  return next();
}
exports.none = none;