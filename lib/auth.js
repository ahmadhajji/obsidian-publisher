/**
 * Authentication module - handles user registration, login, and sessions
 */

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { statements } = require('./db');

const SALT_ROUNDS = 12;
const SESSION_DURATION_DAYS = 30;

/**
 * Generate a secure random token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Register a new user
 */
async function registerUser(email, password, displayName = null) {
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
    }

    // Validate password
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    // Check if user exists
    const existing = statements.getUserByEmail.get(email.toLowerCase());
    if (existing) {
        throw new Error('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const userId = uuidv4();
    const name = displayName || email.split('@')[0];

    statements.createUser.run(userId, email.toLowerCase(), passwordHash, name);

    // Create session
    const session = createSession(userId);

    return {
        user: {
            id: userId,
            email: email.toLowerCase(),
            displayName: name
        },
        session
    };
}

/**
 * Login user with email and password
 */
async function loginUser(email, password) {
    const user = statements.getUserByEmail.get(email.toLowerCase());

    if (!user) {
        throw new Error('Invalid email or password');
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
        throw new Error('Invalid email or password');
    }

    // Create session
    const session = createSession(user.id);

    return {
        user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name
        },
        session
    };
}

/**
 * Create a new session for a user
 */
function createSession(userId) {
    const sessionId = uuidv4();
    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

    statements.createSession.run(
        sessionId,
        userId,
        token,
        expiresAt.toISOString()
    );

    return {
        token,
        expiresAt: expiresAt.toISOString()
    };
}

/**
 * Validate session token and return user
 */
function validateSession(token) {
    if (!token) return null;

    const session = statements.getSessionByToken.get(token);

    if (!session) return null;

    return {
        id: session.user_id,
        email: session.email,
        displayName: session.display_name,
        sessionId: session.id
    };
}

/**
 * Logout - invalidate session
 */
function logoutUser(token) {
    statements.deleteSession.run(token);
}

/**
 * Express middleware to attach user to request
 */
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '') ||
        req.cookies?.session_token;

    req.user = validateSession(token);
    next();
}

/**
 * Middleware to require authentication
 */
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

module.exports = {
    registerUser,
    loginUser,
    logoutUser,
    validateSession,
    authMiddleware,
    requireAuth
};
