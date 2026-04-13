import { executeCommand } from '@lib/command-handler';

async function main() {
  try {
    const args = process.argv.slice(2);
    const result = await executeCommand(args);

    if (result.message) {
      console.log(result.message);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${message}`);
    process.exit(1);
  }
}

main();
