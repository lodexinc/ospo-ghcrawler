// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const express = require('express');
const Q = require('q');
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

// router.patch('/', auth.validate, wrap(function* (request, response, next) {
router.patch('/', wrap(function* (request, response, next) {
  const sorted = collectPatches(request.body);
  yield Q.all(Object.getOwnPropertyNames(sorted).map(key => {
    return crawlerService.options[key]._config.apply(sorted[key]);
  }));
  response.sendStatus(200);
}));

// router.get('/', auth.validate, function (request, response, next) {
router.get('/', (request, response, next) => {
  result = Object.assign({}, crawlerService.options);
  Object.getOwnPropertyNames(result).forEach(subsystemName => {
    result[subsystemName] = Object.assign({}, result[subsystemName]);
    delete result[subsystemName]._config;
    delete result[subsystemName].logger;
  });
  response.json(result).status(200).end();
});

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