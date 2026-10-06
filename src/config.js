const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = (key, fallback) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback);
const bool = (key, fallback) => String(env(key, fallback)).toLowerCase() === 'true';

const port = Number(env('PORT', 3000));

module.exports = {
  port,
  publicUrl: env('PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.join(__dirname, '..', 'data'),

  admin: {
    name: env('ADMIN_NAME', 'Equipe Studio Coral'),
    email: env('ADMIN_EMAIL', 'admin@studiocoral.com.br'),
    password: env('ADMIN_PASSWORD', 'coral123'),
  },
  sessionSecret: env('SESSION_SECRET', 'studio-coral-dev-secret'),

  messaging: {
    provider: env('MESSAGING_PROVIDER', 'simulator'),
    wppconnect: {
      session: env('WPP_SESSION', 'studio-coral'),
      headless: bool('WPP_HEADLESS', 'true'),
      simulateTyping: bool('WPP_SIMULATE_TYPING', 'true'),
      tokensDir: path.join(__dirname, '..', 'data', 'wpp-tokens'),
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
