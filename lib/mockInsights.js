const appInsights = require("applicationinsights");

class MockInsights {
  constructor(client = null) {
    this.client = client;
  }

  static setup(key = null, echo = false) {
    if (!key || key === 'mock') {
      appInsights.client = new MockInsights();
    } else {
      appInsights.setup(key).start();
      if (echo) {
        appInsights.client = new MockInsights(appInsights.client);
      }
    }
  }

  trackEvent(name, properties, measurements) {
    console.log(`Event: ${name}, properties: ${JSON.stringify(properties)}`);
    if (this.client) {
      this.client.trackEvent(name, properties, measurements);
    }
  }

  trackException(exception, properties) {
    const hasProperties = properties && Object.keys(properties).length > 0;
    const propertyString = hasProperties ? `${JSON.stringify(properties)}` : '';
    console.error(`Exception: ${exception.message}${propertyString}`);
    if (this.client) {
      this.client.trackException(exception, properties);
    }
  }

  trackMetric(name, value, count, min, max, stdDev) {
    console.log(`Metric: ${name} = ${value}`);
    if (this.client) {
      this.client.trackMetric(name, value, count, min, max, stdDev);
    }
  }

  trackRequest(request, response, properties) {
    console.log('Request: ');
    if (this.client) {
      this.client.trackRequest(request, response, properties);
    }
  }

  trackTrace(message, severityLevel = 1, properties = null) {
    const severities = ['Verbose', 'Info', 'Warning', 'Error', 'Critical'];
    const hasProperties = properties && Object.keys(properties).length > 0;
    const propertyString = hasProperties ? `${JSON.stringify(properties)}` : '';
    console.log(`Trace: [${severities[severityLevel]}] ${message}${propertyString}`);
    if (this.client) {
      this.client.trackTrace(message, severityLevel, properties);
    }
  }

  trackDependency(name, commandName, elapsedTimeMs, success, dependencyTypeName, properties, dependencyKind, async, dependencySource) {
    console.log(`Dependency: ${name}`);
    if (this.client) {
      this.client.trackDependency(name, commandName, elapsedTimeMs, success, dependencyTypeName, properties, dependencyKind, async, dependencySource);
    }
  }
}
module.exports = MockInsights;