const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    // ignore
  }
}

function getLogFileName() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `system-${y}-${m}-${day}.log`;
}

function writeToFile(level, msg) {
  try {
    const filePath = path.join(logDir, getLogFileName());
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${msg}\n`;
    fs.appendFileSync(filePath, logLine);
  } catch (err) {
    // Fallback if filesystem fails
  }
}

function formatArgs(args) {
  return args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');
}

// Override console.log
const originalLog = console.log;
console.log = function (...args) {
  const msg = formatArgs(args);
  writeToFile('INFO', msg);
  originalLog.apply(console, args);
};

// Override console.error
const originalError = console.error;
console.error = function (...args) {
  const msg = formatArgs(args);
  writeToFile('ERROR', msg);
  originalError.apply(console, args);
};

// Also capture warnings and info if needed, mapping them to log/error
const originalWarn = console.warn;
console.warn = function (...args) {
  const msg = formatArgs(args);
  writeToFile('WARN', msg);
  originalWarn.apply(console, args);
};

module.exports = {
  getLogDir: () => logDir,
};
