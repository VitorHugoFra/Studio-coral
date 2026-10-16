/* Studio Coral · Painel de campanhas (Alpine.js) */

// ── Utilidades ──────────────────────────────────────────────
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new CustomEvent('coral:unauthorized'));
  }
  if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente novamente.');
  return data;
}

const nf = new Intl.NumberFormat('pt-BR');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = {
  int: (n) => nf.format(Math.round(n || 0)),
  money: (n) => money.format(n || 0),
  pct: (n) => `${String(Math.round((n || 0) * 10) / 10).replace('.', ',')}%`,
  date: (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'),
  dateTime: (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'),
  time: (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''),
  rel(iso) {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return `há ${Math.floor(s / 86400)} d`;
  },
  phone(p) {
    const d = String(p || '').replace(/\D/g, '');
    const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
  },
};

const APPROVAL = { pending: 'Aguardando aprovação', approved: 'Aprovada', changes: 'Ajustes pedidos' };
const STATUS = { draft: 'Rascunho', scheduled: 'Agendada', sending: 'Enviando', paused: 'Pausada', completed: 'Concluída', canceled: 'Cancelada' };
const MSG_STATUS = { queued: 'Na fila', sending: 'Enviando', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falhou', skipped: 'Ignorada' };
const CONN = { disconnected: 'Desconectado', starting: 'Conectando…', qr: 'Aguardando QR Code', connected: 'Conectado', error: 'Erro' };
const ORDER_STATUS = { new: 'Novo', preparing: 'Em preparo', dispatched: 'Saiu para entrega', completed: 'Concluído', canceled: 'Cancelado' };
const ORDER_CLASS = { new: 'sending', preparing: 'scheduled', dispatched: 'delivered', completed: 'completed', canceled: 'failed' };
const ORDER_SOURCE = { site: 'Site', campaign: 'Campanha', import: 'Planilha', referral: 'Indicação' };
const ORDER_NEXT = { new: 'preparing', preparing: 'dispatched', dispatched: 'completed' };
const ORDER_COLUMN_LABELS = { orderId: 'número do pedido', date: 'data', name: 'cliente', phone: 'telefone', total: 'total', discount: 'desconto', neighborhood: 'bairro', items: 'itens' };
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const OBJECTIVES = ['Reativar clientes inativos', 'Aumentar pedidos no fim de semana', 'Aumentar pedidos no almoço', 'Divulgar lançamento de produto', 'Data comemorativa', 'Recompensar melhores clientes', 'Fidelização', 'Oportunidade do clima'];
const EMOJIS = ['😋', '🔥', '🎉', '💛', '👉', '🍕', '🍝', '🍔', '🍣', '🥗', '🍲', '🍰', '🎁', '⏰', '🛵', '✨'];

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Formatação estilo WhatsApp (*negrito*, _itálico_, ~riscado~) + links. */
function waFormat(text) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
}

/** Mesmo algoritmo do TemplateService do servidor (para pré-visualização instantânea). */
function renderTemplate(template, vars, seed = 0) {
  let out = String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
  let i = 0;
  let prev;
  do {
    prev = out;
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts) => {
      const list = opts.split('|');
      i += 1;
      return list[(seed + i) % list.length];
    });
  } while (out !== prev);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function parseContactsText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) || ';';
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
  let header = rows[0].map((h) => h.toLowerCase());
  let body = rows;
  const hasHeader = header.some((h) => /nome|name|telefone|phone|celular|whats/.test(h));
  if (hasHeader) body = rows.slice(1); else header = ['nome', 'telefone', 'tags'];
  const idx = (re, fallback) => { const i = header.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
  const iName = idx(/nome|name/, 0);
  const iPhone = idx(/tel|phone|cel|whats|n[uú]mero/, 1);
  const iTags = idx(/tag|segment|grupo/, 2);
  return body.map((r) => ({ name: r[iName] || '', phone: r[iPhone] || '', tags: (r[iTags] || '').split(/[|/]/).map((t) => t.trim()).filter(Boolean) }))
    .filter((r) => r.phone);
}

/** Uma linha de CSV respeitando aspas ("Pizza, grande";"45,90"). */
function splitCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Planilha de pedidos (caixa, iFood…) → linhas com as colunas que o servidor entende. Só separa as colunas
 * pelo cabeçalho: a validação de cada linha é do servidor. `line` é o número da linha no arquivo.
 */
// Para cada coluna, os padrões do mais exato para o mais solto (cabeçalho já sem acentos e em minúsculas);
// exclude evita confundir "data do pedido" com o número do pedido e "telefone do cliente" com o nome
const ORDER_COLUMNS = [
  ['date', [/^data$|^date$/, /data|date|dia|hora/]],
  ['phone', [/tel|fone|phone|cel|whats/]],
  ['orderId', [/^(n(umero|o|º)?|id|codigo|cod)\.?( do)? pedido/, /^pedido$/, /^(n(umero|o|º)?|id|codigo|order)$/, /pedido|numero|codigo|^id\b/], /data|date|valor|total|item|cliente/],
  ['name', [/^(nome|cliente|name)$/, /nome|cliente|name/]],
  ['discount', [/desconto|discount/]],
  ['total', [/^total$|^valor$/, /valor total|total do pedido|total pago|valor pago/, /total|valor|value/], /sub ?total|taxa|frete|entrega/],
  ['neighborhood', [/bairro|neighbo/]],
  ['items', [/ite(m|ns)|produto/]],
];
function parseOrdersText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l, i) => ({ text: l, line: i + 1 })).filter((l) => l.text.trim());
  if (!lines.length) return { rows: [], columns: [] };
  const head = lines[0].text;
  const sep = [';', '\t', ','].map((s) => [s, head.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitCsvLine(head, sep).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const index = {};
  for (const [key, patterns, exclude] of ORDER_COLUMNS) {
    const taken = new Set(Object.values(index));
    for (const re of patterns) {
      const i = header.findIndex((h, j) => !taken.has(j) && re.test(h) && !(exclude && exclude.test(h)));
      if (i >= 0) { index[key] = i; break; }
    }
  }
  const hasHeader = index.orderId !== undefined && index.total !== undefined;
  const body = hasHeader ? lines.slice(1) : lines;
  // Sem cabeçalho reconhecido: pedido; data; cliente; telefone; total; itens
  const map = hasHeader ? index : { orderId: 0, date: 1, name: 2, phone: 3, total: 4, items: 5 };
  const rows = body.map(({ text: t, line }) => {
    const cells = splitCsvLine(t, sep);
    const row = { line };
    for (const [key, i] of Object.entries(map)) row[key] = cells[i] ?? '';
    return row;
  });
  // Na ordem da planilha de exemplo, para a pessoa conferir o que foi reconhecido
  return { rows, columns: Object.keys(ORDER_COLUMN_LABELS).filter((k) => map[k] !== undefined) };
}

/** Avisinho sonoro de pedido novo (o navegador só toca depois de um clique na página, como o login). */
function ding() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.32);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* sem áudio */ }
}

