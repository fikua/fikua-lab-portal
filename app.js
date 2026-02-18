// Theme toggle
(() => {
    const html = document.documentElement;
    const saved = localStorage.getItem('fikua-theme');
    if (saved) {
        html.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        html.setAttribute('data-theme', 'dark');
    }
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
            localStorage.setItem('fikua-theme', next);
        });
    }
})();

const API = '/admin';

// State
let profiles = [];
let presets = [];
let editingId = null;
let logEntries = [];
let logLineNumber = 0;
let logPollTimer = null;
let visibleLevels = new Set(['INFO', 'WARN', 'ERROR']);

// DOM refs
const activeProfileCard = document.getElementById('active-profile-card');
const profileList = document.getElementById('profile-list');
const presetSelector = document.getElementById('preset-selector');
const dialog = document.getElementById('profile-dialog');
const form = document.getElementById('profile-form');
const dialogTitle = document.getElementById('dialog-title');
const roleSelect = document.getElementById('profile-role');
const grantTypeSelect = document.getElementById('grant-type');
const issuerFields = document.getElementById('issuer-fields');
const verifierFields = document.getElementById('verifier-fields');
const haipFields = document.getElementById('haip-fields');
const logContainer = document.getElementById('log-container');

// =============================================================================
// Tabs
// =============================================================================

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');

        // Start/stop log polling based on tab visibility
        if (tab.dataset.tab === 'logs') {
            startLogPolling();
        } else {
            stopLogPolling();
        }
    });
});

// =============================================================================
// Profiles
// =============================================================================

async function api(path, options = {}) {
    const res = await fetch(API + path, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function loadProfiles() {
    profiles = await api('/profiles');
    renderProfiles();
    renderActiveProfile();
}

async function loadPresets() {
    presets = await api('/presets');
    presetSelector.innerHTML = '<option value="">Load from preset...</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        presetSelector.appendChild(opt);
    });
}

function renderActiveProfile() {
    const active = profiles.find(p => p.isActive);
    if (!active) {
        activeProfileCard.innerHTML = '<span class="loading">No active profile</span>';
        return;
    }
    activeProfileCard.className = 'profile-card active';
    activeProfileCard.innerHTML = `
        <div class="profile-info">
            <span class="profile-name">${esc(active.name)}</span>
            <span class="profile-role">${esc(active.role)}</span>
            <div class="profile-config">${formatConfig(active.config)}</div>
        </div>
    `;
}

