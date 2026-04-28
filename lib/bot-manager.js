const { spawn } = require('child_process');
const path = require('path');
const { updateBotStatus, clearBotStatus } = require('./database');

const userBotProcesses = new Map();
const DATA_DIR = path.join(__dirname, '..', 'data');

function getUserDataDir(userId) {
  const userDir = path.join(DATA_DIR, userId);
  return userDir;
}

function ensureUserDir(userId) {
  const userDir = getUserDataDir(userId);
  const fs = require('fs');
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

async function startUserBot(userId, password, onLog) {
  try {
    if (userBotProcesses.has(userId)) {
      const existingProcess = userBotProcesses.get(userId);
      if (existingProcess && !existingProcess.killed) {
        return {
          success: false,
          error: 'Bot is already running for this user',
          alreadyRunning: true,
        };
      }
    }

    const { updateBotStatus } = require('./database');
    const db = require('./database');
    const userConfig = await db.getUserConfig(userId, password);

    if (!userConfig) {
      return {
        success: false,
        error: 'User configuration not found or failed to decrypt with provided password',
      };
    }

    if (!userConfig.privateKey) {
      return {
        success: false,
        error: 'Private key not configured for this user',
      };
    }

    const env = {
      ...process.env,
      USER_ID: userId,
      PRIVATE_KEY: userConfig.privateKey,
      RPC_URL: userConfig.rpcUrl,
      TOKEN_ADDRESS: userConfig.tokenAddress,
      USDT_ADDRESS: userConfig.usdtAddress,
      ...userConfig.tradingParams,
    };

    const userDir = ensureUserDir(userId);

    const child = spawn('node', ['bot.js'], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    userBotProcesses.set(userId, child);

    child.on('exit', (code, signal) => {
      console.log(`User ${userId} bot exited (code=${code}, signal=${signal})`);
      userBotProcesses.delete(userId);
      clearBotStatus(userId);
    });

    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog('bot', line);
        console.log(`[USER:${userId}] ${line}`);
      }
    });

    child.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog('bot:err', line);
        console.error(`[USER:${userId}] ${line}`);
      }
    });

    const now = new Date();
    const nextSellTime = new Date(now);
    const startHour = parseInt(env.WINDOW_START_HOUR || '8');
    const endHour = parseInt(env.WINDOW_END_HOUR || '22');

    nextSellTime.setHours(startHour + Math.floor(Math.random() * (endHour - startHour)), 0, 0, 0);

    await updateBotStatus(userId, 'running', {
      pid: child.pid,
      next_sell_at: nextSellTime.toISOString(),
    });

    return {
      success: true,
      pid: child.pid,
      nextSellAt: nextSellTime.toISOString(),
    };
  } catch (error) {
    console.error(`Error starting bot for user ${userId}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function runInstantSell(userId, password, onLog) {
  try {
    const botProcess = userBotProcesses.get(userId);
    if (botProcess && !botProcess.killed) {
      return { success: false, error: 'Bot is already running. Please stop it first.' };
    }

    const db = require('./database');
    const userConfig = await db.getUserConfig(userId, password);

    if (!userConfig || !userConfig.privateKey) {
      return { success: false, error: 'Private key not configured for this user' };
    }

    const env = {
      ...process.env,
      USER_ID: userId,
      RPC_URL: userConfig.rpcUrl,
      PRIVATE_KEY: userConfig.privateKey,
      TOKEN_ADDRESS: userConfig.tokenAddress,
      ...userConfig.tradingParams,
      INSTANT_SELL: 'true'
    };

    const child = require('child_process').spawn('node', ['bot.js'], {
      cwd: require('path').join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog('bot', line);
        console.log(`[USER:${userId} INSTANT] ${line}`);
      }
    });

    child.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (onLog) onLog('bot:err', line);
        console.error(`[USER:${userId} INSTANT] ${line}`);
      }
    });

    return {
      success: true,
      message: 'Instant sell executed',
    };
  } catch (error) {
    console.error(`Error running instant sell for user ${userId}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function stopUserBot(userId) {
  try {
    const process = userBotProcesses.get(userId);
    if (!process) {
      await clearBotStatus(userId);
      return {
        success: true,
        message: 'Bot was not running',
      };
    }

    process.kill('SIGTERM');

    setTimeout(() => {
      if (userBotProcesses.has(userId)) {
        const p = userBotProcesses.get(userId);
        if (p && !p.killed) {
          p.kill('SIGKILL');
        }
      }
    }, 5000);

    await clearBotStatus(userId);

    return {
      success: true,
      message: 'Bot stopped',
    };
  } catch (error) {
    console.error(`Error stopping bot for user ${userId}:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function getUserBotStatus(userId) {
  try {
    const process = userBotProcesses.get(userId);
    const isRunning = process && !process.killed;

    const db = require('./database');
    const dbStatus = await db.getBotStatus(userId);

    return {
      userId,
      running: isRunning,
      pid: process?.pid || null,
      dbStatus: dbStatus || null,
    };
  } catch (error) {
    console.error(`Error getting bot status for user ${userId}:`, error);
    return {
      userId,
      running: false,
      error: error.message,
    };
  }
}

async function getAllUserBotStatuses() {
  const statuses = [];
  for (const userId of userBotProcesses.keys()) {
    const status = await getUserBotStatus(userId);
    statuses.push(status);
  }
  return statuses;
}

function stopAllBots() {
  const promises = [];
  for (const userId of userBotProcesses.keys()) {
    promises.push(stopUserBot(userId));
  }
  return Promise.all(promises);
}

function getActiveBotCount() {
  return userBotProcesses.size;
}

function getRunningUserIds() {
  return Array.from(userBotProcesses.keys());
}

async function recoverRunningBots() {
  const db = require('./database');
  try {
    const statuses = await db.getAllBotStatuses();
    let recoveredCount = 0;
    
    for (const status of statuses) {
      if (status.bot_status === 'running') {
        const userId = status.user_id;
        if (!userBotProcesses.has(userId)) {
          if (status.pid) {
            try {
              process.kill(status.pid, 0);
              process.kill(status.pid, 'SIGKILL');
              console.log(`[Recovery] Killed orphaned bot process (PID: ${status.pid}) for user ${userId}`);
            } catch (e) {
              // Process does not exist
            }
          }
          await db.updateBotStatus(userId, 'stopped', { pid: null });
          recoveredCount++;
        }
      }
    }
    if (recoveredCount > 0) {
      console.log(`[Recovery] Cleaned up ${recoveredCount} orphaned bot processes.`);
    }
  } catch (err) {
    console.error('[Recovery] Error recovering bots:', err);
  }
}

module.exports = {
  startUserBot,
  stopUserBot,
  getUserBotStatus,
  getAllUserBotStatuses,
  stopAllBots,
  getActiveBotCount,
  getRunningUserIds,
  getUserDataDir,
  ensureUserDir,
  recoverRunningBots,
  runInstantSell
};
