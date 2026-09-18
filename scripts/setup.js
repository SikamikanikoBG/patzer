// `npm run setup` — dispatch to the platform's Stockfish installer.
// Windows → setup.ps1, everything else → setup.sh. Docker users never need this.
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..');
const win = process.platform === 'win32';
const result = win
  ? spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', join(root, 'setup.ps1')], { stdio: 'inherit' })
  : spawnSync('sh', [join(root, 'setup.sh')], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
