/**
 * Barramento de eventos em tempo real (Server-Sent Events) para o painel.
 */
class EventBus {
  constructor() {
    this.clients = new Set();
    setInterval(() => this.broadcastRaw(': ping\n\n'), 25000).unref();
  }

  attach(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  publish(type, data) {
    this.broadcastRaw(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  broadcastRaw(chunk) {
    for (const res of this.clients) res.write(chunk);
  }
}

module.exports = { EventBus };
