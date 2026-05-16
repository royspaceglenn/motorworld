import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/auth.js';
import { createUser, getUserByEmail, getUserById, mapUserToSession, updateUser } from '../db/store.js';
import { logActivity } from '../services/activityLogger.js';
import { normalizeLocalLogin } from '../lib/adminLogin.js';
import { EMERGENCY_USER_ID, tryEmergencyStaticCredentials } from '../lib/emergencyAuth.js';
import { getAppSigningSecretForTokens } from '../lib/secrets.js';
import { SHOP_IDS } from '../lib/shops.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

function signToken(user, { emergency = false } = {}) {
  const session = mapUserToSession(user);
  const body = {
    sub: session.id,
    role: session.role,
    email: session.email,
    displayName: session.displayName,
    shops: session.shops || [...SHOP_IDS],
  };
  if (emergency) {
    body.emergency = true;
    body.shops = [...SHOP_IDS];
  }
  return jwt.sign(body, getAppSigningSecretForTokens(), { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = normalizeLocalLogin(String(req.body?.email || ''));
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const emerg = tryEmergencyStaticCredentials(email, password);
    if (emerg) {
      const session = mapUserToSession(emerg);
      return res.json({
        token: signToken(emerg, { emergency: true }),
        user: session,
      });
    }

    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    await logActivity(user.id, 'LOGIN', { email: user.email });

    const session = mapUserToSession(user);
    return res.json({
      token: signToken(user),
      user: session,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Login failed.' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

router.post('/password', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === EMERGENCY_USER_ID) {
      return res.status(400).json({
        error: 'Password change is disabled while EMERGENCY_BYPASS_DB is active. Fix the database, then turn off emergency env vars.',
      });
    }
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    const password_hash = await bcrypt.hash(newPassword, 10);
    await updateUser(user.id, { password_hash });
    await logActivity(user.id, 'PASSWORD_CHANGE_SELF', { email: user.email });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to change password.' });
  }
});

router.post('/register', authMiddleware, async (req, res) => {
  try {
    if (req.user.id === EMERGENCY_USER_ID) {
      return res.status(403).json({
        error: 'Creating users is disabled while EMERGENCY_BYPASS_DB is active.',
      });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an administrator can create accounts.' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim();

    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password, and display name are required.' });
    }
    if (await getUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const created = await createUser({ email, password_hash, display_name: displayName, role: 'admin' });
    await logActivity(req.user.id, 'CREATE_USER', { email, role: 'admin' });

    return res.status(201).json({
      user: {
        id: created.id,
        email: created.email,
        displayName: created.display_name,
        role: created.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to register user.' });
  }
});

export default router;
