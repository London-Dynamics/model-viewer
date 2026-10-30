// Applies patches/<package>+<version>+<name>.patch to node_modules/<package>
// when the installed version matches. Idempotent. See patches/README.md.
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'patches');
let failed = false;
for (const file of readdirSync(dir).filter((name) => name.endsWith('.patch')).sort()) {
  const [pkg, version] = file.replace(/\.patch$/, '').split('+');
  const pkgDir = join(root, 'node_modules', pkg);
  if (!existsSync(join(pkgDir, 'package.json'))) {
    console.warn(`[patches] ${file}: ${pkg} not installed, skipped`);
    continue;
  }
  const installed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  if (installed !== version) {
    console.error(`[patches] ${file}: expects ${pkg}@${version}, found ${installed}`);
    failed = true;
    continue;
  }
  const patch = join(dir, file);
  const run = (args) => execFileSync('patch', ['-p1', '-s', '-f', ...args, '-i', patch], {cwd: pkgDir, stdio: 'pipe'});
  try {
    run(['-R', '--dry-run']);
    console.log(`[patches] ${file}: already applied`);
    continue;
  } catch {}
  try {
    run(['--dry-run']);
    run([]);
    console.log(`[patches] ${file}: applied`);
  } catch (error) {
    console.error(`[patches] ${file}: does not apply\n${error.stdout || ''}${error.stderr || ''}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
