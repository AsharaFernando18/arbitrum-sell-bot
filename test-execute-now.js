const { spawn } = require('child_process');
const cp = spawn('node', ['bot.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    USER_ID: 'test_user',
    WINDOW_START_HOUR: '0',
    WINDOW_END_HOUR: '1', // Ensure now > end
    DRY_RUN: 'true',
  }
});
cp.stdout.on('data', d => console.log(d.toString()));
cp.stderr.on('data', d => console.error(d.toString()));
