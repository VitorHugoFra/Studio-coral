const express = require('express');
const path = require('path');

const BOT_UA = /whatsapp|facebookexternalhit|facebot|bot|crawler|spider|preview|slurp|telegram/i;

/**
 * Rotas públicas:
 *  • /r/:code                 → link rastreável (etapa 6 — Conversão)
 *  • /api/public/conversions  → registro de pedido (etapa 7 — Compra)
 *  • /t.js                    → script de conversão para o site do restaurante
 *  • /demo/:slug              → site próprio de demonstração do restaurante
 *  • /webhooks/whatsapp       → webhook da API Oficial (status e respostas)
 */
function createPublicRoutes(container) {
  const repos = container.resolve('repos');
  const dispatch = container.resolve('dispatch');
  const events = container.resolve('events');
  const messaging = container.resolve('messaging');
  const config = container.resolve('config');

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

  // ── Conversões ─────────────────────────────────────────────
  router.options('/api/public/conversions', cors);
  router.post('/api/public/conversions', cors, wrap(async (req, res) => {
    const { ref, value, orderId, items, restaurantSlug, customerName } = req.body || {};
    const message = ref ? await repos.messages.byCode(String(ref)) : null;
    const restaurant = message
      ? await repos.restaurants.get(message.restaurantId)
      : await repos.restaurants.bySlug(String(restaurantSlug || ''));
    if (!restaurant) return res.status(404).json({ error: 'Referência ou restaurante não encontrado.' });

    // Número de pedido repetido no restaurante é ignorado (índice único, sem corrida)
    const conversion = await repos.conversions.createUnique({
      restaurantId: restaurant.id,
      campaignId: message?.campaignId || null,
      messageId: message?.id || null,
      contactId: message?.contactId || null,
      code: message?.code || null,
      customerName: customerName || message?.name || null,
      orderId: orderId ? String(orderId) : null,
      value: Math.min(Math.max(0, Number(value) || 0), 9999999999.99), // limite do numeric(12,2) do banco
      items: Array.isArray(items) ? items.slice(0, 50) : [],
    });
    if (!conversion) return res.json({ ok: true, duplicated: true });
    if (message && !message.convertedAt) await repos.messages.markConverted(message.id, conversion.createdAt);
    events.publish('conversion', { ...conversion, restaurant: restaurant.name });
    return res.status(201).json({ ok: true, id: conversion.id });
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
