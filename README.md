# btcmarketscanner-cli

BTC Market Scanner - Automated Futures Trading Bot CLI

## Quick Start (Basic Commands)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Setup environment variables

Create `.env` file in the cli directory:

```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
OPENCLAW_API_KEY=your_openclaw_key (optional, for validation)
```

### 3. Run in development mode (local testing)

```bash
pnpm dev
```

### 4. Build for production

```bash
pnpm build
```

### 5. Run production version

```bash
node dist/index.js
```

---

## Installation

```bash
pnpm link --global btcmarketscanner-core
```

```bash
pnpm add github:fatihmuhamadridho/btcmarketscanner-core#v0.0.3
```

## Environment Setup

Create `.env` file in the cli directory:

```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
OPENCLAW_API_KEY=your_openclaw_key (optional, for validation)
```

## Running with PM2

### 1. Install PM2 globally

```bash
npm install -g pm2
```

### 2. Build the CLI

```bash
pnpm build
```

### 3. Start the bot with PM2

**Option A: Quick start**

```bash
pm2 start dist/index.js --name "btcmarketscanner" --env production
```

**Option B: Using ecosystem.config.cjs (recommended)**

```bash
pm2 start ecosystem.config.cjs
```

This uses pre-configured settings:

- Auto-restart on crash
- Memory limit: 512MB
- Logs with rotation
- Graceful shutdown (10s timeout)
- Max 10 restart attempts

### 4. View logs

```bash
# Real-time logs
pm2 logs btcmarketscanner

# Last 100 lines
pm2 logs btcmarketscanner --lines 100

# Specific log file
tail -f ./logs/output.log
tail -f ./logs/error.log
```

### 5. Monitor status

```bash
# View all processes
pm2 list

# Detailed status
pm2 status btcmarketscanner

# Monitor in real-time
pm2 monit
```

### 6. Start on system boot (optional)

```bash
pm2 startup
pm2 save
```

This will auto-start the bot when your system reboots.

### 7. Stop/Restart/Delete

```bash
# Stop the bot
pm2 stop btcmarketscanner

# Restart the bot
pm2 restart btcmarketscanner

# Delete from PM2
pm2 delete btcmarketscanner
```

## Common pnpm Commands

| Command        | Description                                           |
| -------------- | ----------------------------------------------------- |
| `pnpm install` | Install all dependencies (run this after cloning)     |
| `pnpm dev`     | Start in development mode with hot-reload             |
| `pnpm build`   | Build the project for production (outputs to `dist/`) |
| `pnpm lint`    | Check code for linting errors                         |
| `pnpm format`  | Format code with prettier                             |
| `pnpm test`    | Run tests (if available)                              |
| `pnpm clean`   | Remove `dist/` and `node_modules/` folders            |

## Bot Command Line (Non-Interactive)

### Start a Trading Bot

```bash
pnpm bot start <symbol> <mode> <entryMid> <tp1> <tp2> [tp3]
```

**Parameters:**

- `<symbol>` - Trading pair (e.g., `BTCUSDT`, `ETHUSDT`)
- `<mode>` - Trading mode: `scalping` or `intraday`
- `<entryMid>` - Entry price (middle of entry zone)
- `<tp1>` - Take profit 1 price
- `<tp2>` - Take profit 2 price
- `[tp3]` - Optional take profit 3 price

**Example:**

```bash
pnpm bot start BTCUSDT scalping 43000 43500 44000 44500
```

This will:

- Start bot for BTCUSDT with scalping mode
- Entry zone: 42,570 - 43,430 (±1% from 43,000)
- Leverage: 5x, Stop Loss: 42,140 (2% below entry)
- Take Profits: 43,500 and 44,000
- Scan every 5 seconds for fills and orders

### Stop a Trading Bot

```bash
pnpm bot stop <symbol>
```

**Example:**

```bash
pnpm bot stop BTCUSDT
```

### Revalidate a Bot

```bash
pnpm bot revalidate <symbol>
```

or

```bash
pnpm revalidate <symbol>
```

**Example:**

```bash
pnpm bot revalidate BTCUSDT
pnpm revalidate BTCUSDT  # shorter version
```

### Watch All Active Bots

```bash
pnpm watch start
```

This will:

