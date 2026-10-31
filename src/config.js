const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = (key, fallback) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback);
const bool = (key, fallback) => String(env(key, fallback)).toLowerCase() === 'true';

const port = Number(env('PORT', 3000));
const dataDir = path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data')));

module.exports = {
  port,
  publicUrl: env('PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir,

  // Banco de dados: com DATABASE_URL usa o PostgreSQL informado; sem ela, o
  // PGlite (PostgreSQL embutido) guarda tudo em data/pgdata.
  databaseUrl: env('DATABASE_URL', ''),
  databasePoolMax: Number(env('DATABASE_POOL_MAX', 10)),
  pgliteDir: path.join(dataDir, 'pgdata'),

  admin: {
    name: env('ADMIN_NAME', 'Equipe Studio Coral'),
    email: env('ADMIN_EMAIL', 'admin@studiocoral.com.br'),
    password: env('ADMIN_PASSWORD', 'coral123'),
  },
  sessionSecret: env('SESSION_SECRET', 'studio-coral-dev-secret'),

  // Pagamento online (etapa 5). ENCRYPTION_KEY cifra as chaves de API dos restaurantes: sem ela, deriva do
  // SESSION_SECRET. Trocar depois exige recadastrar as chaves. AGENCY_ASAAS_WALLET_ID recebe o repasse (split).
  payments: {
    encryptionKey: env('ENCRYPTION_KEY', ''),
    agencyWalletId: env('AGENCY_ASAAS_WALLET_ID', ''),
    sweepSeconds: Number(env('PAYMENT_SWEEP_SECONDS', 60)),
  },

  // E-mail dos convites e do "esqueci minha senha" (src/mail). 'none': os links aparecem na tela de acessos
  mail: {
    provider: env('MAIL_PROVIDER', 'none'),
  },

  // Intervalo entre envios no simulador, em segundos (os testes usam zero)
  simulatorPace: { min: 0.8, max: 2.2 },

  messaging: {
    provider: env('MESSAGING_PROVIDER', 'simulator'),
    wppconnect: {
      session: env('WPP_SESSION', 'studio-coral'),
      headless: bool('WPP_HEADLESS', 'true'),
      simulateTyping: bool('WPP_SIMULATE_TYPING', 'true'),
      tokensDir: path.join(dataDir, 'wpp-tokens'),
    },
    whatsappCloud: {
      token: env('WA_CLOUD_TOKEN', ''),
      phoneNumberId: env('WA_CLOUD_PHONE_NUMBER_ID', ''),
      apiVersion: env('WA_CLOUD_API_VERSION', 'v21.0'),
      verifyToken: env('WA_CLOUD_VERIFY_TOKEN', 'coral-webhook'),
      appSecret: env('WA_CLOUD_APP_SECRET', ''),
    },
  },
};
