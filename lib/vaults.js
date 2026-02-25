/**
 * Vault helpers and role-aware authorization.
 */

const { statements } = require('./db');
const { roleRank } = require('./publish');

function resolveVaultByIdOrSlug(value) {
    if (!value) {
        return statements.getDefaultVault.get() || null;
    }

    const byId = statements.getVaultById.get(value);
    if (byId) return byId;

    const bySlug = statements.getVaultBySlug.get(value);
    if (bySlug) return bySlug;

    return null;
}

function getDefaultVault() {
    return statements.getDefaultVault.get() || null;
}

function listVaultsForUser(user) {
    if (user?.role === 'admin') {
        return statements.listAllVaults.all();
    }

    return statements.listVaultsForUser.all(user?.id || null)
        .filter((vault) => vault.is_default === 1 || vault.user_role);
}

function getVaultRoleForUser(user, vaultId) {
    if (!user) return null;
    if (user.role === 'admin') return 'owner';

    const membership = statements.getUserVaultRole.get(user.id, vaultId);
    return membership?.role || null;
}

function userHasVaultRole(user, vaultId, minRole = 'viewer') {
    if (!vaultId) return false;

    if (!user) {
        if (minRole !== 'viewer') return false;
        const vault = statements.getVaultById.get(vaultId);
        return vault?.is_default === 1;
    }

    if (user?.role === 'admin') {
        return true;
    }

    const actualRole = getVaultRoleForUser(user, vaultId);
    return roleRank(actualRole) >= roleRank(minRole);
}

function authorizeVaultRole(minRole = 'viewer', options = {}) {
    const paramName = options.paramName || 'vaultId';

    return (req, res, next) => {
        const rawVault = req.params?.[paramName] || req.query?.vaultId || null;
        const vault = resolveVaultByIdOrSlug(rawVault);

        if (!vault) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        req.vault = vault;

        if (!userHasVaultRole(req.user, vault.id, minRole)) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        return next();
    };
}

module.exports = {
    resolveVaultByIdOrSlug,
    getDefaultVault,
    listVaultsForUser,
    getVaultRoleForUser,
    userHasVaultRole,
    authorizeVaultRole
};
