 
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { artifactsDir } = require('./config');

const apiRoot = path.resolve(__dirname, '..');
const adminRoot = path.resolve(apiRoot, '../zaffabit');

const execute = (name, command, args, cwd) => {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    name,
    command: [command, ...args].join(' '),
    cwd,
    passed: result.status === 0,
    exitCode: result.status,
    durationMs: Date.now() - started,
    outputTail: `${result.stdout || ''}\n${result.stderr || ''}`
      .trim()
      .split('\n')
      .slice(-80)
      .join('\n'),
  };
};

const main = () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const checks = [
    execute('Admin Vitest', 'npm', ['test'], adminRoot),
    execute('Admin production build', 'npm', ['run', 'build'], adminRoot),
    execute('Backend Jest full suite', 'npm', ['run', 'test:full'], apiRoot),
  ];
  const result = {
    generatedAt: new Date().toISOString(),
    passed: checks.every((check) => check.passed),
    checks,
  };
  fs.writeFileSync(
    path.join(artifactsDir, 'functional-results.json'),
    JSON.stringify(result, null, 2),
  );
  for (const check of checks)
    console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name} (${check.durationMs} ms)`);
  return result;
};

if (require.main === module) main();
module.exports = { main };
