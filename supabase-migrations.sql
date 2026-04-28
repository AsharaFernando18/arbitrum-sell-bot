-- Arbitrum Sell Bot Multi-User Schema
-- Run this in Supabase SQL Editor or via Supabase CLI

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User configurations table (encrypted private keys and settings)
CREATE TABLE IF NOT EXISTS user_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  private_key_encrypted TEXT,
  rpc_url TEXT,
  token_address TEXT,
  usdt_address TEXT,
  trading_params JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT unique_user_config UNIQUE (user_id)
);

-- Bot status tracking table
CREATE TABLE IF NOT EXISTS user_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bot_status TEXT NOT NULL DEFAULT 'stopped',
  next_sell_at TIMESTAMP WITH TIME ZONE,
  pid INTEGER,
  last_sell_at TIMESTAMP WITH TIME ZONE,
  last_tx_hash TEXT,
  last_error TEXT,
  today_usdt_total DECIMAL(18, 6) DEFAULT 0,
  day_key TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
-- Compare UUIDs directly
CREATE POLICY "Users can view own data" ON users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own data" ON users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE
  USING (auth.uid() = id);

-- RLS Policies for user_configs table
CREATE POLICY "User configs can view own data" ON user_configs
  FOR SELECT
  USING (auth.uid() = (SELECT id FROM users WHERE id = user_configs.user_id));

CREATE POLICY "User configs can insert own data" ON user_configs
  FOR INSERT
  WITH CHECK (auth.uid() = (SELECT id FROM users WHERE id = user_configs.user_id));

CREATE POLICY "User configs can update own data" ON user_configs
  FOR UPDATE
  USING (auth.uid() = (SELECT id FROM users WHERE id = user_configs.user_id));

-- RLS Policies for user_bots table
CREATE POLICY "User bots can view own data" ON user_bots
  FOR SELECT
  USING (auth.uid() = (SELECT id FROM users WHERE id = user_bots.user_id));

CREATE POLICY "User bots can insert own data" ON user_bots
  FOR INSERT
  WITH CHECK (auth.uid() = (SELECT id FROM users WHERE id = user_bots.user_id));

CREATE POLICY "User bots can update own data" ON user_bots
  FOR UPDATE
  USING (auth.uid() = (SELECT id FROM users WHERE id = user_bots.user_id));

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_configs_user_id ON user_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bots_user_id ON user_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bots_status ON user_bots(bot_status);