function renderProfiles() {
    if (profiles.length === 0) {
        profileList.innerHTML = '<span class="loading">No profiles yet</span>';
        return;
    }
    profileList.innerHTML = profiles.map(p => `
        <div class="profile-card${p.isActive ? ' active' : ''}">
            <div class="profile-info">
                <span class="profile-name">${esc(p.name)}</span>
                <span class="profile-role">${esc(p.role)}</span>
                <div class="profile-config">${formatConfig(p.config)}</div>
            </div>
            <div class="profile-actions">
                ${!p.isActive ? `<button class="btn btn-success btn-sm" onclick="activateProfile('${p.id}')">Activate</button>` : ''}
                <button class="btn btn-sm" onclick="editProfile('${p.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteProfile('${p.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function formatConfig(config) {
    if (!config) return '';
    const parts = [];
    if (config.grantType) parts.push(config.grantType);
    if (config.credentialFormat) parts.push(config.credentialFormat);
    if (config.senderConstraining) parts.push(config.senderConstraining);
    if (config.clientAuth) parts.push(config.clientAuth);
    if (config.responseMode) parts.push(config.responseMode);
    if (config.clientIdPrefix) parts.push(config.clientIdPrefix);
    if (config.queryLanguage) parts.push(config.queryLanguage);
    if (config.par) parts.push('PAR');
    if (config.pkce) parts.push('PKCE ' + config.pkce);
    return parts.join(' · ');
}

async function activateProfile(id) {
    await api(`/profiles/${id}/activate`, { method: 'PUT' });
    await loadProfiles();
}

async function deleteProfile(id) {
    if (!confirm('Delete this profile?')) return;
    await api(`/profiles/${id}`, { method: 'DELETE' });
    await loadProfiles();
}

function editProfile(id) {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;
    editingId = id;
    dialogTitle.textContent = 'Edit Profile';
    populateForm(profile.name, profile.role, profile.config);
    dialog.showModal();
}

function openCreateDialog() {
    editingId = null;
    dialogTitle.textContent = 'New Profile';
    form.reset();
    updateFieldVisibility();
    dialog.showModal();
}

function populateForm(name, role, config) {
    document.getElementById('profile-name').value = name || '';
    roleSelect.value = role || 'issuer';

    if (config) {
        setVal('grant-type', config.grantType);
        setVal('credential-format', config.credentialFormat);
        setVal('sender-constraining', config.senderConstraining || '');
        setVal('client-auth', config.clientAuth || '');
        setVal('credential-offer', config.credentialOffer);
        setVal('response-enc', config.credentialResponseEnc);
        setVal('client-id-prefix', config.clientIdPrefix);
        setVal('response-mode', config.responseMode);
        setVal('query-language', config.queryLanguage);
        document.getElementById('par-required').checked = !!config.par;
        document.getElementById('pkce-required').checked = !!config.pkce;
    }
    updateFieldVisibility();
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el && value) el.value = value;
}

function buildConfigFromForm() {
    const role = roleSelect.value;
    const config = {};

    if (role === 'issuer' || role === 'wallet') {
        config.grantType = document.getElementById('grant-type').value || null;
        config.credentialFormat = document.getElementById('credential-format').value || null;
        const sc = document.getElementById('sender-constraining').value;
        if (sc) config.senderConstraining = sc;
        const ca = document.getElementById('client-auth').value;
        if (ca) config.clientAuth = ca;
        config.credentialOffer = document.getElementById('credential-offer').value || null;
        config.credentialResponseEnc = document.getElementById('response-enc').value || null;
        config.issuanceMode = 'immediate';
        config.authRequestType = 'simple';
        config.requestMethod = 'unsigned';

        if (config.grantType === 'authorization_code') {
            config.par = document.getElementById('par-required').checked || null;
            config.pkce = document.getElementById('pkce-required').checked ? 'S256' : null;
        }
    }

    if (role === 'verifier') {
        config.credentialFormat = document.getElementById('credential-format').value || null;
        config.clientIdPrefix = document.getElementById('client-id-prefix').value || null;
        config.responseMode = document.getElementById('response-mode').value || null;
        config.queryLanguage = document.getElementById('query-language').value || null;
        config.requestMethod = 'request_uri_signed';
    }

    return config;
}

function updateFieldVisibility() {
    const role = roleSelect.value;
    issuerFields.classList.toggle('hidden', role === 'verifier');
    verifierFields.classList.toggle('hidden', role !== 'verifier');

    const grantType = grantTypeSelect.value;
    haipFields.classList.toggle('hidden', grantType !== 'authorization_code');

    const scSelect = document.getElementById('sender-constraining');
    const caSelect = document.getElementById('client-auth');
    if (grantType === 'pre_authorization_code') {
        scSelect.value = '';
        scSelect.disabled = true;
        caSelect.value = '';
        caSelect.disabled = true;
    } else {
        scSelect.disabled = false;
        caSelect.disabled = false;
    }
}

// Profile event listeners
document.getElementById('btn-create').addEventListener('click', openCreateDialog);
document.getElementById('btn-cancel').addEventListener('click', () => dialog.close());
roleSelect.addEventListener('change', updateFieldVisibility);
grantTypeSelect.addEventListener('change', updateFieldVisibility);

presetSelector.addEventListener('change', () => {
    const preset = presets.find(p => p.name === presetSelector.value);
    if (preset) {
        editingId = null;
        dialogTitle.textContent = 'New Profile from Preset';
        populateForm(preset.name + ' (copy)', preset.role, preset.config);
        dialog.showModal();
    }
    presetSelector.value = '';
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profile-name').value;
    const role = roleSelect.value;
    const config = buildConfigFromForm();

    if (editingId) {
        await api(`/profiles/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, role, config })
        });
    } else {
        await api('/profiles', {
            method: 'POST',
            body: JSON.stringify({ name, role, config })
        });
    }

    dialog.close();
    await loadProfiles();
});

