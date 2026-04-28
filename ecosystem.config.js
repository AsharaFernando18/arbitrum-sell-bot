module.exports = {
  apps: [
    {
      name: 'nexusflow-dashboard',
      script: 'dashboard.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        UI_PORT: 3000
      },
      out_file: "./logs/pm2-out.log",
      error_file: "./logs/pm2-error.log",
      merge_logs: true,
      time: true
    }
  ]
};
