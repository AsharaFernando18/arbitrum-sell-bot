const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256');
}

function encrypt(text, password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

function decrypt(encryptedBase64, password) {
  const encrypted = Buffer.from(encryptedBase64, 'base64');

  const salt = encrypted.slice(0, SALT_LENGTH);
  const iv = encrypted.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = encrypted.slice(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = encrypted.slice(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function encryptPrivateKey(privateKey, password) {
  if (!privateKey || !password) {
    throw new Error('Private key and password are required for encryption');
  }
  return encrypt(privateKey, password);
}

function decryptPrivateKey(encryptedKey, password) {
  if (!encryptedKey || !password) {
    throw new Error('Encrypted key and password are required for decryption');
  }
  try {
    return decrypt(encryptedKey, password);
  } catch (error) {
    throw new Error('Failed to decrypt private key. Invalid password or corrupted data.');
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  return Buffer.concat([salt, key]).toString('hex');
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  encryptPrivateKey,
  decryptPrivateKey,
  hashPassword,
  generateSecureToken,
  ALGORITHM,
};