- Monitor all active bots in background
- Send Telegram notifications for fills, take profits, and stop losses
- Scan every 5 seconds
- Press `Ctrl+C` to stop

**Example:**

```bash
pnpm watch start
```

### Stop Watching

```bash
pnpm watch stop
```

or simply press `Ctrl+C`

## Usage Example (Complete Flow)

```bash
# 1. Build first (if needed)
pnpm build

# 2. Start a bot
pnpm bot start BTCUSDT scalping 43000 43500 44000

# 3. In another terminal, watch all bots
pnpm watch start

# 4. Stop the bot when done
pnpm bot stop BTCUSDT
```

Or in a bash script:

```bash
#!/bin/bash

# Setup environment
export NODE_ENV=production

# Build
pnpm build

# Start bot
pnpm bot start BTCUSDT scalping 43000 43500 44000 &
BOT_PID=$!

# Watch in background
pnpm watch start &
WATCH_PID=$!

# Wait for interrupt
trap "kill $BOT_PID $WATCH_PID" SIGINT
wait
```

## Development

### Local development (without PM2)

```bash
pnpm dev
```

### Development with PM2 (auto-restart on file changes)

```bash
# Start dev environment with auto-reload
pm2 start ecosystem.config.cjs --only btcmarketscanner-dev

# Monitor logs
pm2 logs btcmarketscanner-dev

# Stop dev process
pm2 stop btcmarketscanner-dev

# Delete from PM2
pm2 delete btcmarketscanner-dev
```

Dev mode features:

- 🔄 Auto-restart on `src/` file changes
- 📊 Higher memory limit (1024MB for dev flexibility)
- 📝 Separate logs: `logs/dev-output.log`
- ⚡ Watch delay: 1s
- Ink raw mode disabled for PM2 compatibility

**Note:** If you prefer simple interactive development without PM2 overhead, just run:

```bash
pnpm dev
```

### Production build

```bash
# Build for production
pnpm build

# Run built version
node dist/index.js

# Or with PM2 (production config)
pm2 start ecosystem.config.cjs
```

## Logs & Debugging

- **Bot logs**: `~/.btcmarketscanner/logs/`
- **PM2 logs**: `./logs/output.log`, `./logs/error.log`
- **Validation logs**: `~/.btcmarketscanner/logs/openclaw-validation/`

## Quick Reference

### Start & Stop

```bash
# Start production
pm2 start ecosystem.config.cjs

# Start only dev
pm2 start ecosystem.config.cjs --only btcmarketscanner-dev

# Stop all
pm2 stop all

# Restart production
pm2 restart btcmarketscanner

# Restart dev
pm2 restart btcmarketscanner-dev
```

### Logs

```bash
# Production logs
pm2 logs btcmarketscanner

# Dev logs
pm2 logs btcmarketscanner-dev

# All logs
pm2 logs

# Last 100 lines
pm2 logs btcmarketscanner --lines 100
```

### Monitoring

```bash
# List all processes
pm2 list

# Real-time monitor
pm2 monit

# Status detail
pm2 status
```

### Clean up

```bash
# Delete all
pm2 delete all

# Delete specific
pm2 delete btcmarketscanner-dev

# Save current state
pm2 save

# Remove startup hooks
pm2 unstartup
```

## Telegram Bot

Automate trading with AI-powered consensus analysis and OpenClaw validation via Telegram!

### Setup

Add these to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Quick Start

```bash
pnpm telegram-bot
```

### Trading Workflow

```
1. /scan BTCUSDT          ← Analyze consensus setup
2. /validate BTCUSDT      ← Validate with OpenClaw AI
3. /execute BTCUSDT       ← Start trading
4. /stop BTCUSDT          ← Stop bot
```

See [TELEGRAM_BOT.md](./TELEGRAM_BOT.md) for complete guide with examples.

## Common Issues

1. **"openclaw not found"** → Install openclaw: `npm install -g openclaw`
2. **API key missing** → Check `.env` file is properly set
3. **Permission denied** → Run with `sudo` if needed for PM2 startup
4. **Bot stops unexpectedly** → Check logs with `pm2 logs btcmarketscanner`
5. **Dev mode not auto-reloading** → Check file is saved in `src/` folder, may take 1-2s to trigger
6. **Too many restarts** → Check for syntax errors in code: `pnpm build` to validate
7. **Telegram bot not responding** → Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in `.env`
