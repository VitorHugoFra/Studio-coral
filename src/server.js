const { createApp } = require('./app');

(async () => {
  const instance = await createApp();
  const { config, container } = instance;
  await instance.listen(config.port);
  const messaging = container.resolve('messaging');
  console.log(`
  ┌──────────────────────────────────────────────┐
  │  STUDIO CORAL · Plataforma de Disparos       │
  └──────────────────────────────────────────────┘
  Site:      ${config.publicUrl}
  Painel:    ${config.publicUrl}/app
  Login:     ${config.admin.email}
  Provedor:  ${messaging.getStatus().label}
`);

  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error(`✖ Não foi possível iniciar o Studio Coral: ${err.message}`);
  process.exit(1);
});
