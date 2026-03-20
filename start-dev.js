#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function printHeader() {
  console.log();
  log('================================', 'blue');
  log('  Exchange Server - Full Stack', 'blue');
  log('================================', 'blue');
  console.log();
}

function checkCommand(cmd) {
  const { execSync } = require('child_process');
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function startServers() {
  printHeader();

  // Check Zig
  log('Checking Zig installation...', 'yellow');
  if (!checkCommand('zig')) {
    log('✗ Zig is not installed!', 'red');
    log('Download from: https://ziglang.org/download/', 'yellow');
    process.exit(1);
  }
  log('✓ Zig found', 'green');

  // Check Node.js
  log('Checking Node.js installation...', 'yellow');
  if (!checkCommand('node')) {
    log('✗ Node.js is not installed!', 'red');
    process.exit(1);
  }
  log('✓ Node.js found\n', 'green');

  // Install dependencies if needed
  if (!fs.existsSync('./node_modules')) {
    log('Installing root dependencies...', 'yellow');
    await runCommand('npm', ['install']);
  }

  if (!fs.existsSync('./frontend/node_modules')) {
    log('Installing frontend dependencies...', 'yellow');
    await runCommand('npm', ['install'], './frontend');
  }

  // Build backend if needed
  if (!fs.existsSync('./backend/zig-cache')) {
    log('Building Zig backend (first time)...', 'yellow');
    await runCommand('zig', ['build'], './backend');
  }

  log('\n================================', 'blue');
  log('Starting both servers...', 'green');
  log('================================\n', 'blue');

  log('Backend (Zig):   http://0.0.0.0:8000', 'yellow');
  log('Frontend (Vite): http://localhost:5173\n', 'yellow');

  // Start backend
  const backend = spawn('zig', ['build', 'run'], {
    cwd: './backend',
    stdio: 'inherit',
    shell: true,
  });

  // Start frontend
  const frontend = spawn('npm', ['run', 'dev'], {
    cwd: './frontend',
    stdio: 'inherit',
    shell: true,
  });

  // Handle termination
  process.on('SIGINT', () => {
    log('\nShutting down servers...', 'yellow');
    backend.kill();
    frontend.kill();
    process.exit(0);
  });

  backend.on('error', (err) => {
    log(`Backend error: ${err.message}`, 'red');
  });

  frontend.on('error', (err) => {
    log(`Frontend error: ${err.message}`, 'red');
  });
}

function runCommand(cmd, args, cwd = '.') {
  return new Promise((resolve, reject) => {
    const process = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
  });
}

startServers().catch((err) => {
  log(`Error: ${err.message}`, 'red');
  process.exit(1);
});
