// PM2 untuk gateway WhatsApp Paddy (pm2 start ecosystem.paddy.config.cjs). Proses terpisah dari BCD (wa-gateway-bcd,
// port 3471): satu sesi Baileys = satu nomor WhatsApp, jadi nama, port dan
// folder sesi tidak boleh dibagi. Rahasia dimuat dari .env (gitignored).
module.exports = {
  apps: [
    {
      name: "wa-gateway-paddy",
      cwd: __dirname,
      script: "src/server.js",
      interpreter: "node",
      interpreter_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 20,
      // Jangan pakai watch: restart beruntun membuka koneksi WhatsApp berulang
      // dan menaikkan risiko nomor diblokir.
      watch: false,
    },
  ],
};
