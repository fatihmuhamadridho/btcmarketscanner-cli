import 'dotenv/config';
import https from 'https';

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set in environment');
  process.exit(1);
}

console.log(`✅ Bot token found: ${botToken.substring(0, 10)}...`);
console.log('');

function makeRequest<T>(path: string, method: string = 'GET', data?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
      } as Record<string, string>,
    };

    if (data) {
      options.headers['Content-Length'] = String(Buffer.byteLength(data));
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function testTelegramCommands() {
  console.log('🧪 Testing Telegram Commands Registration\n');

  try {
    // Step 1: Get current commands
    console.log('📋 Step 1: Getting current commands from Telegram...');
    const currentCommands = await makeRequest<any>('/getMyCommands', 'GET');
    console.log('Response:', JSON.stringify(currentCommands, null, 2));
    console.log('');

    // Step 2: Set commands
    console.log('📝 Step 2: Setting new commands...');
    const commands = [
      { command: 'scan', description: 'Analyze consensus setup across timeframes' },
      { command: 'validate', description: 'Validate setup with OpenClaw AI' },
      { command: 'execute', description: 'Execute trade based on validated setup' },
      { command: 'stop', description: 'Stop active trading bot' },
      { command: 'watch', description: 'Auto scan validate execute and restart on close' },
      { command: 'unwatch', description: 'Stop watching coins in auto mode' },
      { command: 'market', description: 'Market overview with aggregate stats' },
      { command: 'top_volume', description: 'Top 10 coins by 24h volume' },
      { command: 'top_gainers', description: 'Top 10 gainers in 24h' },
      { command: 'top_losers', description: 'Top 10 losers in 24h' },
      { command: 'setup', description: 'Configure trading settings' },
    ];

    const response = await makeRequest<any>('/setMyCommands', 'POST', JSON.stringify({ commands }));
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('');

    if (!response.ok) {
      console.error('❌ Failed to set commands. Response:', response);
      process.exit(1);
    }

    console.log('✅ Commands set successfully!');
    console.log('');

    // Step 3: Verify commands were set
    console.log('🔍 Step 3: Verifying commands were set...');
    const verifyCommands = await makeRequest<any>('/getMyCommands', 'GET');
    console.log('Response:', JSON.stringify(verifyCommands, null, 2));
    console.log('');

    if (verifyCommands.ok && verifyCommands.result && verifyCommands.result.length > 0) {
      console.log(`✅ Verification successful! Found ${verifyCommands.result.length} commands:`);
      verifyCommands.result.forEach((cmd: any) => {
        console.log(`   /${cmd.command} - ${cmd.description}`);
      });
    } else {
      console.error('❌ Verification failed. No commands found.');
      process.exit(1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${message}`);
    console.error('');
    console.error('Possible causes:');
    console.error('1. Invalid TELEGRAM_BOT_TOKEN');
    console.error('2. Network connectivity issue');
    console.error('3. Telegram API is down');
    process.exit(1);
  }
}

testTelegramCommands();
