/**
 * Migration Script: Single-user local config → Multi-user Supabase
 *
 * This script migrates existing local .env and bot-state.json
 * to Supabase database, creating an admin user with the existing credentials.
 *
 * Usage: node scripts/migrate-local-to-supabase.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { createUser, saveUserConfig, getUserByEmail, updateBotStatus } = require("../lib/database");

const ENV_PATH = path.join(__dirname, '..', '.env');
const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(__dirname, '..', 'backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backupFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`✅ Backed up: ${path.basename(src)}`);
  return true;
}

async function migrate() {
  console.log('🚀 Starting migration from local to Supabase...\n');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
    console.error('   Add these to your .env file before running migration.');
    process.exit(1);
  }

  ensureDir(BACKUP_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupLabel = timestamp.split('T')[0];

  console.log('📦 Creating backups...');

  backupFile(ENV_PATH, path.join(BACKUP_DIR, `.env.backup.${backupLabel}`));
  backupFile(path.join(DATA_DIR, 'bot-state.json'), path.join(BACKUP_DIR, `bot-state.json.${backupLabel}`));
  backupFile(path.join(DATA_DIR, 'history.jsonl'), path.join(BACKUP_DIR, `history.jsonl.${backupLabel}`));

  console.log('\n📖 Reading local configuration...');

  if (!fs.existsSync(ENV_PATH)) {
    console.error('❌ Error: .env file not found');
    process.exit(1);
  }

  const envContent = fs.readFileSync(ENV_PATH, 'utf8');
  const env = require('dotenv').parse(envContent);

  const {
    DASHBOARD_USERNAME,
    DASHBOARD_PASSWORD,
    PRIVATE_KEY,
    RPC_URL,
    TOKEN_ADDRESS,
    USDT_ADDRESS,
    MIN_USDT,
    MAX_USDT,
    MAX_DAILY_USDT,
    WINDOW_START_HOUR,
    WINDOW_END_HOUR,
    SLIPPAGE_BPS,
    MAX_GAS_GWEI,
    DRY_RUN,
  } = env;

  if (!DASHBOARD_USERNAME || !DASHBOARD_PASSWORD) {
    console.error('❌ Error: DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set in .env');
    console.error('   These are required to create the admin user in Supabase.');
    process.exit(1);
  }

  if (!PRIVATE_KEY) {
    console.error('❌ Error: PRIVATE_KEY must be set in .env');
    console.error('   This is required to create the admin user config.');
    process.exit(1);
  }

  console.log(`   Username: ${DASHBOARD_USERNAME}`);
  console.log(`   RPC URL: ${RPC_URL || 'default (Arbitrum)'}`);
  console.log(`   Token: ${TOKEN_ADDRESS}`);
  console.log(`   USDT: ${USDT_ADDRESS}`);

  console.log('\n👤 Creating admin user in Supabase...');

  const existingUser = await getUserByEmail(DASHBOARD_USERNAME);

  if (existingUser) {
    console.log(`⚠️  User "${DASHBOARD_USERNAME}" already exists in database.`);
    console.log('   Updating existing user configuration...');
  } else {
    console.log(`   Creating new user: ${DASHBOARD_USERNAME}`);
    const result = await createUser(DASHBOARD_USERNAME, DASHBOARD_PASSWORD, 'admin');
    if (!result.success) {
      console.error(`❌ Error creating user: ${result.error}`);
      process.exit(1);
    }
    console.log('   ✅ Admin user created');
  }

  const user = existingUser || (await getUserByEmail(DASHBOARD_USERNAME));

  if (!user) {
    console.error('❌ Error: Could not retrieve user after creation');
    process.exit(1);
  }

  console.log('\n🔐 Migrating trading configuration...');

  const tradingParams = {
    MIN_USDT,
    MAX_USDT,
    MAX_DAILY_USDT,
    WINDOW_START_HOUR,
    WINDOW_END_HOUR,
    SLIPPAGE_BPS,
    MAX_GAS_GWEI,
    DRY_RUN,
  };

  const config = {
    rpcUrl: RPC_URL,
    tokenAddress: TOKEN_ADDRESS,
    usdtAddress: USDT_ADDRESS,
    tradingParams,
    privateKey: PRIVATE_KEY,
  };

  const saveResult = await saveUserConfig(user.id, DASHBOARD_PASSWORD, config);

  if (!saveResult.success) {
    console.error(`❌ Error saving config: ${saveResult.error}`);
    process.exit(1);
  }

  console.log('   ✅ Trading configuration saved');
  console.log(`   ✅ Private key encrypted with user password`);

  console.log('\n📊 Migration summary:');
  console.log(`   User ID: ${user.id}`);
  console.log(`   Email: ${DASHBOARD_USERNAME}`);
  console.log(`   Role: admin`);
  console.log(`   Config saved: ✅`);
  console.log(`   Backups created: ${backupLabel}`);
  console.log(`\n🎉 Migration completed successfully!`);
  console.log('\n⚠️  Important notes:');
  console.log('   1. Login with email and password to access the dashboard');
  console.log('   2. Your existing bot configuration has been migrated to Supabase');
  console.log('   3. Local .env file has been backed up');
  console.log('   4. Do NOT delete backup files until you verify the migration works');
  console.log(`\n📁 Backup location: ${BACKUP_DIR}`);
}

migrate().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
