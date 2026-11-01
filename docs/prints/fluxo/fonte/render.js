// Renderiza os diagramas HTML em PNG. node render.js <saída> <arquivo.html>...
const path = require('path');
const puppeteer = require('puppeteer');
const [out, ...files] = process.argv.slice(2);

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const file of files) {
      const page = await browser.newPage();
      await page.setViewport({ width: 2480, height: 1400, deviceScaleFactor: 2 });
      await page.goto(`file:///${path.resolve(__dirname, file).replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.evaluate(async () => { await document.fonts.ready; if (window.render) await window.render(); if (window.drawArrows) window.drawArrows(); });
      const el = await page.$('#cap');
      const name = path.basename(file, '.html');
      await el.screenshot({ path: path.join(out, `fluxo-${name}.png`) });
      console.log('ok', name);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
