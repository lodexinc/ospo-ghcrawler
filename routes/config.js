const express = require('express');
const Q = require('q');
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

// router.patch('/', auth.validate, wrap(function* (request, response, next) {
router.patch('/', wrap(function* (request, response, next) {
  const sorted = collectPatches(request.body);
  yield Q.all(Object.getOwnPropertyNames(sorted).map(key => {
    return crawlerService.options[key]._emitter.apply(sorted[key]);
  }));
  response.sendStatus(200);
}));

// router.get('/', auth.validate, function (request, response, next) {
router.get('/', wrap(function* (request, response, next) {
  const config = yield configService.getAll().then(result => {
    result = Object.assign({}, result);
    Object.getOwnPropertyNames(result).forEach(key => {
      result[key] = Object.assign({}, result[key]);
      delete result[key]._emitter;
      delete result[key].logger;
    });
    return result;
  });

  response.json(config).status(200).end();
}));

function setup(service) {
  crawlerService = service;
  return router;
}

function collectPatches(patches) {
  return patches.reduce((result, patch) => {
    const segments = patch.path.split('/');
    const key = segments[1];
    result[key] = result[key] || [];
    patch.path = '/' + segments.slice(2).join('/');
    result[key].push(patch);
    return result;
  }, {});
}

module.exports = setup;