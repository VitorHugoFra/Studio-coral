/**
 * Monta o texto final de cada mensagem.
 *
 *  • Variáveis: {{nome}}, {{primeiro_nome}}, {{restaurante}}, {{link}}, {{cupom}}
 *  • Variações (spintax): {Oi|Olá|E aí} — cada cliente recebe uma combinação,
 *    deixando a comunicação mais natural e reduzindo o risco de bloqueio.
 */
class TemplateService {
  constructor({ settings }) {
    this.settings = settings;
  }

  static VARIABLES = [
    { key: 'primeiro_nome', label: 'Primeiro nome', sample: 'Marina' },
    { key: 'nome', label: 'Nome completo', sample: 'Marina Souza' },
    { key: 'restaurante', label: 'Restaurante', sample: 'Cantina Bella Nonna' },
    { key: 'cupom', label: 'Cupom', sample: 'NONNA10' },
    { key: 'link', label: 'Link rastreável', sample: 'https://studiocoral.app/r/a8Kq2' },
  ];

  buildVars({ contact, restaurant, campaign, link }) {
    const name = (contact?.name || '').trim();
    return {
      nome: name || 'cliente',
      primeiro_nome: name ? name.split(/\s+/)[0] : 'cliente',
      restaurante: restaurant?.name || '',
      cupom: campaign?.coupon || restaurant?.coupon || '',
      link: link || '',
    };
  }

  render(template, vars, { spin = true } = {}) {
    let out = String(template || '').replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => (vars[key] ?? ''));
    if (spin) {
      let previous;
      do {
        previous = out;
        out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts) => {
          const list = opts.split('|');
          return list[Math.floor(Math.random() * list.length)];
        });
      } while (out !== previous);
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Texto completo de uma mensagem de campanha. */
  compose({ campaign, contact, restaurant, link }) {
    const vars = this.buildVars({ contact, restaurant, campaign, link });
    let text = this.render(campaign.message, vars);
    if (link && !/\{\{\s*link\s*\}\}/.test(campaign.message)) text += `\n\n${link}`;
    const { footer } = this.settings.get();
    if (campaign.includeFooter !== false && footer) text += `\n\n_${footer}_`;
    return text;
  }

  /** Parâmetros do template da API Oficial ({{1}}, {{2}}…). */
  templateParams(campaign, vars) {
    const params = campaign.cloudTemplate?.params || [];
    return params.map((p) => this.render(p, vars, { spin: false }));
  }
}

module.exports = { TemplateService };
