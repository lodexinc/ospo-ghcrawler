const EventEmitter = require('events');

class ObjectObserver extends EventEmitter {
  constructor(object) {
    super();
    this.object = object;
    this.results = [];
    object.on = this._on.bind(this);
    object.notify = this._notify.bind(this);
  }

  _on(name, listener) {
    this.on(name, changes => this.results.push(listener(changes)));
  }

  _notify(changes) {
    this.results = [];
    this.emit('change', changes);
    const result = this.results.filter(value => value);
    this.results = [];
    return result;
  }
}

module.exports = ObjectObserver;