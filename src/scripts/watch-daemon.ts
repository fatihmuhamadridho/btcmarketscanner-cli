/**
 * Watch daemon - runs continuously to monitor active bots and send Telegram notifications
 * Usage: pnpm watch (or use with PM2: pm2 start watch-daemon.mjs)
 */

import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';

const WATCH_INTERVAL_MS = 5000; // Check every 5 seconds

async function watchAllBots() {
  try {
    // Get all active bots and call recordProgress
    // This will trigger price notifications via Telegram

    // TODO: Need to implement getAllActiveBots() or track bots differently
    // For now, this daemon runs but needs integration with bot persistence

    console.log(`[watch-daemon] Checking active bots...`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[watch-daemon-error] ${errorMsg}`);
  }
}

async function main() {
  console.log('🔔 Watch daemon started - monitoring active bots for Telegram notifications');
  console.log('Press Ctrl+C to stop');

  // Run watch loop
  const watchInterval = setInterval(watchAllBots, WATCH_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(watchInterval);
    console.log('\n⏹️ Watch daemon stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initial check
  await watchAllBots();
}

main().catch((error) => {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[watch-daemon] Fatal error: ${errorMsg}`);
  process.exit(1);
});
