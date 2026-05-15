/**
 * Point local Vite dev at the hosted Render API (same inventory/POS data as production).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, '.env.development.local.example');
const target = path.join(root, '.env.development.local');

if (!fs.existsSync(example)) {
  console.error('Missing .env.development.local.example');
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fs.copyFileSync(example, target);
  console.log('Created .env.development.local from example.\n');
} else {
  console.log('.env.development.local already exists (not overwritten).\n');
}

console.log(`Live API dev: npm run dev:live
Then open http://127.0.0.1:5174/aiosystem and sign in with your production account.

If login fails with a CORS error, add to Render MOTOR_WORLD_ORIGINS:
  http://localhost:5174,http://127.0.0.1:5174
`);
