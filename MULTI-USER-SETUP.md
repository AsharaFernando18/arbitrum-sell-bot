# Multi-User Supabase Setup Guide

This guide explains how to set up the multi-user mode with Supabase database integration.

## Overview

The bot now supports:
- **Multi-user authentication** via Supabase Auth
- **Encrypted private key storage** (encrypted with user password)
- **Independent bot instances** per user
- **Admin panel** for user management
- **Role-based access control** (admin vs regular users)

## Prerequisites

1. **Supabase Account**: Create a free account at https://supabase.com
2. **Node.js 18+**: Already installed
3. **npm dependencies**: Run `npm install` to install Supabase client

## Step 1: Create Supabase Project

1. Go to https://supabase.com/dashboard
2. Click "New Project"
3. Name it (e.g., "arbitrum-sell-bot")
4. Wait for project creation (~2 minutes)

## Step 2: Set Up Database

1. In your Supabase project, go to **SQL Editor**
2. Open the file `supabase-migrations.sql` from this repository
3. Copy and paste the SQL content into the SQL Editor
4. Click "Run" to execute the SQL
5. This creates:
   - `users` table (authentication)
   - `user_configs` table (encrypted configs)
   - `user_bots` table (bot status tracking)
   - Row Level Security (RLS) policies

## Step 3: Get API Credentials

1. In Supabase dashboard, go to **Project Settings** → **API**
2. Copy:
   - **Project URL** (starts with `https://xxx.supabase.co`)
   - **anon/public key** (long string starting with `eyJ...`)

## Step 4: Configure Environment

Add to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

Optional: Add additional encryption layer (recommended):
```bash
ENCRYPTION_KEY=your-32-byte-hex-string
```

## Step 5: Migrate Existing Data (Optional)

If you have an existing single-user setup with data in `.env` and `data/`, run:

```bash
node scripts/migrate-local-to-supabase.js
```

This will:
- Create an admin user in Supabase with your existing credentials
- Migrate your trading configuration to the database
- Back up all local files to `backup/` directory
- Do NOT delete existing files (manual cleanup required)

**⚠️ Important**: Keep the backup files until you verify everything works!

## Step 6: Start the Dashboard

```bash
npm run ui
```

Open http://localhost:3000 in your browser.

## Step 7: Register New Users

1. Click "Register" on the login screen
2. Enter email and password
3. User is created in Supabase and can log in

## Step 8: Configure User Wallet

1. Log in as the new user
2. Go to "Configuration" tab
3. Enter:
   - Private Key (will be encrypted with user password)
   - RPC URL
   - Token/USDT addresses
   - Trading parameters (min/max USDT, etc.)
4. Click "Save Configuration"

## Step 9: Start User's Bot

**As Admin**:
1. Go to "Admin Panel" (visible if admin user)
2. Click "Start" button next to a user
3. Enter user's password (required to decrypt private key)
4. User's bot will start independently

**As Regular User**:
1. Go to "Dashboard" tab
2. Click "Start Bot"
3. Enter your password (required to decrypt private key)
4. Your bot will start

## User Bot Process Isolation

Each user gets:
- **Independent bot process** (separate PID)
- **Separate data directory**: `data/{userId}/`
- **Independent scheduling**: Random sell times per user
- **Independent configuration**: Loaded from Supabase on bot start

## Security Features

1. **Password-based encryption**: Private keys encrypted with user's password
2. **No plaintext keys**: Private keys never stored unencrypted
3. **Row Level Security**: Users can only access their own data via database
4. **Role-based access**: Admin panel restricted to users with `role='admin'`
5. **Session management**: Secure HTTP-only cookies with 7-day expiration

## API Endpoints

### Authentication
- `POST /api/register` - Register new user
- `POST /api/login` - Login (email/password)
- `POST /api/logout` - Logout
- `GET /api/user/me` - Get current user info

### User Configuration
- `GET /api/config` - Get user's config (requires password)
- `POST /api/config` - Save user's config (requires password)

### Bot Control
- `POST /api/bot/start` - Start bot (requires password for decryption)
- `POST /api/bot/stop` - Stop bot
- `GET /api/status` - Get bot status

### Admin Panel (admin only)
- `GET /api/admin/users` - List all users with bot status
- `DELETE /api/admin/users/:id` - Delete user
- `POST /api/admin/users/:id/start` - Start user's bot
- `POST /api/admin/users/:id/stop` - Stop user's bot

## Troubleshooting

### "Supabase is not enabled"
- Check `.env` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Restart dashboard after adding credentials

### "Configuration not found"
- User needs to configure wallet first
- Try re-saving configuration with correct password

### "Failed to decrypt private key"
- Wrong password provided
- Verify you're using the correct password

### Database connection errors
- Check Supabase credentials are correct
- Verify network connectivity
- Check Supabase project status

## Migration Checklist

Before running migration:
- [ ] Backup your current `.env` file
- [ ] Note your current bot configuration
- [ ] Have Supabase project ready
- [ ] Ran `supabase-migrations.sql` in Supabase SQL Editor

After migration:
- [ ] Verify admin user appears in Supabase Auth → Users
- [ ] Test login with migrated credentials
- [ ] Check bot starts successfully
- [ ] Verify trades execute correctly
- [ ] Keep backup files for at least 24 hours

## Reverting to Single-User Mode

If you need to revert to single-user mode:
1. Remove `SUPABASE_URL` and `SUPABASE_ANON_KEY` from `.env`
2. Restore from `backup/` directory if needed
3. Dashboard will fall back to single-user authentication
4. Use existing `.env` credentials (DASHBOARD_USERNAME/DASHBOARD_PASSWORD)
