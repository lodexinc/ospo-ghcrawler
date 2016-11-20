const config = require('painless-config');
const OspoCrawler = require('../../../../lib/ospoCrawler');

OspoCrawler.run(parseInt(config.get('GHCRAWLER_LOOP_COUNT'), 10) || 5);