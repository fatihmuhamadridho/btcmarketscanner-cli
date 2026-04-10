import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }
    dotenv.config({ path: filePath, override: true });
}
loadEnvFile(path.resolve(process.cwd(), '.env'));
