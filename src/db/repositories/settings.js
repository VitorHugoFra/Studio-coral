const DEFAULT_SETTINGS = {
  provider: null,
  minDelaySeconds: 6,
  maxDelaySeconds: 14,
  dailyLimit: 800,
  businessHoursOnly: false,
  businessHours: { start: '09:00', end: '21:00' },
  optOutKeywords: ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'],
  optOutReply: 'Pronto, você não vai mais receber nossas mensagens promocionais.',
  footer: 'Responda SAIR para não receber mais mensagens.',
};

/**
 * Configurações gerais (uma linha só). Ficam em memória depois do load() para
 * que get() siga síncrono (o TemplateService monta textos sem await); update()
 * grava no banco e atualiza a cópia. Pressupõe uma instância do servidor.
 */
class SettingsRepo {
  constructor(db) {
    this.db = db;
    this.cache = {};
  }

  async load() {
    const row = await this.db.one('SELECT data FROM settings WHERE id = 1');
    this.cache = row?.data || {};
    return this.get();
  }

  get() {
    return { ...DEFAULT_SETTINGS, ...this.cache };
  }

  async update(patch) {
    const row = await this.db.one(
      `INSERT INTO settings (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = settings.data || EXCLUDED.data
       RETURNING data`,
      [JSON.stringify(patch)],
    );
    this.cache = row.data;
    return this.get();
  }
}

module.exports = { SettingsRepo, DEFAULT_SETTINGS };