// =============================================================================
// Logs (Dozzle-style)
// =============================================================================

async function fetchLogs() {
    try {
        const res = await fetch('/admin/logs');
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
            appendLogEntries(data);
        }
    } catch {
        // Backend may not support /admin/logs yet — show demo logs
        if (logEntries.length === 0) {
            appendLogEntries(generateDemoLogs());
        }
    }
}

function generateDemoLogs() {
    const now = new Date();
    const sources = ['FikuaLab', 'IssuerRoutes', 'ProfileRepository', 'DatabaseManager', 'AdminRoutes'];
    const messages = [
        { level: 'INFO', source: 'FikuaLab', msg: 'Starting Fikua Lab server on port 8090' },
        { level: 'INFO', source: 'DatabaseManager', msg: 'PostgreSQL connection pool initialized (max: 10)' },
        { level: 'INFO', source: 'DatabaseManager', msg: 'Running Flyway migrations...' },
        { level: 'INFO', source: 'DatabaseManager', msg: 'Migrations complete — schema up to date' },
        { level: 'INFO', source: 'ProfileRepository', msg: 'Loaded 4 presets: [Plain Pre-Auth Issuer, HAIP Issuer, Plain Verifier, HAIP Verifier]' },
        { level: 'INFO', source: 'AdminRoutes', msg: 'Admin API registered: GET/POST /admin/profiles, GET /admin/presets, GET /admin/health' },
        { level: 'INFO', source: 'IssuerRoutes', msg: 'Issuer endpoints registered: /.well-known/*, /oid4vci/v1/*' },
        { level: 'INFO', source: 'FikuaLab', msg: 'Server started successfully — http://0.0.0.0:8090' },
        { level: 'INFO', source: 'AdminRoutes', msg: 'GET /admin/health — 200 (3ms)' },
        { level: 'INFO', source: 'AdminRoutes', msg: 'GET /admin/profiles — 200 (12ms)' },
        { level: 'INFO', source: 'IssuerRoutes', msg: 'GET /.well-known/openid-credential-issuer — 200 (5ms)' },
        { level: 'INFO', source: 'ProfileRepository', msg: 'Profile activated: HAIP Issuer (id=a1b2c3)' },
        { level: 'WARN', source: 'IssuerRoutes', msg: 'Token request without DPoP header — sender constraining required by active profile' },
        { level: 'INFO', source: 'IssuerRoutes', msg: 'POST /oid4vci/v1/token — 200 (45ms)' },
        { level: 'INFO', source: 'IssuerRoutes', msg: 'POST /oid4vci/v1/credential — 200 (128ms)' },
        { level: 'ERROR', source: 'IssuerRoutes', msg: 'Invalid proof JWT: nonce mismatch (expected=abc123, got=xyz789)' },
        { level: 'INFO', source: 'AdminRoutes', msg: 'GET /admin/profiles — 200 (8ms)' },
        { level: 'INFO', source: 'IssuerRoutes', msg: 'Credential offer created: pre-authorized_code (offer_id=o4f5g6)' },
        { level: 'WARN', source: 'DatabaseManager', msg: 'Connection pool usage at 80% (8/10 active)' },
        { level: 'INFO', source: 'FikuaLab', msg: 'Health check: all endpoints UP' },
    ];

    return messages.map((m, i) => {
        const t = new Date(now.getTime() - (messages.length - i) * 2300);
        return {
            timestamp: t.toISOString(),
            level: m.level,
            source: m.source,
            message: m.msg
        };
    });
}

