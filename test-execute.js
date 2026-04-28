const { spawn } = require('child_process');
const path = require('path');
const cp = spawn('node', ['bot.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    USER_ID: 'test_user',
    WINDOW_START_HOUR: '0',
    WINDOW_END_HOUR: '24',
    DRY_RUN: 'true',
    TEST_SELL_NOW: 'true',
    PRIVATE_KEY: '0x1234567890123456789012345678901234567890123456789012345678901234'
  }
});
cp.stdout.on('data', d => console.log(d.toString()));
cp.stderr.on('data', d => console.error(d.toString()));
