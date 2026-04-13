# Telegram Bot - BTC Market Scanner

Bot Telegram yang mengotomasi trading workflow dengan consensus analysis dan OpenClaw validation.

## 📋 Setup

Pastikan `.env` file sudah memiliki:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
BINANCE_API_KEY=your_binance_key
BINANCE_SECRET_KEY=your_binance_secret
```

## 🚀 Running the Bot

```bash
pnpm telegram-bot
```

Bot akan:

- ✅ Listen ke Telegram 24/7
- ✅ Analyze consensus setup
- ✅ Validate dengan OpenClaw AI
- ✅ Execute trades otomatis
- ✅ Send notifications to Telegram

## 📱 Trading Workflow

Bot mengikuti actual trading flow dengan 4 steps:

### 1. **SCAN** - Analyze Consensus Setup

```
/scan BTCUSDT
```

Bot akan:

- Analyze 6 timeframes (1m, 5m, 15m, 30m, 1h, 4h)
- Pick best setup berdasarkan grade rank
- Show entry zone, SL, TP levels
- Save data untuk validation

**Response:**

```
✅ Consensus built for BTCUSDT
Current Price: 42500.00

📊 Consensus Summary
Consensus Label: Long Breakout Setup
Setup: Long Breakout
Grade: A
Direction: LONG
Entry Zone: 42400.00 - 42600.00
Stop Loss: 42100.00
TP1: 43000.00
TP2: 44000.00
Risk/Reward: 1:2.4

Timeframes analyzed: 1m • 5m • 15m • 30m • 1H • 4H

Next step: /validate BTCUSDT
```

### 2. **VALIDATE** - Get OpenClaw Approval

```
/validate BTCUSDT
/validate BTCUSDT scalping
```

Bot akan:

- Send consensus setup ke OpenClaw AI
- Get validation dengan confidence score
- Return approved setup atau reasons untuk reject
- Save untuk execution

**Response (Accepted):**

```
✅ OpenClaw APPROVED the setup!
Confidence: 87%
Next Action: ready_to_enter

Setup: OpenClaw Suggested Long Setup
Grade: A
Direction: LONG
Entry Zone: 42400.00 - 42600.00
Stop Loss: 42100.00
TP1: 43000.00
TP2: 44000.00
Risk/Reward: 1:2.4

Execute trade: /execute BTCUSDT
```

**Response (Rejected):**

```
⚠️ OpenClaw REJECTED the setup
Confidence: 45%
Reason: Entry zone too close to resistance
Next Action: wait_for_new_data
```

### 3. **EXECUTE** - Start Trading

```
/execute BTCUSDT
```

Bot akan:

- Create entry orders di entry zone
- Place SL dan TP orders
- Monitor fills dan progress
- Send notifications kapan ada action

**Response:**

```
🚀 Bot started for BTCUSDT
Status: running
Entry Zone: 42400.00 - 42600.00
Stop Loss: 42100.00
TP1: 43000.00
TP2: 44000.00

Waiting for entry zone...
```

### 4. **STOP** - Close Bot

```
/stop BTCUSDT
```

## 📊 Complete Example Workflow

```
User: /scan BTCUSDT
Bot: Shows consensus setup across all timeframes

User: /validate BTCUSDT scalping
Bot: Validates with OpenClaw, shows confidence score

User: /execute BTCUSDT
Bot: Starts trading bot, waiting for entry

Bot: (after entry) TP1 hit! Closing 50%
Bot: (later) TP2 hit! Closing remaining

User: /stop BTCUSDT
Bot: Stops bot and cancels any pending orders
```

## 🔧 Commands Reference

| Command  | Format                      | Purpose                                    |
| -------- | --------------------------- | ------------------------------------------ |
| Scan     | `/scan <symbol>`            | Build consensus across timeframes          |
| Validate | `/validate <symbol> [mode]` | Validate with OpenClaw (scalping/intraday) |
| Execute  | `/execute <symbol>`         | Start trading based on validation          |
| Stop     | `/stop <symbol>`            | Stop active bot                            |

## 🎯 How It Works

### Data Flow

```
1. SCAN:
   Multiple Timeframes → Consensus Analysis → Best Setup

2. VALIDATE:
   Consensus Setup → OpenClaw AI → Validated Setup

3. EXECUTE:
   Validated Setup → Create Orders → Monitor Progress

4. NOTIFY:
   Events → Telegram Messages
```

### Storage

- Consensus data disimpan sementara (30 menit expiry)
- Validation result dapat di-use untuk execute
- Bot state di-track in-memory dan dalam files

## 🔒 Security

- Bot hanya respond ke TELEGRAM_CHAT_ID di .env
- Unauthorized chats ditolak
- Semua commands di-log untuk audit
- Binance API keys never exposed

## 🐛 Troubleshooting

### Command tidak work?

1. Check .env credentials
2. Verify Binance API access
3. Check logs: `pm2 logs telegram-bot`

### OpenClaw validation timeout?

- Timeout: 120 seconds
- Retry atau use different mode (scalping/intraday)

### Data expired?

- Consensus data expire setelah 30 menit
- Run `/scan` lagi untuk fresh data

## 📝 Logs

```bash
# Real-time logs
pm2 logs telegram-bot

# Last 100 lines
pm2 logs telegram-bot --lines 100
```

## 🚀 Production Setup

Gunakan PM2 untuk keep bot running 24/7:

```bash
# Start
pm2 start "pnpm telegram-bot" --name telegram-bot

# Logs
pm2 logs telegram-bot

# Monitor
pm2 monit
```

Enjoy trading! 🎉
