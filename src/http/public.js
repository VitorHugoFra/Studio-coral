const express = require('express');
const path = require('path');

const BOT_UA = /whatsapp|facebookexternalhit|facebot|bot|crawler|spider|preview|slurp|telegram/i;

/**
 * Rotas públicas:
 *  • /r/:code                 → link rastreável (etapa 6 — Conversão)
 *  • /api/public/orders       → pedido feito no site de demonstração (checkout)
 *  • /api/public/orders/:code → andamento do pedido, para a página /pedido/:code
 *  • /api/public/conversions  → pedido informado por um site externo (etapa 7 — Compra)
 *  • /t.js                    → script de conversão para o site do restaurante
 *  • /demo/:slug              → site próprio de demonstração do restaurante
 *  • /pedido/:code            → acompanhamento do pedido pelo cliente final
 *  • /webhooks/whatsapp       → webhook da API Oficial (status e respostas)
 */
function createPublicRoutes(container) {
  const repos = container.resolve('repos');
  const dispatch = container.resolve('dispatch');
  const events = container.resolve('events');
  const messaging = container.resolve('messaging');
  const config = container.resolve('config');
  const orders = container.resolve('orders');

  const router = express.Router();
  const publicDir = path.join(__dirname, '..', '..', 'public');
  const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  const cors = (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };

  // ── Link rastreável ────────────────────────────────────────
  router.get('/r/:code', wrap(async (req, res) => {
    const message = await repos.messages.byCode(req.params.code);
    if (!message) return res.redirect(302, '/');

    const [campaign, restaurant] = await Promise.all([repos.campaigns.get(message.campaignId), repos.restaurants.get(message.restaurantId)]);
    const destination = new URL(dispatch.destinationFor(campaign, restaurant), config.publicUrl);
    destination.searchParams.set('sc_ref', message.code);
    destination.searchParams.set('utm_source', 'whatsapp');
    destination.searchParams.set('utm_medium', 'studio_coral');
    if (campaign) destination.searchParams.set('utm_campaign', campaign.name);

    // Pré-visualização de link do WhatsApp/redes não conta como clique
    if (!BOT_UA.test(req.headers['user-agent'] || '')) {
      const clicked = await repos.messages.registerClick(message.id, new Date().toISOString());
      events.publish('click', { campaignId: message.campaignId, restaurantId: message.restaurantId, messageId: message.id, name: message.name });
      events.publish('message:update', dispatch.publicMessage(clicked || message));
    }
    return res.redirect(302, destination.toString());
  }));

  // Erros de validação (400) e "não encontrado" (404) com a mensagem; o resto segue para o tratador final
  const userError = (fn) => wrap(async (req, res) => {
    try {
      return await fn(req, res);
    } catch (err) {
      if (err.status === 400 || err.status === 404) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  });

  // ── Pedidos ────────────────────────────────────────────────
  router.post('/api/public/orders', userError(async (req, res) => {
    const { order, duplicated } = await orders.placeSiteOrder(req.body || {});
    return res.status(duplicated ? 200 : 201).json({
      ok: true,
      ...(duplicated ? { duplicated: true } : {}),
      id: order.id,
      number: order.number,
      trackingCode: order.trackingCode,
      trackingUrl: orders.trackingUrl(order),
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.value,
    });
  }));

  router.get('/api/public/orders/:code', wrap(async (req, res) => {
    const order = await repos.orders.byTrackingCode(req.params.code);
    const restaurant = order && await repos.restaurants.get(order.restaurantId);
    if (!order || !restaurant) return res.status(404).json({ error: 'Pedido não encontrado.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json(orders.trackingView(order, restaurant));
  }));

  router.get('/pedido/:code', (req, res) => res.sendFile(path.join(publicDir, 'pedido.html')));

  // ── Pedidos de sites externos (script /t.js) ───────────────
  router.options('/api/public/conversions', cors);
  router.post('/api/public/conversions', cors, userError(async (req, res) => {
    const order = await orders.recordConversion(req.body || {});
    if (!order) return res.json({ ok: true, duplicated: true });
    return res.status(201).json({ ok: true, id: order.id });
  }));

  router.get('/api/public/restaurants/:slug', cors, wrap(async (req, res) => {
    const r = await repos.restaurants.bySlug(req.params.slug);
    if (!r) return res.status(404).json({ error: 'Restaurante não encontrado' });
    const { id, name, slug, tagline, segment, city, color, coupon, menu, address, hours, phone, instagram, banners, logoUrl } = r;
    return res.json({ id, name, slug, tagline, segment, city, color, coupon, menu, address, hours, phone, instagram, banners: banners || [], logoUrl: logoUrl || null });
  }));

  router.get('/api/public/ref/:code', cors, wrap(async (req, res) => {
    const m = await repos.messages.byCode(req.params.code);
    if (!m) return res.status(404).json({});
    const campaign = await repos.campaigns.get(m.campaignId);
    return res.json({ firstName: (m.name || '').split(/\s+/)[0], campaign: campaign?.name || null, coupon: campaign?.coupon || null });
  }));

  // Script para sites de restaurantes: guarda o sc_ref e expõe StudioCoral.conversion(valor, pedido)
  router.get('/t.js', (req, res) => {
    res.type('application/javascript').send(`(function(){
  var K='sc_ref',API='${config.publicUrl}/api/public/conversions';
  try{var p=new URLSearchParams(location.search).get(K);if(p)localStorage.setItem(K,JSON.stringify({ref:p,at:Date.now()}));}catch(e){}
  function ref(){try{var v=JSON.parse(localStorage.getItem(K)||'null');if(v&&Date.now()-v.at<7*864e5)return v.ref;}catch(e){}return null;}
  window.StudioCoral={ref:ref,conversion:function(value,orderId,items){var r=ref();if(!r)return Promise.resolve(null);
    return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:r,value:value,orderId:orderId,items:items||[]})}).then(function(x){return x.json();});}};
})();`);
  });

  // ── Site de demonstração do restaurante ────────────────────
  router.get('/demo/:slug', wrap(async (req, res) => {
    if (!(await repos.restaurants.bySlug(req.params.slug))) return res.status(404).sendFile(path.join(publicDir, 'index.html'));
    return res.sendFile(path.join(publicDir, 'demo.html'));
  }));

  // ── Webhook da API Oficial (Meta) ──────────────────────────
  router.get('/webhooks/whatsapp', (req, res) => {
    const provider = messaging.provider('whatsapp-cloud') || messaging.instance('whatsapp-cloud');
    const challenge = provider.verifyWebhook(req.query);
    return challenge ? res.status(200).send(challenge) : res.sendStatus(403);
  });

  router.post('/webhooks/whatsapp', (req, res) => {
    const provider = messaging.instance('whatsapp-cloud');
    if (!provider.isValidSignature(req.rawBody, req.headers['x-hub-signature-256'])) return res.sendStatus(401);
    provider.handleWebhook(req.body);
    return res.sendStatus(200);
  });

  return router;
}

module.exports = { createPublicRoutes };
