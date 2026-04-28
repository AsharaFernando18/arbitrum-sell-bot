const crypto = require("crypto");
const { getAuth } = require('firebase-admin/auth');
const db = require("./database");

const COOKIE = "sellbot_sess";
const MAX_AGE_MS = 7 * 24 * 60 * 1000;

function getSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.DASHBOARD_PASSWORD ||
    "dev-insecure-change-me"
  );
}

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function signSession(userId, role = 'user', isLocal = false) {
  const payload = {
    exp: Date.now() + MAX_AGE_MS,
    uid: userId,
    role: role,
    isLocal: isLocal,
    n: crypto.randomBytes(8).toString("hex")
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== "string") {
    return false;
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return false;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) {
      return false;
    }
    return {
      userId: payload.uid,
      role: payload.role,
      isLocal: !!payload.isLocal,
      expiresAt: payload.exp,
    };
  } catch (e) {
    return false;
  }
}

function authCookieHeader(token) {
  // Cloudflare provides HTTPS, but the internal node app sees HTTP.
  // We should ideally set Secure; SameSite=None for cross-domain if needed, 
  // but since it's the same domain, SameSite=Lax with Secure is best.
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
    MAX_AGE_MS / 1000
  )}; Secure`;
}

function clearCookieHeader() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure`;
}

function isFirebaseEnabled() {
  return db.isDbInitialized();
}

function isAuthEnabled() {
  if (isFirebaseEnabled()) {
    return true;
  }
  return Boolean(
    (process.env.DASHBOARD_PASSWORD && process.env.DASHBOARD_PASSWORD.length > 0) ||
    (process.env.DASHBOARD_USERNAME && process.env.DASHBOARD_USERNAME.length > 0)
  );
}

function checkPassword(pw) {
  if (isFirebaseEnabled()) {
    throw new Error('Password checking is handled through Firebase auth in db');
  }
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return true;
  const a = Buffer.from(String(pw || ""), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function checkUsername(user) {
  if (isFirebaseEnabled()) {
    throw new Error('Username checking is handled through Firebase auth in db');
  }
  const expected = process.env.DASHBOARD_USERNAME;
  if (!expected) return true;
  const a = Buffer.from(String(user || ""), "utf8");
  const b = Buffer.from(String(expected), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function firebaseSignUp(email, password) {
  if (!isFirebaseEnabled()) {
    throw new Error('Firebase is not enabled');
  }

  const dbUser = await db.createUser(email, password, 'user');
  
  if (!dbUser.success) {
    return { success: false, error: dbUser.error };
  }

  return {
    success: true,
    user: {
      id: dbUser.user.id,
      email: dbUser.user.email,
      role: dbUser.user.role,
    },
  };
}

async function firebaseSignIn(email, password) {
  if (!isFirebaseEnabled()) {
    throw new Error('Firebase is not enabled');
  }

  const result = await db.verifyUser(email, password);

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    user: {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    }
  };
}

async function firebaseSignOut() {
  // With custom JWT cookies, sign out is just clearing the cookie.
  // There is no server-side state to clear for Firebase here.
  return { success: true };
}

async function verifyGoogleToken(idToken) {
  if (!isFirebaseEnabled()) {
    throw new Error('Firebase is not enabled');
  }

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    const email = decodedToken.email;
    const uid = decodedToken.uid;
    
    const result = await db.createGoogleUser(email, uid, 'user');
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    return {
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
      }
    };
  } catch (error) {
    console.error('Error verifying Google token:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  COOKIE,
  parseCookies,
  signSession,
  verifySession,
  authCookieHeader,
  clearCookieHeader,
  isAuthEnabled,
  isFirebaseEnabled,
  checkPassword,
  checkUsername,
  firebaseSignUp,
  firebaseSignIn,
  firebaseSignOut,
  verifyGoogleToken,
};
