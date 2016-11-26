const appInsights = require('../lib/mockInsights');
const auth = require('../middleware/auth');
const express = require('express');
const jsonpatch = require('fast-json-patch');
const wrap = require('../middleware/promiseWrap');

let crawlerService = null;
const router = express.Router();

// router.patch('/', auth.validate, wrap(function* (request, response, next) {
router.patch('/', wrap(function* (request, response, next) {
  yield crawlerService.updateConfiguration(request.body);
  response.send(200);
}));

// router.get('/', auth.validate, function (request, response, next) {
router.get('/', function (request, response, next) {
  // Copy the current options and strip out our stuff like logger and reconfigure.
  // Be careful not to disrupt the actual options
  const result = Object.assign({}, crawlerService.options);
  Object.getOwnPropertyNames(result).forEach(key => {
    result[key] = Object.assign({}, result[key]);
    delete result[key].reconfigure;
    delete result[key].logger;
  });

  // Gets some of the live, non-configurable values and put them in at the root
  result.actualCount = crawlerService.status();
  const loop = crawlerService.loops[0];
  if (loop) {
    result.delay = loop.options.delay || 0;
  }

  response.status(200).send(result);
});

function setup(service) {
  crawlerService = service;
  return router;
}
module.exports = setup;