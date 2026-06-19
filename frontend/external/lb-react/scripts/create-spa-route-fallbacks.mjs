import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const indexFile = join(distDir, 'index.html');
const routes = ['standard', 'language', 'question-crafter'];

if (!existsSync(indexFile)) {
  throw new Error(`Missing build output: ${indexFile}`);
}

for (const route of routes) {
  const routeDir = join(distDir, route);
  mkdirSync(routeDir, { recursive: true });
  copyFileSync(indexFile, join(routeDir, 'index.html'));
}

console.log(`Created SPA fallback folders: ${routes.join(', ')}`);
