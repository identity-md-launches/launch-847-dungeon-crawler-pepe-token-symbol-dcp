// Local-only entry point. No installation, wallet key, RPC, hosted service or paid action.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required for built-in SQLite.');
const child = spawn(process.execPath, ['server/src/main.js'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DCP_DEMO: '1', DCP_ROLE: 'all', HOST: '127.0.0.1', DCP_WEB_ROOT: root + 'dist' },
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
