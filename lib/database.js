const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { encryptPrivateKey, decryptPrivateKey } = require('./crypto');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let db = null;
let isInitialized = false;

// Initialize Firebase
try {
  // Look for the JSON key file in the root directory
  const keyFile = fs.readdirSync(path.join(__dirname, '..')).find(f => f.includes('firebase-adminsdk') && f.endsWith('.json'));
  if (keyFile) {
    const serviceAccount = require(path.join(__dirname, '..', keyFile));
    initializeApp({
      credential: cert(serviceAccount)
    });
    db = getFirestore();
    isInitialized = true;
    console.log('[Database] Firebase initialized successfully');
  } else {
    console.warn('[Database] No Firebase Admin SDK key found. Database features will be disabled.');
  }
} catch (err) {
  console.error('[Database] Failed to initialize Firebase:', err.message);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return Buffer.concat([salt, key]).toString('hex');
}

function verifyPasswordHash(password, storedHashHex) {
  if (!storedHashHex) return false;
  try {
    const storedHash = Buffer.from(storedHashHex, 'hex');
    const salt = storedHash.slice(0, 16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const expectedHash = Buffer.concat([salt, key]).toString('hex');
    return expectedHash === storedHashHex;
  } catch (err) {
    return false;
  }
}

function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  const result = Array.isArray(obj) ? [] : {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = sanitize(obj[key]);
    }
  }
  return result;
}

function getFallbackKey(userId) {
  return crypto.createHash('sha256').update(userId + (process.env.SESSION_SECRET || 'fallback')).digest('hex');
}

async function createGoogleUser(email, uid, role = 'user') {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    const docRef = db.collection('users').doc(uid);
    const doc = await docRef.get();
    if (doc.exists) {
      return { success: true, user: doc.data() };
    }
    
    const userData = {
      id: uid,
      email,
      provider: 'google',
      role,
      created_at: new Date().toISOString()
    };

    await docRef.set(userData);
    return { success: true, user: userData };
  } catch (error) {
    console.error('Error creating Google user:', error);
    return { success: false, error: error.message };
  }
}

async function createUser(email, password, role = 'user') {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  if (!email || typeof email !== 'string') return { success: false, error: 'Valid email is required' };
  if (!password || typeof password !== 'string') return { success: false, error: 'Valid password is required' };
  try {
    // Check if user already exists
    const usersRef = db.collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();
    if (!snapshot.empty) {
      return { success: false, error: 'User already exists' };
    }

    const hashedPassword = hashPassword(password);
    const docRef = usersRef.doc();
    
    const userData = {
      id: docRef.id,
      email,
      encrypted_password_hash: hashedPassword,
      role,
      created_at: new Date().toISOString()
    };

    await docRef.set(userData);

    return { success: true, user: userData };
  } catch (error) {
    console.error('Error creating user:', error);
    return { success: false, error: error.message };
  }
}

async function getUserByEmail(email) {
  if (!isInitialized) return null;
  try {
    const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data();
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

async function getUserById(userId) {
  if (!isInitialized) return null;
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
}

async function verifyUser(email, password) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  if (!email || !password) return { success: false, error: 'Email and password are required' };
  const user = await getUserByEmail(email);
  if (!user) return { success: false, error: 'User not found' };

  if (verifyPasswordHash(password, user.encrypted_password_hash)) {
    return { success: true, user };
  } else {
    return { success: false, error: 'Invalid password' };
  }
}

async function getUserConfig(userId, password) {
  if (!isInitialized) return null;
  try {
    const doc = await db.collection('user_configs').doc(userId).get();
    if (!doc.exists) return null;
    const data = doc.data();

    const config = {
      rpcUrl: data.rpc_url,
      tokenAddress: data.token_address,
      usdtAddress: data.usdt_address,
      tradingParams: data.trading_params || {},
    };

    if (data.private_key_encrypted) {
      try {
        const encKey = password || getFallbackKey(userId);
        config.privateKey = decryptPrivateKey(data.private_key_encrypted, encKey);
      } catch (error) {
        console.warn('Failed to decrypt private key');
        config.privateKey = null;
      }
    }

    return config;
  } catch (error) {
    console.error('Error getting user config:', error);
    return null;
  }
}

async function saveUserConfig(userId, password, config) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    const encKey = password || getFallbackKey(userId);
    const encryptedKey = config.privateKey
      ? encryptPrivateKey(config.privateKey, encKey)
      : null;

    let configData = {
      user_id: userId,
      rpc_url: config.rpcUrl,
      token_address: config.tokenAddress,
      usdt_address: config.usdtAddress,
      trading_params: config.tradingParams || {},
      updated_at: new Date().toISOString()
    };
    
    if (encryptedKey !== null) {
      configData.private_key_encrypted = encryptedKey;
    }

    configData = sanitize(configData);

    await db.collection('user_configs').doc(userId).set(configData, { merge: true });

    return { success: true, config: configData };
  } catch (error) {
    console.error('Error saving user config:', error);
    return { success: false, error: error.message };
  }
}

