import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const packageJsonPath = path.resolve(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const workspaceSpec = 'workspace:*';
const githubSpec = 'github:fatihmuhamadridho/btcmarketscanner-core#master';

if (mode !== 'workspace' && mode !== 'github') {
  console.error('Usage: node scripts/switch-core-dependency.mjs <workspace|github>');
  process.exit(1);
}

packageJson.dependencies ??= {};
packageJson.dependencies['btcmarketscanner-core'] = mode === 'workspace' ? workspaceSpec : githubSpec;

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log(`btcmarketscanner-core -> ${packageJson.dependencies['btcmarketscanner-core']}`);
