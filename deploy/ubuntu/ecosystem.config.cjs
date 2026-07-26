module.exports = {
  apps: [
    {
      name: "stcr-api",
      cwd: "/opt/stcr/current",
      script: "backend/src/server.mjs",
      interpreter: "/opt/stcr-node/bin/node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "768M",
      kill_timeout: 15000,
      listen_timeout: 60000,
      restart_delay: 5000,
      time: true,
      out_file: "/var/log/stcr/api-out.log",
      error_file: "/var/log/stcr/api-error.log",
      merge_logs: true,
      env: {
        NODE_ENV: "production",
        STCR_ENV_FILE: "/etc/stcr/stcr.env",
      },
    },
  ],
};
