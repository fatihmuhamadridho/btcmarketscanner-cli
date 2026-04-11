import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const BUILD_SCRIPT = path.join(ROOT_DIR, 'scripts', 'build.mjs');
const ENTRYPOINT = path.join(ROOT_DIR, 'dist', 'index.js');

let child = null;
let watcher = null;
let restartTimer = null;
let restarting = false;
let shuttingDown = false;

function stopChild(signal = 'SIGTERM') {
  if (!child) {
    return;
  }

  child.kill(signal);
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [BUILD_SCRIPT], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });

    build.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Build failed with exit code ${code ?? 'unknown'}.`));
    });
  });
}

function runApp() {
  child = spawn(process.execPath, ['--import', './src/env.ts', ENTRYPOINT], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  child.on('exit', (code, signal) => {
    const wasRestarting = restarting;
    child = null;

    if (shuttingDown || wasRestarting) {
      return;
    }

    process.exit(code ?? (signal ? 1 : 0));
  });
}

async function rebuildAndRestart() {
  if (shuttingDown) {
    return;
  }

  restarting = true;
  stopChild('SIGTERM');

  try {
    await runBuild();
    runApp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    restarting = false;
  }
}

function scheduleRestart() {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    void rebuildAndRestart();
  }, 120);
}

function startWatcher() {
  watcher = fs.watch(SRC_DIR, { recursive: true }, (_eventType, filename) => {
    if (!filename) {
      return;
    }

    if (!/\.(ts|tsx)$/.test(filename)) {
      return;
    }

    scheduleRestart();
  });
}

function shutdown(signal = 'SIGTERM') {
  shuttingDown = true;

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  stopChild(signal);
}

process.on('SIGINT', () => {
  shutdown('SIGTERM');
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(0);
});

await runBuild();
runApp();
startWatcher();
