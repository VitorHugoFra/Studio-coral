const { AuthService } = require('./AuthService');

/**
 * Gera PDF a partir de uma página do próprio sistema, usando o Chrome do
 * Puppeteer (já instalado junto com o WPPConnect). A página é aberta com a
 * sessão de quem pediu o relatório, então respeita as mesmas permissões.
 */
class PdfService {
  constructor({ config, auth, logger = console }) {
    this.config = config;
    this.auth = auth;
    this.logger = logger;
    this.browser = null;
  }

  available() {
    try {
      require.resolve('puppeteer');
      return true;
    } catch {
      return false;
    }
  }

  async getBrowser() {
    if (this.browser?.connected) return this.browser;
    // eslint-disable-next-line global-require
    const puppeteer = require('puppeteer');
    this.browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return this.browser;
  }

  async render(path, user) {
    if (!this.available()) {
      throw Object.assign(new Error('Geração de PDF indisponível: instale as dependências com Node 18+ (npm install).'), { status: 501 });
    }
    const origin = `http://127.0.0.1:${this.config.port}`;
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setCookie({ name: AuthService.COOKIE, value: this.auth.tokenFor(user), url: origin });
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.waitForSelector('body[data-ready]', { timeout: 15000 });
      return await page.pdf({ printBackground: true, preferCSSPageSize: true });
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    await this.browser?.close().catch(() => {});
  }
}

module.exports = { PdfService };
