/**
 * Barramento de eventos em tempo real (Server-Sent Events) para o painel.
 *
 * Usuários de restaurante só recebem eventos do próprio restaurante e nunca
 * os eventos internos da agência (conexão, caixa do simulador, respostas).
 */
const AGENCY_ONLY = new Set(['messaging:status', 'outbox', 'incoming']);

class EventBus {
  constructor() {
    this.clients = new Map(); // res → { restaurantId|null }
    setInterval(() => this.broadcastRaw(': ping\n\n'), 25000).unref();
  }

  attach(req, res, { restaurantId = null } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.set(res, { restaurantId });
    req.on('close', () => this.clients.delete(res));
  }

  publish(type, data) {
    const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, scope] of this.clients) {
      if (scope.restaurantId) {
        if (AGENCY_ONLY.has(type)) continue;
        if (!data || data.restaurantId !== scope.restaurantId) continue;
      }
      res.write(chunk);
    }
  }

  broadcastRaw(chunk) {
    for (const res of this.clients.keys()) res.write(chunk);
  }
}

module.exports = { EventBus };
