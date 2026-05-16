import jwt from 'jsonwebtoken';
import { getPrimaryUserForSession, getUserById, mapUserToSession } from '../db/store.js';
import { EMERGENCY_USER_ID } from '../lib/emergencyAuth.js';
import { getAppSigningSecretForTokens } from '../lib/secrets.js';
import { SHOP_IDS } from '../lib/shops.js';

function readToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

export async function authMiddleware(req, res, next) {
  const token = readToken(req);
  if (!token) {
    const allowAnonymous = String(process.env.ALLOW_UNAUTHENTICATED_API || '').toLowerCase() === 'true';
    if (!allowAnonymous) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const sessionUser = await getPrimaryUserForSession();
    if (!sessionUser) {
      return res.status(503).json({ error: 'No local user account is configured yet.' });
    }
    req.user = sessionUser;
    return next();
  }

  try {
    const payload = jwt.verify(token, getAppSigningSecretForTokens());
    if (payload.emergency === true && payload.sub === EMERGENCY_USER_ID) {
      req.user = {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
        role: 'admin',
        shops: Array.isArray(payload.shops) && payload.shops.length ? payload.shops : [...SHOP_IDS],
      };
      return next();
    }
    const user = await getUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    const session = mapUserToSession(user);
    /** Shops always follow the DB (see `shopsForUser`); do not let a stale JWT `shops` claim shrink access. */
    req.user = {
      ...session,
      shops: session.shops,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}