function trendChart(series, hover) {
  const W = 680; const H = 230; const P = { l: 36, r: 12, t: 14, b: 28 };
  const max = Math.max(4, ...series.map((d) => Math.max(d.sent, d.read, d.clicks)));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, series.length - 1);
  const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b);
  const line = (k) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('');
  const bw = Math.max(4, (W - P.l - P.r) / series.length * 0.32);
  const maxOrders = Math.max(1, ...series.map((d) => d.orders));
  let s = `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Evolução diária de envios, leituras, cliques e pedidos">`;
  for (let g = 0; g <= 4; g += 1) {
    const v = (nice / 4) * g;
    s += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3d2bf"/>`;
    s += `<text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`;
  }
  series.forEach((d, i) => {
    if (d.orders) {
      const h = (d.orders / maxOrders) * 46;
      s += `<rect x="${x(i) - bw / 2}" y="${H - P.b - h}" width="${bw}" height="${h}" fill="#73350c"/>`;
    }
    if (i % 2 === 0 || series.length < 10) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${d.day.slice(8, 10)}/${d.day.slice(5, 7)}</text>`;
  });
  s += `<path d="${line('sent')}" fill="none" stroke="#092b03" stroke-width="2"/>`;
  s += `<path d="${line('read')}" fill="none" stroke="#6f9a5f" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  s += `<path d="${line('clicks')}" fill="none" stroke="#d99a00" stroke-width="2.2"/>`;
  if (hover !== null && series[hover]) {
    s += `<line x1="${x(hover)}" x2="${x(hover)}" y1="${P.t}" y2="${H - P.b}" stroke="#73350c" stroke-opacity=".3"/>`;
    s += `<circle cx="${x(hover)}" cy="${y(series[hover].sent)}" r="3.5" fill="#092b03"/>`;
    s += `<circle cx="${x(hover)}" cy="${y(series[hover].clicks)}" r="3.5" fill="#d99a00"/>`;
  }
  return `${s}</svg>`;
}

// ── Componente principal ───────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.data('coral', () => ({
    fmt, STATUS, APPROVAL, MSG_STATUS, CONN, OBJECTIVES, EMOJIS, waFormat, ORDER_STATUS, ORDER_CLASS, ORDER_SOURCE, ORDER_COLUMN_LABELS, MONTH_NAMES, WEEKDAYS,
    icon: (name, size) => window.icon(name, size),

    booted: false,
    user: null,
    login: { email: '', password: '', loading: false, error: '' },
    route: { name: 'painel', params: {} },
    navOpen: false,

    restaurants: [],
    scope: localStorage.getItem('sc_scope') || '',
    meta: { variables: [], ideas: [], publicUrl: '' },
    conn: { state: 'disconnected', label: '' },
    providers: [],
    settings: {},
    toasts: [],
    loading: false,

    dashboard: null,
    chartHover: null,

    contacts: [],
    contactTags: [],
    contactFilter: { search: '', tag: '', status: '' },
    contactFilters: {},
    contactProfile: null,
    filterModal: null,
    contactModal: null,
    importModal: null,

    restaurantModal: null,
    restaurantTab: 'diagnostico',

    board: [],
    referralData: { links: [], coupons: [] },
    orders: [],
    orderFilter: { search: '', status: '', source: '', from: '', to: '' },
    orderModal: null,
    orderImport: null,
    newOrders: 0,

    campaigns: [],
    campaignFilter: 'all',
    editor: null,
    detail: null,
    detailMessages: [],
    detailFilter: { status: '', search: '' },

    outbox: [],
    users: [],
    newUser: null,
    reportState: { restaurantId: '', month: '', months: [] },
    approvalNote: '',
    passwordModal: null,
    uploads: [],
    uploading: false,
    dragOver: false,
    testPhone: localStorage.getItem('sc_test_phone') || '',
    confirmBox: null,
    es: null,
    refreshTimer: null,

    // ── Ciclo de vida ──────────────────────────────────────
    async init() {
      window.addEventListener('coral:unauthorized', () => { this.user = null; this.closeEvents(); });
      window.addEventListener('hashchange', () => this.onRoute());
      try {
        const { user } = await api('/auth/me');
        this.user = user;
        await this.afterLogin();
      } catch { /* precisa de login */ }
      this.booted = true;
    },

    async doLogin() {
      this.login.loading = true;
      this.login.error = '';
      try {
        const { user } = await api('/auth/login', { method: 'POST', body: { email: this.login.email, password: this.login.password } });
        this.user = user;
        this.login.password = '';
        await this.afterLogin();
      } catch (err) {
        this.login.error = err.message;
      } finally {
        this.login.loading = false;
      }
    },

    async logout() {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      this.closeEvents();
      this.user = null;
    },

    get isRestaurant() { return this.user?.role === 'restaurant'; },

    async afterLogin() {
      const [meta, restaurants, settings] = await Promise.all([api('/meta'), api('/restaurants'), api('/settings')]);
      this.meta = meta;
      this.restaurants = restaurants;
      this.settings = settings;
      if (this.isRestaurant) {
        this.scope = this.user.restaurantId;
      } else {
        this.applyStatus(await api('/messaging/status'));
        if (this.scope && !restaurants.find((r) => r.id === this.scope)) this.scope = '';
      }
      this.openEvents();
      this.countNewOrders().catch(() => {});
      if (!location.hash) location.hash = '#/painel';
      await this.onRoute();
    },

    // ── Tempo real (SSE) ───────────────────────────────────
    openEvents() {
      this.closeEvents();
      const es = new EventSource('/api/events');
      es.addEventListener('messaging:status', (e) => this.applyStatus(JSON.parse(e.data)));
      es.addEventListener('campaign:progress', () => this.softRefresh());
      es.addEventListener('message:update', (e) => {
        const m = JSON.parse(e.data);
        if (this.detail && m.campaignId === this.detail.id) {
          const i = this.detailMessages.findIndex((x) => x.id === m.id);
          if (i >= 0) this.detailMessages.splice(i, 1, m);
        }
      });
      es.addEventListener('outbox', (e) => {
        this.outbox.unshift(JSON.parse(e.data));
        this.outbox = this.outbox.slice(0, 60);
      });
      es.addEventListener('click', (e) => {
        const d = JSON.parse(e.data);
        this.toast(`${d.name || 'Um cliente'} abriu o link da campanha.`, 'Clique');
        this.softRefresh();
      });
      es.addEventListener('order', (e) => {
        const o = JSON.parse(e.data);
        const where = this.isRestaurant ? '' : ` em ${o.restaurant}`;
        if (o.status === 'new') {
          this.newOrders += 1;
          this.toast(`#${o.number} · ${o.customerName || 'Cliente'}, ${fmt.money(o.value)}${where}.`, 'Novo pedido');
          if (this.route.name === 'pedidos') ding();
        } else {
          this.toast(`${o.customerName || 'Cliente'}, ${fmt.money(o.value)}${where}.`, 'Pedido no site');
        }
        this.softRefresh();
      });
      es.addEventListener('order:update', (e) => {
        const o = JSON.parse(e.data);
        if (this.orderModal?.id === o.id) this.orderModal = { ...this.orderModal, ...o };
        if (this.route.name === 'pedidos') this.softRefresh();
        else this.countNewOrders().catch(() => {});
      });
      es.addEventListener('approval', (e) => {
        const d = JSON.parse(e.data);
        const st = d.approval?.status;
        if (this.isRestaurant && st === 'pending') this.toast(`“${d.name}” está esperando sua aprovação.`, 'Nova campanha para aprovar');
        if (!this.isRestaurant && st === 'approved') this.toast(`O restaurante aprovou “${d.name}”.`, 'Campanha aprovada');
        if (!this.isRestaurant && st === 'changes') this.toast(`O restaurante pediu ajustes em “${d.name}”: ${d.approval.note}`, 'Ajustes pedidos');
        this.softRefresh();
      });
      es.addEventListener('incoming', (e) => {
        const d = JSON.parse(e.data);
        const who = d.contacts?.[0] || fmt.phone(d.from);
        this.toast(d.optOut ? `${who} respondeu SAIR e foi descadastrado.` : `${who}: “${d.body}”`, d.optOut ? 'Descadastro' : 'Resposta');
        this.softRefresh();
      });
      this.es = es;
    },

    closeEvents() {
      this.es?.close();
      this.es = null;
    },

    softRefresh() {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.loadRoute(true), 600);
    },

    applyStatus(s) {
      if (!s) return;
      if (s.providers) this.providers = s.providers;
      this.conn = { ...this.conn, ...s };
      this.providers = this.providers.map((p) => ({ ...p, active: p.key === s.provider, state: p.key === s.provider ? s.state : p.state }));
    },

    toast(text, title = '', kind = '') {
      const id = Math.random().toString(36).slice(2);
      this.toasts.push({ id, text, title, kind });
      setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 5200);
    },
    error(err) { this.toast(err.message || String(err), 'Não foi possível concluir', 'error'); },

    // ── Rotas ──────────────────────────────────────────────
    go(hash) { location.hash = hash; this.navOpen = false; },

    async onRoute() {
      const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
      let [name = 'painel', id, action] = parts;
      const RESTAURANT_PAGES = ['painel', 'pedidos', 'indicacoes', 'campanhas', 'relatorios'];
      if (this.isRestaurant && (!RESTAURANT_PAGES.includes(name) || id === 'nova' || action === 'editar')) {
        name = 'painel'; id = undefined; action = undefined;
        history.replaceState(null, '', '#/painel');
      }
      this.route = { name, params: { id, action } };
      this.detail = null;
      this.contactProfile = null;
      this.editor = null;
      window.scrollTo({ top: 0 });
      await this.loadRoute();
    },

    async loadRoute(silent = false) {
      if (!this.user) return;
      const { name, params } = this.route;
      if (!silent) this.loading = true;
      try {
        if (name === 'painel') { await this.loadDashboard(); if (this.isRestaurant) await this.loadCampaigns(); }
        if (name === 'restaurantes') this.restaurants = await api('/restaurants');
        if (name === 'contatos') { if (params.id) await this.loadContactProfile(params.id); else await this.loadContacts(); }
        if (name === 'pedidos') await this.loadOrders();
        if (name === 'indicacoes') await this.loadReferrals();
        if (name === 'campanhas') {
          if (!params.id) await this.loadCampaigns();
          else if (params.id === 'nova') { if (!silent) await this.newCampaign(); }
          else if (params.action === 'editar') { if (!silent) await this.openEditor(params.id); }
          else await this.loadDetail(params.id, silent);
        }
        if (name === 'conexao') {
          this.applyStatus(await api('/messaging/status'));
          if (!silent) this.outbox = await api('/messaging/outbox');
        }
        if (name === 'configuracoes' && !silent) this.settings = await api('/settings');
        if (name === 'relatorios' && !silent) await this.loadReports();
      } catch (err) {
        if (!silent) this.error(err);
      } finally {
        this.loading = false;
      }
    },

    setScope(id) {
      if (this.isRestaurant) return;
      this.scope = id;
      localStorage.setItem('sc_scope', id);
      this.loadRoute();
    },

    get scopeName() {
      return this.restaurants.find((r) => r.id === this.scope)?.name || 'Todos os restaurantes';
    },

    get today() {
      return new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    },

    restaurantById(id) { return this.restaurants.find((r) => r.id === id) || null; },

    initials(name) {
      return String(name || '?').split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    },

    // ── Painel ─────────────────────────────────────────────
    async loadDashboard() {
      this.dashboard = await api(`/dashboard?days=14${this.scope ? `&restaurantId=${this.scope}` : ''}`);
    },

    get trendSvg() {
      return this.dashboard ? trendChart(this.dashboard.series, this.chartHover) : '';
    },

    chartMove(ev) {
      const rect = ev.currentTarget.getBoundingClientRect();
      const n = this.dashboard.series.length;
      const rel = (ev.clientX - rect.left) / rect.width;
      const i = Math.round(((rel * 680 - 36) / (680 - 48)) * (n - 1));
      this.chartHover = Math.min(n - 1, Math.max(0, i));
    },

    get hoverDay() {
      return this.dashboard && this.chartHover !== null ? this.dashboard.series[this.chartHover] : null;
    },

    funnel(t) {
      if (!t) return [];
      const base = Math.max(1, t.sent);
      return [
        { label: 'Enviadas', value: t.sent, color: 'var(--green)' },
        { label: 'Entregues', value: t.delivered, color: 'var(--green)' },
        { label: 'Lidas', value: t.read, color: 'var(--green-3)' },
        { label: 'Clicaram', value: t.clicked, color: '#d99a00' },
        { label: 'Pediram', value: t.orders, color: 'var(--brown)' },
      ].map((s, i, arr) => {
        const width = Math.max(0, (s.value / base) * 100);
        return { ...s, width, low: width < 18, rate: i ? (arr[i - 1].value ? Math.round((s.value / arr[i - 1].value) * 100) : 0) : 100 };
      });
    },

    // ── Restaurantes ───────────────────────────────────────
    blankRestaurant() {
      return { name: '', segment: '', city: '', siteUrl: '', phone: '', address: '', hours: '', instagram: '', tagline: '', color: '#73350c', coupon: '', audience: '', products: '', goals: '', tone: '', menu: [], banners: [], requireApproval: true };
    },

    editRestaurant(r) {
      this.restaurantTab = 'diagnostico';
      this.loadUsers(r?.id).catch(() => {});
      this.restaurantModal = JSON.parse(JSON.stringify(r || this.blankRestaurant()));
      // Programa de indicação: campos em branco quando ainda não foi configurado
      this.restaurantModal.referral = { ...this.blankReferral(), ...(this.restaurantModal.referral || {}) };
    },

    addMenuItem() {
      this.restaurantModal.menu.push({ id: Math.random().toString(36).slice(2, 8), category: 'Pratos', name: '', description: '', price: 0 });
    },

    async saveRestaurant() {
      const r = this.restaurantModal;
      try {
        r.menu = (r.menu || []).filter((m) => m.name).map((m) => ({ ...m, price: Number(String(m.price).replace(',', '.')) || 0 }));
        const saved = r.id ? await api(`/restaurants/${r.id}`, { method: 'PUT', body: r }) : await api('/restaurants', { method: 'POST', body: r });
        this.restaurants = await api('/restaurants');
        this.restaurantModal = null;
        this.toast(`${saved.name} salvo.`);
      } catch (err) { this.error(err); }
    },

    deleteRestaurant(r) {
      this.confirm(`Excluir “${r.name}”?`, 'Todos os contatos, campanhas e métricas deste restaurante serão apagados.', async () => {
        await api(`/restaurants/${r.id}`, { method: 'DELETE' });
        if (this.scope === r.id) this.setScope('');
        this.restaurants = await api('/restaurants');
        this.restaurantModal = null;
      });
    },

    // ── Contatos ───────────────────────────────────────────
    async loadContacts() {
      const q = new URLSearchParams({ ...(this.scope ? { restaurantId: this.scope } : {}), ...Object.fromEntries(Object.entries(this.contactFilter).filter(([, v]) => v)) });
      if (Object.keys(this.contactFilters).length) q.set('filters', JSON.stringify(this.contactFilters));
      const [list, tags] = await Promise.all([api(`/contacts?${q}`), api(`/contacts/tags${this.scope ? `?restaurantId=${this.scope}` : ''}`)]);
      this.contacts = list;
      this.contactTags = tags;
    },

    contactStatus(c) {
      if (c.optedOut) return { label: 'Descadastrado', cls: 'failed' };
      if (!c.optIn) return { label: 'Sem autorização', cls: 'queued' };
      return { label: 'Autorizado', cls: 'completed' };
    },

    editContact(c) {
      this.contactModal = c
        ? { ...c, tagsText: (c.tags || []).join(', '), birthDay: c.birthDay ?? '', birthMonth: c.birthMonth ?? '', birthYear: c.birthYear ?? '', neighborhood: c.neighborhood || '' }
        : { restaurantId: this.scope || this.restaurants[0]?.id || '', name: '', phone: '', tagsText: '', optIn: true, optInSource: 'Cadastro manual', notes: '', birthDay: '', birthMonth: '', birthYear: '', neighborhood: '' };
    },

    birthdayText(c) {
      if (!c.birthDay) return '';
      return `${c.birthDay} de ${MONTH_NAMES[c.birthMonth - 1]}${c.birthYear ? ` de ${c.birthYear}` : ''}`;
    },

    /** Depois de editar um contato: na ficha, recarrega a ficha; na lista, a lista. */
    refreshContacts() {
      return this.route.params.id ? this.loadContactProfile(this.route.params.id) : this.loadContacts();
    },

    async saveContact() {
      const c = this.contactModal;
      const body = { ...c, tags: c.tagsText };
      try {
        if (c.id) await api(`/contacts/${c.id}`, { method: 'PUT', body });
        else await api('/contacts', { method: 'POST', body });
        this.contactModal = null;
        await this.refreshContacts();
        this.toast('Contato salvo.');
      } catch (err) { this.error(err); }
    },

    async toggleOptOut(c) {
      try {
        await api(`/contacts/${c.id}`, { method: 'PUT', body: { optedOut: !c.optedOut } });
        await this.refreshContacts();
      } catch (err) { this.error(err); }
    },

    deleteContact(c) {
      this.confirm(`Remover ${c.name || fmt.phone(c.phone)}?`, 'O contato sai da base deste restaurante.', async () => {
        await api(`/contacts/${c.id}`, { method: 'DELETE' });
        if (this.route.params.id) this.go('#/contatos'); else await this.loadContacts();
      });
    },

    openImport() {
      this.importModal = { restaurantId: this.scope || this.restaurants[0]?.id || '', text: '', tags: '', source: 'Importação de planilha', consent: false, result: null, loading: false };
    },

    get importRows() {
      return this.importModal ? parseContactsText(this.importModal.text) : [];
    },

    readImportFile(ev) {
      const file = ev.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { this.importModal.text = String(reader.result || ''); };
      reader.readAsText(file, 'utf-8');
    },

    async runImport() {
      const m = this.importModal;
      m.loading = true;
      try {
        m.result = await api('/contacts/import', { method: 'POST', body: { restaurantId: m.restaurantId, contacts: this.importRows, tags: m.tags, optIn: true, optInSource: m.source } });
        await this.loadContacts();
        this.restaurants = await api('/restaurants');
      } catch (err) { this.error(err); } finally { m.loading = false; }
    },

    // ── Filtros de compra (público da campanha e lista de contatos) ─
    /** Resumo legível dos filtros, um texto por filtro ativo. */
    describeFilters(f = {}) {
      const out = [];
      const span = (r, one, many, money = false) => {
        const v = (n) => (money ? fmt.money(n) : fmt.int(n));
        if (r.min !== undefined && r.max !== undefined) return r.min === r.max ? `${v(r.min)} ${r.min === 1 ? one : many}` : `de ${v(r.min)} a ${v(r.max)} ${many}`;
        if (r.min !== undefined) return `${v(r.min)}+ ${r.min === 1 ? one : many}`;
        return `até ${v(r.max)} ${r.max === 1 ? one : many}`;
      };
      const day = (s) => s.split('-').reverse().join('/');
      const period = (p) => (p.from && p.to ? `de ${day(p.from)} a ${day(p.to)}` : p.from ? `desde ${day(p.from)}` : `até ${day(p.to)}`);
      if (f.orders) out.push(f.orders.max === 0 && f.orders.min === undefined ? 'nunca compraram' : span(f.orders, 'pedido', 'pedidos'));
      if (f.spent) out.push(`gastaram ${span(f.spent, '', '', true).trim()}`);
      if (f.lastOrderDays) {
        const { min, max } = f.lastOrderDays;
        out.push(min !== undefined && max !== undefined ? `última compra entre ${min} e ${max} dias atrás` : min !== undefined ? `sem comprar há ${min}+ dias` : `compraram nos últimos ${max} dias`);
      }
      if (f.firstOrder) out.push(`primeira compra ${period(f.firstOrder)}`);
      if (f.lastOrder) out.push(`última compra ${period(f.lastOrder)}`);
      if (f.birthday?.month) out.push(`aniversário em ${MONTH_NAMES[f.birthday.month - 1]}`);
      if (f.birthday?.nextDays) out.push(`aniversário nos próximos ${f.birthday.nextDays} dias`);
      if (f.neighborhoods?.length) out.push(`bairro: ${f.neighborhoods.join(', ')}`);
      if (f.items?.length) out.push(`${f.itemsMode === 'any' ? 'já pediram' : 'mais pedem'}: ${f.items.join(', ')}`);
      if (f.weekdays?.length) out.push(`preferem ${f.weekdays.map((d) => WEEKDAYS[d]).join(', ')}`);
      return out;
    },
    segmentText(segment) {
      const parts = [...(segment?.tags?.length ? [`tags: ${segment.tags.join(', ')}`] : []), ...this.describeFilters(segment?.filters)];
      return parts.length ? parts.join(' · ') : 'base completa';
    },
    /** Filtros gravados → campos da janela (texto nos inputs, listas nas etiquetas). */
    filtersToForm(f = {}) {
      const s = (v) => (v === undefined || v === null ? '' : String(v));
      return {
        ordersMin: s(f.orders?.min), ordersMax: s(f.orders?.max), spentMin: s(f.spent?.min), spentMax: s(f.spent?.max),
        lastMin: s(f.lastOrderDays?.min), lastMax: s(f.lastOrderDays?.max),
        firstFrom: s(f.firstOrder?.from), firstTo: s(f.firstOrder?.to), lastFrom: s(f.lastOrder?.from), lastTo: s(f.lastOrder?.to),
        bdayMode: f.birthday?.month ? 'month' : f.birthday?.nextDays ? 'next' : '',
        bdayMonth: s(f.birthday?.month || new Date().getMonth() + 1), bdayNext: s(f.birthday?.nextDays || 7),
        neighborhoods: [...(f.neighborhoods || [])], items: [...(f.items || [])], itemsMode: f.itemsMode || 'top', weekdays: [...(f.weekdays || [])],
      };
    },
    /** Campos da janela → filtros (o servidor valida de novo e descarta o que estiver vazio). */
    formToFilters(m) {
      const range = (min, max) => ({ ...(min !== '' ? { min: Number(String(min).replace(',', '.')) } : {}), ...(max !== '' ? { max: Number(String(max).replace(',', '.')) } : {}) });
      const period = (from, to) => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
      const out = {
        orders: range(m.ordersMin, m.ordersMax), spent: range(m.spentMin, m.spentMax), lastOrderDays: range(m.lastMin, m.lastMax),
        firstOrder: period(m.firstFrom, m.firstTo), lastOrder: period(m.lastFrom, m.lastTo),
        birthday: m.bdayMode === 'month' ? { month: Number(m.bdayMonth) } : m.bdayMode === 'next' ? { nextDays: Number(m.bdayNext) } : {},
        neighborhoods: m.neighborhoods, items: m.items, weekdays: m.weekdays,
      };
      if (m.items.length) out.itemsMode = m.itemsMode;
      return Object.fromEntries(Object.entries(out).filter(([, v]) => (Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : true)));
    },
    async openFilters(target) {
      const current = target === 'editor' ? this.editor.form.segment.filters : this.contactFilters;
      const restaurantId = target === 'editor' ? this.editor.form.restaurantId : this.scope;
      this.filterModal = { target, restaurantId, form: this.filtersToForm(current), facets: { neighborhoods: [], items: [] }, count: null, error: '' };
      this.refreshFilterCount();
      try {
        this.filterModal.facets = await api(`/contacts/facets${restaurantId ? `?restaurantId=${restaurantId}` : ''}`);
      } catch (err) { this.error(err); }
    },
    toggleIn(list, value) {
      const i = list.indexOf(value);
      if (i >= 0) list.splice(i, 1); else list.push(value);
      this.refreshFilterCount();
    },
    /** Quantos autorizados passam nos filtros (com as tags da campanha, quando é a campanha). */
    refreshFilterCount() {
      clearTimeout(this.filterTimer);
      this.filterTimer = setTimeout(async () => {
        const m = this.filterModal;
        if (!m?.restaurantId) return;
        const tags = m.target === 'editor' ? this.editor.form.segment : { tags: [], match: 'any' };
        try {
          const res = await api('/audience/preview', { method: 'POST', body: { restaurantId: m.restaurantId, segment: { tags: tags.tags, match: tags.match, filters: this.formToFilters(m.form) } } });
          m.count = res.count;
          m.error = '';
        } catch (err) { m.error = err.message; m.count = null; }
      }, 250);
    },
    applyFilters() {
      const m = this.filterModal;
      if (m.error) return;
      const filters = this.formToFilters(m.form);
      if (m.target === 'editor') {
        this.editor.form.segment.filters = filters;
        this.refreshAudience();
      } else {
        this.contactFilters = filters;
        this.loadContacts().catch((err) => this.error(err));
      }
      this.filterModal = null;
    },
    clearFilters(target) {
      if (target === 'editor') { this.editor.form.segment.filters = {}; this.refreshAudience(); } else { this.contactFilters = {}; this.loadContacts().catch((err) => this.error(err)); }
    },

    // ── Ficha do cliente ───────────────────────────────────
    async loadContactProfile(id) {
      this.contactProfile = await api(`/contacts/${id}`);
    },
    messageLabel(m) {
      if (m.convertedAt) return { label: 'Pediu', cls: 'completed' };
      if (m.clickedAt) return { label: 'Clicou', cls: 'sending' };
      if (m.readAt) return { label: 'Leu', cls: 'delivered' };
      return { label: MSG_STATUS[m.status] || m.status, cls: ['failed', 'skipped'].includes(m.status) ? 'failed' : 'queued' };
    },

    // ── Indicação ──────────────────────────────────────────
    blankReferral() {
      return { enabled: false, discountType: 'fixed', discountValue: '', minOrder: '', validUntil: '', rewardType: 'fixed', rewardValue: '', rewardMinOrder: '', rewardValidDays: 30, inviteMessage: '', rewardMessage: '' };
    },
    async loadReferrals() {
      this.referralData = await api(`/referrals${this.scope && !this.isRestaurant ? `?restaurantId=${this.scope}` : ''}`);
    },
    discountText(type, value) { return type === 'percent' ? `${String(value).replace('.', ',')}%` : fmt.money(value); },
    couponState(c) {
      if (c.usedAt) return { label: 'Usado', cls: 'completed' };
      if (c.expiresAt && new Date(c.expiresAt) < new Date()) return { label: 'Vencido', cls: 'failed' };
      if (c.sendError) return { label: 'Não enviado', cls: 'failed' };
      if (c.sentAt) return { label: 'Enviado', cls: 'delivered' };
      return { label: 'Enviando', cls: 'sending' };
    },
    async resendCoupon(c) {
      try {
        const saved = await api(`/coupons/${c.id}/resend`, { method: 'POST' });
        this.toast(saved.sentAt && !saved.sendError ? 'Cupom reenviado.' : saved.sendError, saved.sendError ? 'Não enviado' : '');
        await this.loadReferrals();
      } catch (err) { this.error(err); }
    },
    copyText(text) { navigator.clipboard?.writeText(text).then(() => this.toast('Link copiado.'), () => {}); },

    // ── Pedidos ────────────────────────────────────────────
    ordersQuery(extra = {}) {
      const q = { ...(this.scope && !this.isRestaurant ? { restaurantId: this.scope } : {}), ...extra };
      return new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v !== null && v !== undefined)));
    },
    async loadOrders() {
      const [board, history] = await Promise.all([api(`/orders?${this.ordersQuery({ active: 1 })}`), api(`/orders?${this.ordersQuery(this.orderFilter)}`)]);
      this.board = board;
      this.orders = history;
      this.newOrders = board.filter((o) => o.status === 'new').length;
    },
    async countNewOrders() {
      this.newOrders = (await api(`/orders?${this.ordersQuery({ active: 1, status: 'new' })}`)).filter((o) => o.status === 'new').length;
    },
    get boardColumns() {
      return [
        { status: 'new', label: 'Novos', empty: 'Os pedidos do site chegam aqui na hora.' },
        { status: 'preparing', label: 'Em preparo', empty: 'Nenhum pedido em preparo.' },
        { status: 'dispatched', label: 'Saiu para entrega / pronto', empty: 'Nenhum pedido a caminho.' },
      ].map((col) => ({ ...col, orders: this.board.filter((o) => o.status === col.status) }));
    },
    orderLabel(o) { return o.number ? `#${o.number}` : (o.orderId || 'Pedido'); },
    orderStatusLabel(o) {
      if (o.status === 'dispatched' && o.fulfillment === 'pickup') return 'Pronto para retirar';
      return ORDER_STATUS[o.status] || o.status;
    },
    nextStatus(o) { return ORDER_NEXT[o.status] || null; },
    nextLabel(o) {
      return { new: 'Iniciar preparo', preparing: o.fulfillment === 'pickup' ? 'Pronto para retirar' : 'Saiu para entrega', dispatched: o.fulfillment === 'pickup' ? 'Retirado' : 'Entregue' }[o.status] || '';
    },
    fulfillmentText(o) {
      if (o.fulfillment === 'pickup') return 'Retirada';
      if (o.fulfillment === 'delivery') return o.neighborhood ? `Entrega · ${o.neighborhood}` : 'Entrega';
      return o.neighborhood || '';
    },
    addressText(a) {
      if (!a) return '';
      const cep = a.cep ? `CEP ${a.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '';
      return [[a.street, a.number].filter(Boolean).join(', '), a.complement, a.neighborhood, [a.city, a.state].filter(Boolean).join(' – '), cep].filter(Boolean).join(' · ');
    },
    waLink(phone) { return `https://wa.me/${String(phone || '').replace(/\D/g, '')}`; },
    async openOrder(o) {
      this.orderModal = o;
      try { this.orderModal = await api(`/orders/${o.id}`); } catch (err) { this.error(err); }
    },
    async setOrderStatus(o, status) {
      try {
        const saved = await api(`/orders/${o.id}/status`, { method: 'PUT', body: { status } });
        if (this.orderModal?.id === saved.id) this.orderModal = saved;
        await this.loadOrders();
        return saved;
      } catch (err) {
        this.error(err);
        await this.loadOrders().catch(() => {});
        return null;
      }
    },
    advance(o) {
      const next = this.nextStatus(o);
      if (next) this.setOrderStatus(o, next);
    },
    cancelOrder(o) {
      this.confirm(`Cancelar o pedido ${this.orderLabel(o)}?`, 'O cliente vê o cancelamento na página de acompanhamento. Não dá para desfazer.', async () => {
        const saved = await api(`/orders/${o.id}/status`, { method: 'PUT', body: { status: 'canceled' } });
        if (this.orderModal?.id === saved.id) this.orderModal = saved;
        await this.loadOrders();
      }, 'Cancelar pedido');
    },
    copyTracking(o) {
      navigator.clipboard?.writeText(o.trackingUrl).then(() => this.toast('Link de acompanhamento copiado.'), () => {});
    },

    openOrderImport() {
      this.orderImport = { restaurantId: this.scope || this.restaurants[0]?.id || '', channel: 'iFood', text: '', consent: false, preview: null, result: null, loading: false };
    },
    get orderImportParsed() {
      return this.orderImport ? parseOrdersText(this.orderImport.text) : { rows: [], columns: [] };
    },
    readOrderImportFile(ev) {
      const file = ev.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { this.orderImport.text = String(reader.result || ''); this.orderImport.preview = null; };
      reader.readAsText(file, 'utf-8');
    },
    async previewOrderImport() {
      const m = this.orderImport;
      m.loading = true;
      try {
        m.preview = await api('/orders/import/preview', { method: 'POST', body: { restaurantId: m.restaurantId, rows: this.orderImportParsed.rows } });
      } catch (err) { this.error(err); } finally { m.loading = false; }
    },
    async runOrderImport() {
      const m = this.orderImport;
      m.loading = true;
      try {
        m.result = await api('/orders/import', { method: 'POST', body: { restaurantId: m.restaurantId, rows: this.orderImportParsed.rows, channel: m.channel, consent: m.consent } });
        if (this.route.name === 'pedidos') await this.loadOrders();
      } catch (err) { this.error(err); } finally { m.loading = false; }
    },

    // ── Campanhas ──────────────────────────────────────────
    /** Situação exibida: antes do envio, o que importa é a aprovação. */
    campaignLabel(c) {
      if (['draft', 'scheduled'].includes(c.status) && c.approval) {
        const a = APPROVAL[c.approval.status];
        return c.status === 'scheduled' ? `Agendada · ${a.toLowerCase()}` : a;
      }
      return STATUS[c.status];
    },
    campaignClass(c) {
      if (['draft', 'scheduled'].includes(c.status) && c.approval) return { pending: 'sending', approved: 'completed', changes: 'failed' }[c.approval.status];
      return c.status;
    },
    get pendingApprovals() {
      return this.campaigns.filter((c) => c.approval?.status === 'pending' && ['draft', 'scheduled'].includes(c.status));
    },

    async loadCampaigns() {
      this.campaigns = await api(`/campaigns${this.scope ? `?restaurantId=${this.scope}` : ''}`);
    },

    get filteredCampaigns() {
      const f = this.campaignFilter;
      if (f === 'all') return this.campaigns;
      if (f === 'active') return this.campaigns.filter((c) => ['sending', 'scheduled', 'paused'].includes(c.status));
      if (f === 'approval') return this.pendingApprovals;
      return this.campaigns.filter((c) => c.status === f);
    },

    campaignCount(f) {
      if (f === 'all') return this.campaigns.length;
      if (f === 'active') return this.campaigns.filter((c) => ['sending', 'scheduled', 'paused'].includes(c.status)).length;
      if (f === 'approval') return this.pendingApprovals.length;
      return this.campaigns.filter((c) => c.status === f).length;
    },

    openCampaign(c) {
      if (this.isRestaurant) { this.go(`#/campanhas/${c.id}`); return; }
      this.go(['draft', 'scheduled'].includes(c.status) ? `#/campanhas/${c.id}/editar` : `#/campanhas/${c.id}`);
    },

    async newCampaign() {
      const restaurantId = this.scope || this.restaurants[0]?.id || '';
      const r = this.restaurantById(restaurantId);
      this.editor = this.makeEditor({
        id: null, restaurantId, name: '', objective: '', occasion: '', coupon: r?.coupon || '', message: '', mediaUrl: '', destinationUrl: '',
        segment: { tags: [], match: 'any', filters: {} }, includeFooter: true, cloudTemplate: null, status: 'draft',
      });
      await Promise.all([this.refreshEditorTags(), this.loadUploads()]);
    },

    async openEditor(id) {
      const c = await api(`/campaigns/${id}`);
      if (!['draft', 'scheduled'].includes(c.status)) { this.go(`#/campanhas/${id}`); return; }
      this.editor = this.makeEditor(c);
      await Promise.all([this.refreshEditorTags(), this.loadUploads()]);
    },

    makeEditor(c) {
      const cloud = c.cloudTemplate || { name: '', language: 'pt_BR', params: [] };
      return {
        step: 1,
        form: { ...c, segment: { tags: [...(c.segment?.tags || [])], match: c.segment?.match || 'any', filters: JSON.parse(JSON.stringify(c.segment?.filters || {})) }, cloudTemplate: { ...cloud, paramsText: (cloud.params || []).join('\n') } },
        tags: [],
        audience: { count: c.audiencePreview ?? 0, sample: [] },
        seed: 0,
        saving: false,
        scheduling: !!c.scheduledAt,
        scheduledAt: c.scheduledAt ? new Date(new Date(c.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '',
        showCloud: !!c.cloudTemplate?.name,
        sendingTest: false,
        starting: false,
      };
    },

    get editorRestaurant() {
      return this.editor ? this.restaurantById(this.editor.form.restaurantId) : null;
    },

    async refreshEditorTags() {
      if (!this.editor?.form.restaurantId) return;
      this.editor.tags = await api(`/contacts/tags?restaurantId=${this.editor.form.restaurantId}`);
      await this.refreshAudience();
    },

    async refreshAudience() {
      const f = this.editor?.form;
      if (!f?.restaurantId) return;
      this.editor.audience = await api('/audience/preview', { method: 'POST', body: { restaurantId: f.restaurantId, segment: f.segment } });
    },

    toggleTag(tag) {
      const tags = this.editor.form.segment.tags;
      const i = tags.indexOf(tag);
      if (i >= 0) tags.splice(i, 1); else tags.push(tag);
      this.refreshAudience();
    },

    applyIdea(idea) {
      const f = this.editor.form;
      f.message = idea.message;
      f.objective = idea.objective;
      f.occasion = idea.occasion;
      if (!f.name) f.name = idea.title;
      const known = this.editor.tags.map((t) => t.tag);
      f.segment.tags = idea.tags.filter((t) => known.includes(t));
      f.segment.filters = JSON.parse(JSON.stringify(idea.filters || {}));
      this.refreshAudience();
      this.toast(`Modelo “${idea.title}” aplicado. Revise o texto antes de enviar.`);
    },

    insertAtCursor(snippet) {
      const ta = this.$refs.msg;
      const f = this.editor.form;
      if (!ta) { f.message += snippet; return; }
      const start = ta.selectionStart ?? f.message.length;
      const end = ta.selectionEnd ?? f.message.length;
      f.message = f.message.slice(0, start) + snippet + f.message.slice(end);
      this.$nextTick(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + snippet.length; });
    },

    wrapSelection(mark) {
      const ta = this.$refs.msg;
      const f = this.editor.form;
      const s = ta.selectionStart; const e = ta.selectionEnd;
      const sel = f.message.slice(s, e) || 'texto';
      f.message = `${f.message.slice(0, s)}${mark}${sel}${mark}${f.message.slice(e)}`;
      this.$nextTick(() => { ta.focus(); ta.selectionStart = s + 1; ta.selectionEnd = s + 1 + sel.length; });
    },

    get previewText() {
      const e = this.editor;
      if (!e) return '';
      const r = this.editorRestaurant;
      const sample = e.audience.sample?.[e.seed % Math.max(1, e.audience.sample.length)]?.name || 'Marina Souza';
      const vars = {
        nome: sample, primeiro_nome: sample.split(' ')[0], restaurante: r?.name || 'Seu restaurante',
        cupom: e.form.coupon || r?.coupon || '', link: `${this.meta.publicUrl}/r/a8Kq2x`,
      };
      let text = renderTemplate(e.form.message, vars, e.seed);
      if (!text) return '';
      if (!/\{\{\s*link\s*\}\}/.test(e.form.message)) text += `\n\n${vars.link}`;
      if (e.form.includeFooter && this.settings.footer) text += `\n\n_${this.settings.footer}_`;
      return text;
    },

    get messageWarnings() {
      const m = this.editor?.form.message || '';
      const w = [];
      if (m && !/\{\{\s*(primeiro_nome|nome)\s*\}\}/.test(m)) w.push('A mensagem não usa o nome do cliente.');
      if (m && !/\{\{\s*link\s*\}\}/.test(m)) w.push('Sem {{link}} no texto: o link vai no final da mensagem.');
      if (m.length > 700) w.push('Texto longo (mais de 700 caracteres).');
      if (m && !/\{[^{}]*\|[^{}]*\}/.test(m)) w.push('Sem variações de texto: todos recebem a mesma mensagem, o que aumenta o risco de bloqueio no WhatsApp Web.');
      return w;
    },

    editorPayload() {
      const f = this.editor.form;
      const cloud = f.cloudTemplate?.name ? { name: f.cloudTemplate.name, language: f.cloudTemplate.language, params: (f.cloudTemplate.paramsText || '').split('\n').map((s) => s.trim()).filter(Boolean) } : { name: '' };
      return {
        name: f.name || 'Nova campanha', restaurantId: f.restaurantId, objective: f.objective, occasion: f.occasion, coupon: f.coupon,
        message: f.message, mediaUrl: f.mediaUrl, destinationUrl: f.destinationUrl, segment: f.segment, includeFooter: f.includeFooter, cloudTemplate: cloud, notes: f.notes,
      };
    },

    async saveCampaign(quiet = false) {
      const e = this.editor;
      if (!e.form.restaurantId) { this.error(new Error('Selecione o restaurante.')); return false; }
      e.saving = true;
      try {
        const body = this.editorPayload();
        const saved = e.form.id ? await api(`/campaigns/${e.form.id}`, { method: 'PUT', body }) : await api('/campaigns', { method: 'POST', body });
        if (!e.form.id) {
          e.form.id = saved.id;
          history.replaceState(null, '', `#/campanhas/${saved.id}/editar`);
          this.route = { name: 'campanhas', params: { id: saved.id, action: 'editar' } };
        }
        e.form.status = saved.status;
        if (e.form.approval && !saved.approval) this.toast('O conteúdo mudou, então a campanha precisa ser aprovada de novo.', 'Aprovação reiniciada');
        e.form.approval = saved.approval || null;
        e.form.approvalLog = saved.approvalLog || [];
        if (!quiet) this.toast('Rascunho salvo.');
        return true;
      } catch (err) { this.error(err); return false; } finally { e.saving = false; }
    },

    async goStep(n) {
      if (n > this.editor.step && this.editor.step === 2 && !this.editor.form.message.trim()) {
        this.error(new Error('Escreva a mensagem antes de continuar.'));
        return;
      }
      if (await this.saveCampaign(true)) {
        this.editor.step = n;
        if (n === 3 || n === 4) await this.refreshAudience();
      }
    },

    async sendTest() {
      const e = this.editor;
      if (!this.testPhone) { this.error(new Error('Informe um número para o teste.')); return; }
      localStorage.setItem('sc_test_phone', this.testPhone);
      e.sendingTest = true;
      try {
        if (!(await this.saveCampaign(true))) return;
        await api(`/campaigns/${e.form.id}/test`, { method: 'POST', body: { phone: this.testPhone } });
        this.toast(`Teste enviado para ${fmt.phone(this.testPhone.replace(/\D/g, '').replace(/^(?!55)/, '55'))}.`);
      } catch (err) { this.error(err); } finally { e.sendingTest = false; }
    },

    get estimate() {
      const n = this.editor?.audience.count || 0;
      const sim = this.conn.provider === 'simulator';
      const avg = sim ? 1.5 : ((this.settings.minDelaySeconds || 6) + (this.settings.maxDelaySeconds || 14)) / 2 + 2;
      const secs = n * avg;
      if (secs < 90) return `≈ ${Math.max(1, Math.round(secs))} segundos`;
      if (secs < 5400) return `≈ ${Math.round(secs / 60)} minutos`;
      return `≈ ${(secs / 3600).toFixed(1).replace('.', ',')} horas`;
    },

    get needsApproval() {
      const e = this.editor;
      return !!e && this.editorRestaurant?.requireApproval !== false && e.form.approval?.status !== 'approved';
    },

    async requestApproval() {
      const e = this.editor;
      if (!e.form.message?.trim()) { this.error(new Error('Escreva a mensagem antes de pedir aprovação.')); return; }
      if (!(await this.saveCampaign(true))) return;
      try {
        const c = await api(`/campaigns/${e.form.id}/request-approval`, { method: 'POST', body: { note: this.approvalNote } });
        e.form.approval = c.approval;
        e.form.approvalLog = c.approvalLog;
        this.approvalNote = '';
        this.toast(`O restaurante já pode aprovar a campanha entrando no painel com o acesso dele.`, 'Enviada para aprovação');
      } catch (err) { this.error(err); }
    },

    async launch() {
      const e = this.editor;
      if (!(await this.saveCampaign(true))) return;
      if (this.needsApproval) { this.error(new Error('A campanha precisa ser aprovada pelo restaurante antes do envio.')); return; }
      if (e.scheduling) {
        if (!e.scheduledAt) { this.error(new Error('Escolha a data e hora do envio.')); return; }
        try {
          await api(`/campaigns/${e.form.id}/schedule`, { method: 'POST', body: { scheduledAt: new Date(e.scheduledAt).toISOString() } });
          this.toast(`Envio agendado para ${fmt.dateTime(new Date(e.scheduledAt).toISOString())}.`);
          this.go('#/campanhas');
        } catch (err) { this.error(err); }
        return;
      }
      this.confirm(
        `Enviar para ${e.audience.count} ${e.audience.count === 1 ? 'contato' : 'contatos'}?`,
        `As mensagens serão enviadas pelo canal “${this.conn.label}”, uma a uma, com intervalos aleatórios.`,
        async () => {
          e.starting = true;
          try {
            await api(`/campaigns/${e.form.id}/start`, { method: 'POST' });
            this.toast('Disparo iniciado.');
            this.go(`#/campanhas/${e.form.id}`);
          } finally { e.starting = false; }
        },
        'Enviar',
      );
    },

    async unschedule() {
      try {
        await api(`/campaigns/${this.editor.form.id}/cancel`, { method: 'POST' });
        this.editor.form.status = 'draft';
        this.editor.scheduling = false;
        this.toast('Agendamento removido. A campanha voltou para rascunho.');
      } catch (err) { this.error(err); }
    },

    // ── Imagens ────────────────────────────────────────────
    async loadUploads() {
      this.uploads = await api('/uploads');
    },

    /** Reduz fotos grandes (máx. 1600 px, JPEG) antes de enviar: o WhatsApp aceita até 5 MB. */
    shrink(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.onload = () => {
          const dataUrl = String(reader.result);
          if (file.size < 900 * 1024 || file.type === 'image/png') { resolve(dataUrl); return; }
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.86));
          };
          img.onerror = () => reject(new Error('Imagem inválida.'));
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    },

    async uploadImage(file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { this.error(new Error('Use imagens JPG, PNG ou WEBP.')); return; }
      this.uploading = true;
      try {
        const dataUrl = await this.shrink(file);
        const saved = await api('/uploads', { method: 'POST', body: { name: file.name, dataUrl } });
        this.editor.form.mediaUrl = saved.url;
        await this.loadUploads();
      } catch (err) { this.error(err); } finally { this.uploading = false; }
    },

    /** Foto de item do cardápio (aparece no site de pedidos do restaurante). */
    async uploadMenuImage(item, file) {
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { this.error(new Error('Use imagens JPG, PNG ou WEBP.')); return; }
      try {
        const dataUrl = await this.shrink(file);
        const saved = await api('/uploads', { method: 'POST', body: { name: file.name, dataUrl } });
        item.image = saved.url;
      } catch (err) { this.error(err); }
    },

    async uploadBanner(file) {
      if (!file) return;
      try {
        const dataUrl = await this.shrink(file);
        const saved = await api('/uploads', { method: 'POST', body: { name: file.name, dataUrl } });
        this.restaurantModal.banners = [...(this.restaurantModal.banners || []), saved.url];
      } catch (err) { this.error(err); }
    },

    onDrop(ev) {
      this.dragOver = false;
      this.uploadImage(ev.dataTransfer?.files?.[0]);
    },

    // ── Detalhe da campanha ────────────────────────────────
    async loadDetail(id, silent) {
      const [c, msgs] = await Promise.all([api(`/campaigns/${id}`), api(`/campaigns/${id}/messages`)]);
      if (!silent && !this.isRestaurant && ['draft', 'scheduled'].includes(c.status)) { this.go(`#/campanhas/${id}/editar`); return; }
      this.detail = c;
      this.detailMessages = msgs;
    },

    get isApprovalView() {
      return !!this.detail && ['draft', 'scheduled'].includes(this.detail.status);
    },

    async decide(action) {
      const note = this.approvalNote.trim();
      if (action === 'request-changes' && !note) { this.error(new Error('Escreva o que precisa mudar.')); return; }
      try {
        this.detail = { ...this.detail, ...(await api(`/campaigns/${this.detail.id}/${action}`, { method: 'POST', body: { note } })) };
        this.approvalNote = '';
        this.toast(action === 'approve' ? 'Obrigado! A Studio Coral já pode enviar a campanha.' : 'Pedido de ajuste enviado para a Studio Coral.', action === 'approve' ? 'Campanha aprovada' : 'Ajustes pedidos');
      } catch (err) { this.error(err); }
    },

    approvalText(entry) {
      return { requested: 'enviou para aprovação', approved: 'aprovou', changes: 'pediu ajustes', reset: 'alterou o conteúdo (aprovação reiniciada)' }[entry.action] || entry.action;
    },

    get filteredMessages() {
      const { status, search } = this.detailFilter;
      const q = search.toLowerCase();
      return this.detailMessages
        .filter((m) => {
          if (status === 'clicked') return !!m.clickedAt;
          if (status === 'converted') return !!m.convertedAt;
          if (status && m.status !== status) return false;
          if (q && !(m.name || '').toLowerCase().includes(q) && !m.phone.includes(q.replace(/\D/g, '') || '§')) return false;
          return true;
        })
        .sort((a, b) => String(b.sentAt || b.queuedAt).localeCompare(String(a.sentAt || a.queuedAt)));
    },

    /** A mensagem como um cliente real recebeu (variáveis preenchidas). */
    get detailSample() {
      const d = this.detail;
      if (!d) return '';
      const m = this.detailMessages.find((x) => x.sentAt) || this.detailMessages[0];
      const name = m?.name || 'Marina Souza';
      const vars = { nome: name, primeiro_nome: name.split(' ')[0], restaurante: d.restaurant, cupom: d.coupon || '', link: `${this.meta.publicUrl}/r/${m?.code || 'a8Kq2x'}` };
      let text = renderTemplate(d.message, vars);
      if (!/\{\{\s*link\s*\}\}/.test(d.message)) text += `\n\n${vars.link}`;
      if (d.includeFooter !== false && this.settings.footer) text += `\n\n_${this.settings.footer}_`;
      return text;
    },

    ring(pct) {
      const r = 52; const c = 2 * Math.PI * r;
      return { r, c, offset: c - (Math.min(100, pct) / 100) * c };
    },

    async campaignAction(action) {
      const c = this.detail;
      const run = async () => {
        await api(`/campaigns/${c.id}/${action}`, { method: 'POST' });
        await this.loadDetail(c.id, true);
      };
      if (action === 'cancel') {
        this.confirm('Cancelar o envio?', 'As mensagens que ainda estão na fila não serão enviadas. As já enviadas continuam sendo medidas.', run, 'Cancelar envio');
      } else {
        try { await run(); } catch (err) { this.error(err); }
      }
    },

    async duplicate(c) {
      try {
        const copy = await api(`/campaigns/${c.id}/duplicate`, { method: 'POST' });
        this.toast('Cópia criada como rascunho.');
        this.go(`#/campanhas/${copy.id}/editar`);
      } catch (err) { this.error(err); }
    },

    deleteCampaign(c) {
      this.confirm(`Excluir “${c.name}”?`, 'A campanha e suas métricas serão apagadas.', async () => {
        await api(`/campaigns/${c.id}`, { method: 'DELETE' });
        this.go('#/campanhas');
        await this.loadCampaigns();
      });
    },

    // ── Acessos do restaurante ─────────────────────────────
    async loadUsers(restaurantId) {
      this.users = restaurantId ? await api(`/restaurants/${restaurantId}/users`) : [];
      this.newUser = null;
    },
    async addUser() {
      const u = this.newUser;
      try {
        await api(`/restaurants/${this.restaurantModal.id}/users`, { method: 'POST', body: u });
        this.toast(`Acesso criado para ${u.email}. Passe a senha para o restaurante.`);
        await this.loadUsers(this.restaurantModal.id);
      } catch (err) { this.error(err); }
    },
    async resetPassword(u) {
      const password = prompt(`Nova senha para ${u.email} (mínimo 8 caracteres):`);
      if (!password) return;
      try {
        await api(`/users/${u.id}/password`, { method: 'PUT', body: { password } });
        this.toast('Senha alterada.');
      } catch (err) { this.error(err); }
    },
    removeUser(u) {
      this.confirm(`Remover o acesso de ${u.email}?`, 'A pessoa deixa de entrar no painel na hora.', async () => {
        await api(`/users/${u.id}`, { method: 'DELETE' });
        await this.loadUsers(this.restaurantModal.id);
      });
    },
    async changeOwnPassword() {
      const m = this.passwordModal;
      if (m.password !== m.confirm) { this.error(new Error('As senhas novas não são iguais.')); return; }
      try {
        await api('/me/password', { method: 'PUT', body: { current: m.current, password: m.password } });
        this.passwordModal = null;
        this.toast('Senha alterada.');
      } catch (err) { this.error(err); }
    },

    // ── Relatórios ─────────────────────────────────────────
    async loadReports() {
      const st = this.reportState;
      st.restaurantId = this.isRestaurant ? this.user.restaurantId : (st.restaurantId || this.scope || this.restaurants[0]?.id || '');
      if (!st.restaurantId) return;
      st.months = await api(`/reports/months?restaurantId=${st.restaurantId}`);
      if (!st.months.includes(st.month)) st.month = st.months[0];
    },
    get reportQuery() {
      return `restaurantId=${this.reportState.restaurantId}&month=${this.reportState.month}`;
    },
    monthLabel(m) {
      if (!m) return '';
      const [y, mm] = m.split('-');
      return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(mm) - 1]} de ${y}`;
    },

    // ── Conexão ────────────────────────────────────────────
    async connect() {
      try { this.applyStatus(await api('/messaging/start', { method: 'POST' })); } catch (err) { this.error(err); }
    },
    async disconnect(logout = false) {
      const run = async () => this.applyStatus(await api(`/messaging/${logout ? 'logout' : 'stop'}`, { method: 'POST' }));
      if (logout) this.confirm('Desconectar o número?', 'A sessão do WhatsApp será apagada e será preciso ler o QR Code novamente.', run, 'Desconectar');
      else try { await run(); } catch (err) { this.error(err); }
    },
    async useProvider(key) {
      try {
        this.applyStatus(await api('/messaging/provider', { method: 'POST', body: { provider: key } }));
        this.toast(`Canal ativo: ${this.conn.label}.`);
      } catch (err) { this.error(err); }
    },
    async sendConnTest() {
      if (!this.testPhone) { this.error(new Error('Informe o número.')); return; }
      localStorage.setItem('sc_test_phone', this.testPhone);
      try {
        await api('/messaging/test', { method: 'POST', body: { phone: this.testPhone } });
        this.toast('Mensagem de teste enviada.');
      } catch (err) { this.error(err); }
    },
    async simulateReply(item, body = 'SAIR') {
      try { await api('/messaging/simulate-reply', { method: 'POST', body: { from: item.to, body } }); } catch (err) { this.error(err); }
    },

    // ── Configurações ──────────────────────────────────────
    async saveSettings() {
      try {
        const s = this.settings;
        this.settings = await api('/settings', {
          method: 'PUT',
          body: { ...s, optOutKeywords: typeof s.optOutKeywords === 'string' ? s.optOutKeywords : s.optOutKeywords.join(', ') },
        });
        this.toast('Configurações salvas.');
      } catch (err) { this.error(err); }
    },

    // ── Confirmação ────────────────────────────────────────
    confirm(title, text, action, cta = 'Confirmar') {
      this.confirmBox = { title, text, action, cta, busy: false };
    },
    async runConfirm() {
      const box = this.confirmBox;
      box.busy = true;
      try { await box.action(); this.confirmBox = null; } catch (err) { this.error(err); box.busy = false; }
    },
  }));
});
