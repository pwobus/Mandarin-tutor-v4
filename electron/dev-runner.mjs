import concurrently from 'concurrently';

const skipReasons = [];
const normalized = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

if (normalized(process.env.ELECTRON_DEV_SKIP) === '1' || normalized(process.env.ELECTRON_DEV_SKIP) === 'true') {
  skipReasons.push('ELECTRON_DEV_SKIP');
}

const isCI = normalized(process.env.CI);
if (isCI && isCI !== '0' && isCI !== 'false') {
  skipReasons.push('CI');
}

const isHeadlessLinux =
  process.platform === 'linux' &&
  normalized(process.env.ELECTRON_DEV_SKIP) !== '0' &&
  !process.env.DISPLAY &&
  !process.env.WAYLAND_DISPLAY;
if (isHeadlessLinux) {
  skipReasons.push('headless Linux (no DISPLAY/WAYLAND_DISPLAY)');
}

const commands = [
  {
    name: 'UI',
    prefixColor: 'cyan',
    command: 'cross-env BROWSER=none npm start',
  },
  {
    name: 'API',
    prefixColor: 'magenta',
    command: 'npm run server:dev',
  },
];

if (skipReasons.length === 0) {
  commands.push({
    name: 'ELECTRON',
    prefixColor: 'green',
    command: 'wait-on tcp:3000 tcp:8787 && cross-env ELECTRON_START_URL=http://localhost:3000 electron .',
  });
} else {
  const reasonText = skipReasons.join(', ');
  console.log(`[*] Skipping Electron launcher (${reasonText}). Set ELECTRON_DEV_SKIP=0 to force launch.`);
}

concurrently(commands, {
  killOthers: ['failure', 'success'],
  restartTries: 0,
})
  .result.then(
    () => {
      process.exit(0);
    },
    (err) => {
      if (!err) {
        process.exit(1);
        return;
      }
      const code = typeof err.exitCode === 'number' ? err.exitCode : 1;
      process.exit(code);
    },
  );
