class CrawlQueue {
  constructor() {
    this.queue = [];
  }

  push(item) {
    this.queue.push(item);
  }

  pop() {
    return this.queue.shift();
  }
}

module.exports = CrawlQueue;