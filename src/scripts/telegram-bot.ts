import 'dotenv/config';
import { telegramBotService } from '@services/telegram-bot.service';
import { cleanupResources } from '@lib/telegram-command-handler';

async function main() {
  console.log('🤖 Starting BTC Market Scanner Telegram Bot');
  console.log('========================================');

  // Check if all credentials are configured
  const missingCredentials = [];

  if (!process.env.TELEGRAM_BOT_TOKEN) missingCredentials.push('TELEGRAM_BOT_TOKEN');
  if (!process.env.TELEGRAM_CHAT_ID) missingCredentials.push('TELEGRAM_CHAT_ID');
  if (!process.env.BINANCE_API_KEY) missingCredentials.push('BINANCE_API_KEY');
  if (!process.env.BINANCE_SECRET_KEY) missingCredentials.push('BINANCE_SECRET_KEY');

  if (missingCredentials.length > 0) {
    console.error('❌ Error: Missing required credentials:');
    missingCredentials.forEach((cred) => {
      console.error(`  - ${cred}`);
    });
    console.error('Please set these in .env file');
    process.exit(1);
  }

  console.log('✅ All credentials configured');
  console.log(`   TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN?.substring(0, 10)}...`);
  console.log(`   TELEGRAM_CHAT_ID: ${process.env.TELEGRAM_CHAT_ID}`);
  console.log(`   BINANCE_API_KEY: ${process.env.BINANCE_API_KEY?.substring(0, 10)}...`);
  console.log(`   BINANCE_SECRET_KEY: ${process.env.BINANCE_SECRET_KEY?.substring(0, 10)}...`);

  // Start the bot polling
  try {
    // Register commands
    await telegramBotService.setMyCommands();

    await telegramBotService.pollUpdates();

    // Graceful shutdown
    const handleShutdown = async (signal: string) => {
      console.log(`\n📍 Received ${signal}, shutting down gracefully...`);
      await telegramBotService.stop();
      cleanupResources();
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    // Cleanup on uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[ERROR] Uncaught exception:', error);
      cleanupResources();
      process.exit(1);
    });

    console.log('✅ Telegram bot is running');
    console.log('📱 Available commands:');
    console.log('\n   Trading:');
    console.log('   /scan <symbol>         - Build consensus across timeframes');
    console.log('   /validate <symbol>     - Validate with OpenClaw');
    console.log('   /execute <symbol>      - Execute trade');
    console.log('   /stop <symbol>         - Stop active bot');
    console.log('\n   Auto Mode (Watch):');
    console.log('   /watch <symbol> ...    - Auto scan validate execute and restart');
    console.log('   /watching              - Show coins being watched');
    console.log('   /unwatch <symbol> ...  - Stop watching coins');
    console.log('\n   Market Data:');
    console.log('   /market [sub]          - Market overview with top 3s');
    console.log('   /top_volume            - Top 10 coins by 24h volume');
    console.log('   /top_gainers           - Top 10 gainers in 24h');
    console.log('   /top_losers            - Top 10 losers in 24h');
    console.log('\n   Configuration:');
    console.log('   /setup show            - Show current settings');
    console.log('   /setup leverage <val>  - Set leverage (1,2,5,10,20)');
    console.log('   /setup allocation ...  - Set allocation');
    console.log('   /setup margin <mode>   - Set margin mode');
    console.log('\nPress Ctrl+C to stop');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Fatal error: ${message}`);
    process.exit(1);
  }
}

main();