function appendLogEntries(entries) {
    const wasAtBottom = isScrolledToBottom();
    const emptyEl = logContainer.querySelector('.log-empty');
    if (emptyEl) emptyEl.remove();

    entries.forEach(entry => {
        logLineNumber++;
        logEntries.push(entry);

        const level = (entry.level || 'INFO').toUpperCase();
        const line = document.createElement('div');
        line.className = `log-line log-line--${level.toLowerCase()}`;
        line.dataset.level = level;

        const time = entry.timestamp
            ? new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false })
            : new Date().toLocaleTimeString('en-GB', { hour12: false });

        line.innerHTML = `
            <span class="log-lineno">${logLineNumber}</span>
            <span class="log-time">${time}</span>
            <span class="log-level">${level}</span>
            <span class="log-source">${esc(entry.source || 'server')}</span>
            <span class="log-msg">${esc(entry.message || '')}</span>
        `;

        if (!visibleLevels.has(level)) {
            line.style.display = 'none';
        }

        logContainer.appendChild(line);
    });

    updateLogCount();

    if (wasAtBottom && document.getElementById('log-autoscroll').checked) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

function isScrolledToBottom() {
    return logContainer.scrollHeight - logContainer.scrollTop - logContainer.clientHeight < 50;
}

function updateLogCount() {
    const visible = logContainer.querySelectorAll('.log-line:not([style*="display: none"])').length;
    document.getElementById('log-count').textContent = `${visible} entries`;
}

function filterLogs() {
    logContainer.querySelectorAll('.log-line').forEach(line => {
        const level = line.dataset.level;
        line.style.display = visibleLevels.has(level) ? '' : 'none';
    });
    updateLogCount();
}

function startLogPolling() {
    if (logPollTimer) return;
    fetchLogs();
    logPollTimer = setInterval(fetchLogs, 5000);
}

function stopLogPolling() {
    if (logPollTimer) {
        clearInterval(logPollTimer);
        logPollTimer = null;
    }
}

// Log filter events
document.querySelectorAll('input[name="log-level"]').forEach(input => {
    input.addEventListener('change', () => {
        const filter = input.closest('.log-filter');

        if (input.value === 'all') {
            const isChecked = input.checked;
            document.querySelectorAll('input[name="log-level"]').forEach(cb => {
                cb.checked = isChecked;
                cb.closest('.log-filter').classList.toggle('selected', isChecked);
            });
            if (isChecked) {
                visibleLevels = new Set(['INFO', 'WARN', 'ERROR']);
            } else {
                visibleLevels.clear();
            }
        } else {
            filter.classList.toggle('selected', input.checked);
            if (input.checked) {
                visibleLevels.add(input.value);
            } else {
                visibleLevels.delete(input.value);
            }
            // Update "All" checkbox
            const allChecked = visibleLevels.size === 3;
            const allCb = document.querySelector('input[name="log-level"][value="all"]');
            allCb.checked = allChecked;
            allCb.closest('.log-filter').classList.toggle('selected', allChecked);
        }

        filterLogs();
    });
});

document.getElementById('btn-clear-logs').addEventListener('click', () => {
    logEntries = [];
    logLineNumber = 0;
    logContainer.innerHTML = '<div class="log-empty">Log cleared</div>';
    updateLogCount();
});

document.getElementById('btn-refresh-logs').addEventListener('click', () => {
    logEntries = [];
    logLineNumber = 0;
    logContainer.innerHTML = '<div class="log-empty">Refreshing...</div>';
    fetchLogs();
});

// =============================================================================
// Tools
// =============================================================================

document.getElementById('btn-reset-passkey').addEventListener('click', () => {
    if (!confirm('Reset the Wallet passkey? The wallet will open and clear its data.')) return;
    const walletCard = document.querySelector('a[href*="wallet"]');
    const walletBase = walletCard ? walletCard.href : 'http://localhost:3004';
    window.open(walletBase + '?reset=passkey', '_blank');
});

document.getElementById('btn-clear-storage').addEventListener('click', () => {
    if (!confirm('Clear ALL Fikua Lab data from this browser?')) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('fikua')) keys.push(key);
    }
    keys.forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
    alert(`Cleared ${keys.length} localStorage entries and sessionStorage.`);
});

// =============================================================================
// Utilities
// =============================================================================

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// =============================================================================
// Init
// =============================================================================

async function init() {
    try {
        await Promise.all([loadProfiles(), loadPresets()]);
    } catch (err) {
        console.warn('Backend not available:', err.message);
    }
}

init();
