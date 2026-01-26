/**
 * OAuth Authentication Module - Handles Google OAuth2.0 sign-in
 */

const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { db, statements } = require('./db');

// OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

// Session duration
const SESSION_DURATION_DAYS = 30;

// Initialize Google OAuth client
let googleClient = null;
function getGoogleClient() {
    if (!googleClient && GOOGLE_CLIENT_ID) {
        googleClient = new OAuth2Client(
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET,
            GOOGLE_REDIRECT_URI
        );
    }
    return googleClient;
}

/**
 * Generate a secure random token
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Get Google OAuth authorization URL
 */
function getGoogleAuthUrl() {
    const client = getGoogleClient();
    if (!client) {
        throw new Error('Google OAuth not configured');
    }

    return client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile'
        ],
        prompt: 'consent'
    });
}

/**
 * Handle Google OAuth callback - exchange code for tokens and get user info
 */
async function handleGoogleCallback(code) {
    const client = getGoogleClient();
    if (!client) {
        throw new Error('Google OAuth not configured');
    }

    // Exchange code for tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Verify the ID token and get user info
    const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    // Extract user info
    const googleUser = {
        id: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        picture: payload.picture
    };

    // Find or create user
    const user = await findOrCreateOAuthUser('google', googleUser);

    // Create session
    const session = createSession(user.id);

    return {
        user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
            role: user.role
        },
        session
    };
}

/**
 * Find existing user by OAuth or create new one
 */
async function findOrCreateOAuthUser(provider, oauthUser) {
    // First, check if user exists by email
    let user = statements.getUserByEmail.get(oauthUser.email.toLowerCase());

    if (user) {
        // User exists - update OAuth fields if needed
        if (!user.oauth_provider) {
            db.prepare(`
                UPDATE users SET 
                    oauth_provider = ?,
                    oauth_id = ?,
                    avatar_url = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(provider, oauthUser.id, oauthUser.picture, user.id);
        } else if (user.avatar_url !== oauthUser.picture) {
            // Update avatar if changed
            db.prepare(`
                UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?
            `).run(oauthUser.picture, user.id);
        }
        // Re-fetch with updated data
        user = statements.getUserById.get(user.id);
    } else {
        // Create new user
        const userId = uuidv4();
        
        db.prepare(`
            INSERT INTO users (id, email, display_name, avatar_url, oauth_provider, oauth_id, role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            oauthUser.email.toLowerCase(),
            oauthUser.name,
            oauthUser.picture,
            provider,
            oauthUser.id,
            'member'
        );

        user = statements.getUserById.get(userId);

        // Check if this is the first user - make them admin
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        if (userCount.count === 1) {
            db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', userId);
            user.role = 'admin';
            console.log(`🎉 First user ${oauthUser.email} automatically set as admin!`);
        }
    }

    return user;
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

    // Get full user record with role
    const user = statements.getUserById.get(session.user_id);
    if (!user) return null;

    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        role: user.role || 'member',
        isBlocked: user.is_blocked === 1,
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
 * Check if user has required role
 */
function hasRole(user, requiredRoles) {
    if (!user) return false;
    if (user.isBlocked) return false;
    if (!Array.isArray(requiredRoles)) {
        requiredRoles = [requiredRoles];
    }
    return requiredRoles.includes(user.role);
}

/**
 * Check if user is admin
 */
function isAdmin(user) {
    return hasRole(user, 'admin');
}

/**
 * Check if user can moderate (admin or moderator)
 */
function canModerate(user) {
    return hasRole(user, ['admin', 'moderator']);
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
    if (req.user.isBlocked) {
        return res.status(403).json({ error: 'Your account has been suspended' });
    }
    next();
}

/**
 * Middleware to require admin role
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!isAdmin(req.user)) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

/**
 * Middleware to require moderator or admin role
 */
function requireModerator(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!canModerate(req.user)) {
        return res.status(403).json({ error: 'Moderator access required' });
    }
    next();
}

/**
 * Admin: Set user role
 */
function setUserRole(userId, role) {
    const validRoles = ['admin', 'moderator', 'member', 'blocked'];
    if (!validRoles.includes(role)) {
        throw new Error('Invalid role');
    }

    const isBlocked = role === 'blocked' ? 1 : 0;
    
    db.prepare(`
        UPDATE users SET role = ?, is_blocked = ?, updated_at = datetime('now') 
        WHERE id = ?
    `).run(role, isBlocked, userId);
}

/**
 * Admin: Block user
 */
function blockUser(userId) {
    setUserRole(userId, 'blocked');
}

/**
 * Admin: Unblock user (resets to member)
 */
function unblockUser(userId) {
    setUserRole(userId, 'member');
}

/**
 * Get all users (admin only)
 */
function getAllUsers() {
    return db.prepare(`
        SELECT id, email, display_name, avatar_url, role, is_blocked, created_at
        FROM users
        ORDER BY created_at DESC
    `).all();
}

/**
 * Check if OAuth is configured
 */
function isOAuthConfigured() {
    return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

module.exports = {
    getGoogleAuthUrl,
    handleGoogleCallback,
    validateSession,
    logoutUser,
    authMiddleware,
    requireAuth,
    requireAdmin,
    requireModerator,
    hasRole,
    isAdmin,
    canModerate,
    setUserRole,
    blockUser,
    unblockUser,
    getAllUsers,
    isOAuthConfigured,
    createSession
};