async function getAllUsers() {
  if (!isInitialized) return [];
  try {
    const snapshot = await db.collection('users').get();
    const users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      users.push({
        id: data.id,
        email: data.email,
        role: data.role,
        created_at: data.created_at
      });
    });
    return users;
  } catch (error) {
    console.error('Error getting all users:', error);
    return [];
  }
}

async function deleteUser(userId) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    await db.collection('user_configs').doc(userId).delete();
    await db.collection('user_bots').doc(userId).delete();
    await db.collection('users').doc(userId).delete();
    return { success: true };
  } catch (error) {
    console.error('Error deleting user:', error);
    return { success: false, error: error.message };
  }
}

async function getBotStatus(userId) {
  if (!isInitialized) return null;
  try {
    const doc = await db.collection('user_bots').doc(userId).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (error) {
    console.error('Error getting bot status:', error);
    return null;
  }
}

async function getAllBotStatuses() {
  if (!isInitialized) return [];
  try {
    const snapshot = await db.collection('user_bots').get();
    const statuses = [];
    snapshot.forEach(doc => {
      statuses.push(doc.data());
    });
    return statuses;
  } catch (error) {
    console.error('Error getting all bot statuses:', error);
    return [];
  }
}

async function updateBotStatus(userId, status, botData = {}) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    let updateData = {
      user_id: userId,
      bot_status: status,
      updated_at: new Date().toISOString(),
      ...botData,
    };

    updateData = sanitize(updateData);

    await db.collection('user_bots').doc(userId).set(updateData, { merge: true });

    return { success: true, bot: updateData };
  } catch (error) {
    console.error('Error updating bot status:', error);
    return { success: false, error: error.message };
  }
}

async function clearBotStatus(userId) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    await db.collection('user_bots').doc(userId).delete();
    return { success: true };
  } catch (error) {
    console.error('Error clearing bot status:', error);
    return { success: false, error: error.message };
  }
}

function isDbInitialized() {
  return isInitialized;
}

async function getBotState(userId) {
  if (!isInitialized) return null;
  try {
    const doc = await db.collection('user_states').doc(userId).get();
    if (!doc.exists) return null;
    return doc.data();
  } catch (error) {
    console.error('Error getting bot state:', error);
    return null;
  }
}

async function saveBotState(userId, stateObj) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    const sanitized = sanitize(stateObj);
    await db.collection('user_states').doc(userId).set(sanitized, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving bot state:', error);
    return { success: false, error: error.message };
  }
}

async function appendHistory(userId, entryObj) {
  if (!isInitialized) return { success: false, error: 'Firebase not initialized' };
  try {
    const sanitized = sanitize(entryObj);
    const entryData = {
      ...sanitized,
      t: Date.now(),
    };
    await db.collection('user_histories').doc(userId).collection('history').add(entryData);
    return { success: true };
  } catch (error) {
    console.error('Error appending history:', error);
    return { success: false, error: error.message };
  }
}

async function getHistoryLines(userId, limit = 80) {
  if (!isInitialized) return [];
  try {
    const snapshot = await db.collection('user_histories')
      .doc(userId)
      .collection('history')
      .orderBy('t', 'desc')
      .limit(limit)
      .get();
    
    if (snapshot.empty) return [];
    
    const entries = [];
    snapshot.forEach(doc => {
      entries.push(doc.data());
    });
    
    return entries.reverse();
  } catch (error) {
    console.error('Error getting history:', error);
    return [];
  }
}

module.exports = {
  createUser,
  createGoogleUser,
  getUserByEmail,
  getUserById,
  verifyUser,
  getUserConfig,
  saveUserConfig,
  getAllUsers,
  deleteUser,
  getBotStatus,
  getAllBotStatuses,
  updateBotStatus,
  clearBotStatus,
  isDbInitialized,
  getBotState,
  saveBotState,
  appendHistory,
  getHistoryLines
};
