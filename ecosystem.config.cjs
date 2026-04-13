module.exports = {
  apps: [
    {
      name: 'btcmarketscanner',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart configs
      watch: false,
      ignore_watch: ['node_modules', 'dist', 'logs', '.git'],
      max_restarts: 10,
      min_uptime: '10s',
      // Kill timeout (ms) before forcefully killing process
      kill_timeout: 5000,
      // Listen timeout for graceful shutdown
      listen_timeout: 3000,
      // Graceful shutdown
      shutdown_timeout: 10000,
      // Exponential backoff restart delay
      exp_backoff_restart_delay: 100,
    },
    // Development environment
    {
      name: 'btcmarketscanner-dev',
      script: 'pnpm',
      args: 'dev',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1024M',
      error_file: './logs/dev-error.log',
      out_file: './logs/dev-output.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
        // Disable Ink raw mode for PM2 compatibility with interactive CLI
        INK_IS_RAW_MODE_SUPPORTED: 'false',
      },
      // Watch source files for auto-restart
      watch: ['src'],
      ignore_watch: ['node_modules', 'dist', 'logs', '.git', '.env'],
      watch_delay: 1000,
      max_restarts: 5,
      min_uptime: '5s',
      kill_timeout: 3000,
      exp_backoff_restart_delay: 100,
    },
  ],
  deploy: {
    production: {
      user: 'node',
      host: 'your_server_ip',
      ref: 'origin/main',
      repo: 'git@github.com:fatihmuhamadridho/btcmarketscanner.git',
      path: '/var/www/btcmarketscanner',
      'post-deploy':
        'npm install && npm run build && pm2 reload ecosystem.config.cjs --env production',
    },
  },
};
