// ============================================
// MAHADEV PANNEL — SEPARATE STANDALONE ADMIN CONTROL CENTER
// Connects directly to the shared Mahadev Pannel Firestore DB
// Works independently on GitHub Pages (Deploy from a branch -> / root)
// ============================================

const REQUIRED_ADMIN_ID = 'PANNELMANAGER@9405';
const REQUIRED_ADMIN_PASS = 'PANNEL@9405';

const FALLBACK_FIREBASE_CONFIG = {
    projectId: 'gen-lang-client-0381533713',
    appId: '1:356252889861:web:36ffd3c3e89d6de80b7d6c',
    apiKey: 'AIzaSyAdnWa1v22aGyq2080l6AvPJQ-CzCpYLjA',
    authDomain: 'gen-lang-client-0381533713.firebaseapp.com',
    firestoreDatabaseId: 'ai-studio-accountfunds-5affc735-803b-4d34-8888-f0c9ea1c95f3',
    storageBucket: 'gen-lang-client-0381533713.firebasestorage.app',
    messagingSenderId: '356252889861'
};

let _storePromise = null;
let _latestData = null;
let _unsubAdmin = null;
let _knownUserKeys = new Set();
let _knownUtrKeys = new Set();
let _knownSmsKeys = new Set();
let _hasHydratedOnce = false;
let _currentPeriod = 'all';
let _currentSearch = '';
let _currentUtrFilter = 'all';

function escapeHtml(val) {
    return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function maskAccountNumber(accNo) {
    const str = String(accNo || '').trim();
    if (!str) return 'XXXX';
    if (str.length <= 4) return str;
    return `${'X'.repeat(Math.max(4, str.length - 4))}${str.slice(-4)}`;
}

function getBankMiniSvg(bankName) {
    const clean = String(bankName || 'BANK').trim();
    const words = clean.split(/\s+/).filter(Boolean);
    const initials = words.length >= 2
        ? `${words[0][0]}${words[1][0]}`.toUpperCase()
        : clean.slice(0, 2).toUpperCase();
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
        hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    }
    const hue = Math.abs(hash) % 360;
    return `<svg width="26" height="26" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="20" fill="hsl(${hue}, 78%, 36%)"/>
        <text x="50" y="61" font-size="38" font-weight="800" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${escapeHtml(initials)}</text>
    </svg>`;
}

function toDateStr(ts) {
    if (!ts) return '';
    if (typeof ts === 'string') return ts.slice(0, 10);
    if (typeof ts === 'number') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
    }
    if (typeof ts === 'object') {
        if (typeof ts.toDate === 'function') return ts.toDate().toISOString().slice(0, 10);
        if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000).toISOString().slice(0, 10);
    }
    return '';
}

function formatTimeForLog(ts) {
    if (!ts) return 'Just now';
    try {
        let d;
        if (typeof ts === 'object' && ts !== null) {
            if (typeof ts.toDate === 'function') d = ts.toDate();
            else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
            else d = new Date(ts);
        } else {
            d = new Date(ts);
        }
        if (isNaN(d.getTime())) return 'Recently';
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
        return isToday ? `Today, ${t}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
    } catch {
        return 'Just now';
    }
}

function showAdminToast(message) {
    const container = document.getElementById('adminToastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'adm-toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4500);
}

function updateSyncStatusBadge(text, isWarn = false) {
    const el = document.getElementById('adminSyncStatusText');
    const dot = document.getElementById('admConnectionDot');
    if (el) {
        el.textContent = text;
        el.classList.toggle('is-warn', Boolean(isWarn));
    }
    if (dot) {
        dot.classList.toggle('is-offline', Boolean(isWarn));
    }
}

function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('adminConfirmModal');
        const titleEl = document.getElementById('adminConfirmTitle');
        const msgEl = document.getElementById('adminConfirmMessage');
        const cancelBtn = document.getElementById('adminConfirmCancelBtn');
        const okBtn = document.getElementById('adminConfirmOkBtn');
        if (!modal || !cancelBtn || !okBtn) {
            resolve(false);
            return;
        }
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        modal.style.display = 'flex';

        const cleanup = (result) => {
            modal.style.display = 'none';
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            modal.removeEventListener('click', onBackdrop);
            resolve(result);
        };
        const onCancel = () => cleanup(false);
        const onOk = () => cleanup(true);
        const onBackdrop = (e) => {
            if (e.target === modal) cleanup(false);
        };
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        modal.addEventListener('click', onBackdrop);
    });
}

function handleFirestoreError(error, operationType, path) {
    const errInfo = {
        error: error instanceof Error ? error.message : String(error),
        operationType,
        path,
        authInfo: {
            operator: sessionStorage.getItem('mahadev_admin_user') || localStorage.getItem('mahadev_admin_user') || null
        }
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
    return errInfo;
}

async function getAdminFirestoreStore() {
    if (_storePromise) return _storePromise;

    _storePromise = (async () => {
        let firebaseConfig = null;
        try {
            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 2500) : null;
            const res = await fetch('./firebase-applet-config.json', controller ? { signal: controller.signal } : undefined);
            if (timer) clearTimeout(timer);
            if (res.ok) {
                firebaseConfig = await res.json();
            }
        } catch {}
        if (!firebaseConfig) {
            firebaseConfig = FALLBACK_FIREBASE_CONFIG;
        }

        const [appMod, fsMod] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js')
        ]);

        const app = appMod.initializeApp(firebaseConfig);
        let db;
        try {
            db = fsMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfig.firestoreDatabaseId);
        } catch {
            db = fsMod.getFirestore(app, firebaseConfig.firestoreDatabaseId);
        }

        // Boot connection validation
        try {
            await fsMod.getDocFromServer(fsMod.doc(db, 'test', 'connection'));
            updateSyncStatusBadge('Firestore Connected', false);
        } catch (err) {
            if (err instanceof Error && err.message.includes('the client is offline')) {
                updateSyncStatusBadge('Offline — Retrying', true);
            }
        }

        const toDocId = (u) => (String(u || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || `user_${Date.now()}`).slice(0, 120);
        const safeId = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        const findUser = async (identifier) => {
            const cleanId = String(identifier || '').trim();
            if (!cleanId) return null;
            try {
                const directSnap = await fsMod.getDoc(fsMod.doc(db, 'users', toDocId(cleanId)));
                if (directSnap.exists()) return directSnap.data();
            } catch (e) {
                handleFirestoreError(e, 'get', `users/${toDocId(cleanId)}`);
            }
            try {
                const q = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('username', '==', cleanId), fsMod.limit(1));
                const s = await fsMod.getDocs(q);
                if (!s.empty) return s.docs[0].data();
            } catch {}
            return null;
        };

        const writeAct = async (username, actionType, details, category = 'activation', status = 'success') => {
            const id = safeId('ACT');
            const entry = {
                id,
                username: String(username || 'ADMIN').slice(0, 64),
                mobile: '',
                actionType: String(actionType || 'general').slice(0, 48),
                category: String(category || 'general').slice(0, 48),
                details: String(details || '').slice(0, 500),
                status: String(status || 'success').slice(0, 32),
                timestamp: new Date().toISOString()
            };
            try {
                await fsMod.setDoc(fsMod.doc(db, 'activityLogs', id), entry);
            } catch (e) {
                handleFirestoreError(e, 'create', `activityLogs/${id}`);
            }
            return entry;
        };

        const store = {
            async fetchAdminDashboardOnce() {
                const safeUsers = async () => {
                    try {
                        const s = await fsMod.getDocs(fsMod.collection(db, 'users'));
                        const map = {};
                        s.docs.forEach((d) => {
                            const data = d.data();
                            if (data?.username && data.username !== 'demo') {
                                map[data.username] = data;
                            }
                        });
                        return map;
                    } catch (e) {
                        handleFirestoreError(e, 'list', 'users');
                        return {};
                    }
                };
                const safeCol = async (colName, maxLimit) => {
                    try {
                        const s = await fsMod.getDocs(fsMod.query(fsMod.collection(db, colName), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(maxLimit)));
                        return s.docs.map((d) => d.data());
                    } catch {
                        try {
                            const s = await fsMod.getDocs(fsMod.collection(db, colName));
                            return s.docs.map((d) => d.data()).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, maxLimit);
                        } catch (e2) {
                            handleFirestoreError(e2, 'list', colName);
                            return [];
                        }
                    }
                };

                const [usersMap, utrs, activityLogs, smsLogs] = await Promise.all([
                    safeUsers(),
                    safeCol('utrs', 300),
                    safeCol('activityLogs', 500),
                    safeCol('smsLogs', 300)
                ]);
                return { usersMap, utrs, activityLogs, smsLogs };
            },

            subscribeAdminDashboard(cb) {
                let usersMap = {};
                let extraUsers = {};
                let utrs = [];
                let activityLogs = [];
                let smsLogs = [];
                let stopped = false;
                const extraUnsubs = new Map();

                const emit = () => {
                    if (stopped) return;
                    cb({
                        usersMap: { ...extraUsers, ...usersMap },
                        utrs,
                        activityLogs,
                        smsLogs
                    });
                };

                const watchExtraUser = (uname) => {
                    if (!uname || uname === 'demo' || uname === 'ADMIN' || uname === 'UNKNOWN' || usersMap[uname] || extraUnsubs.has(uname)) {
                        return;
                    }
                    const unsub = fsMod.onSnapshot(fsMod.doc(db, 'users', toDocId(uname)), (snap) => {
                        if (snap.exists()) {
                            const data = snap.data();
                            if (data?.username && data.username !== 'demo') {
                                extraUsers[data.username] = data;
                                emit();
                            }
                        }
                    }, () => {});
                    extraUnsubs.set(uname, unsub);
                };

                const u1 = fsMod.onSnapshot(fsMod.collection(db, 'users'), (snap) => {
                    const nextMap = {};
                    snap.docs.forEach((d) => {
                        const data = d.data();
                        if (data?.username && data.username !== 'demo') {
                            nextMap[data.username] = data;
                        }
                    });
                    usersMap = nextMap;
                    updateSyncStatusBadge('Live Sync Active', false);
                    emit();
                }, (err) => {
                    handleFirestoreError(err, 'list', 'users');
                    updateSyncStatusBadge('Sync Error', true);
                });

                const subCol = (colName, maxLimit, assign) => {
                    return fsMod.onSnapshot(
                        fsMod.query(fsMod.collection(db, colName), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(maxLimit)),
                        (snap) => {
                            const rows = snap.docs.map((d) => d.data());
                            rows.forEach((r) => {
                                if (r?.username) watchExtraUser(r.username);
                            });
                            assign(rows);
                            emit();
                        },
                        () => {
                            fsMod.onSnapshot(fsMod.collection(db, colName), (s2) => {
                                const rows = s2.docs.map((d) => d.data())
                                    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                                    .slice(0, maxLimit);
                                rows.forEach((r) => {
                                    if (r?.username) watchExtraUser(r.username);
                                });
                                assign(rows);
                                emit();
                            }, () => {});
                        }
                    );
                };

                const u2 = subCol('utrs', 300, (r) => { utrs = r; });
                const u3 = subCol('activityLogs', 500, (r) => { activityLogs = r; });
                const u4 = subCol('smsLogs', 300, (r) => { smsLogs = r; });

                return () => {
                    stopped = true;
                    u1(); u2(); u3(); u4();
                    extraUnsubs.forEach((fn) => { try { fn(); } catch {} });
                };
            },

            async adminApproveUtr(utrId, uname) {
                const ref = fsMod.doc(db, 'utrs', utrId);
                const snap = await fsMod.getDoc(ref);
                const data = snap.exists() ? snap.data() : null;
                const is199 = Boolean(data && (Number(data.amount) === 199 || String(data.type || '').includes('199') || String(data.type || '').toLowerCase().includes('upgrade')));
                await fsMod.updateDoc(ref, { status: is199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated' });
                const user = await findUser(uname);
                if (user) {
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), {
                        activated: true,
                        activationStatus: 'approved',
                        rejectionMessage: ''
                    });
                }
                await writeAct(
                    uname,
                    'activation',
                    is199
                        ? `Admin verified ₹199 UTR (${data?.utr || utrId}) and generated Payment Receipt for @${uname}`
                        : `Admin approved UTR (${data?.utr || utrId}) and started panel transactions for @${uname}`,
                    'activation',
                    'success'
                );
                return true;
            },

            async adminRejectUtr(utrId, uname) {
                await fsMod.updateDoc(fsMod.doc(db, 'utrs', utrId), { status: '❌ Rejected (Invalid UTR)' });
                const user = await findUser(uname);
                if (user) {
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), {
                        activated: false,
                        activationStatus: 'rejected',
                        rejectionMessage: 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.'
                    });
                }
                await writeAct(uname, 'activation', `Admin rejected UTR (${utrId}) for @${uname}`, 'activation', 'warning');
                return true;
            },

            async adminApproveUserPanel(uname) {
                const user = await findUser(uname);
                if (!user) return null;
                await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), {
                    activated: true,
                    activationStatus: 'approved',
                    rejectionMessage: ''
                });
                await writeAct(uname, 'activation', `Admin approved panel transactions for @${uname}`, 'activation', 'success');
                return { ...user, activated: true, activationStatus: 'approved', rejectionMessage: '' };
            },

            async adminRejectUserPayment(uname) {
                const user = await findUser(uname);
                if (!user) return null;
                const msg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), {
                    activated: false,
                    activationStatus: 'rejected',
                    rejectionMessage: msg
                });
                await writeAct(uname, 'activation', `Admin rejected payment for @${uname}`, 'activation', 'warning');
                return { ...user, activated: false, activationStatus: 'rejected', rejectionMessage: msg };
            },

            async adminDeleteUser(uname) {
                const user = await findUser(uname);
                if (!user) return false;
                await fsMod.deleteDoc(fsMod.doc(db, 'users', user.docId));
                try {
                    const utrSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'utrs'), fsMod.where('username', '==', uname)));
                    await Promise.allSettled(utrSnap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                } catch {}
                return true;
            },

            async adminClearLogs() {
                const snap = await fsMod.getDocs(fsMod.collection(db, 'activityLogs'));
                await Promise.all(snap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                return true;
            }
        };

        return store;
    })();

    return _storePromise;
}

function isAdminSessionActive() {
    return (
        sessionStorage.getItem('mahadev_admin_auth') === 'true' ||
        localStorage.getItem('mahadev_admin_auth') === 'true'
    );
}

function sendBrowserAlert(title, body, tagKey) {
    showAdminToast(`${title}: ${body}`);
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            const n = new Notification(title, { body, tag: tagKey || `mahadev-adm-${Date.now()}` });
            n.onclick = () => {
                try { window.focus(); } catch {}
                n.close();
            };
        } catch {}
    }
}

function applySnapshot(snapshot) {
    if (!snapshot) return;
    const users = snapshot.usersMap || {};
    const withdrawals = snapshot.utrs || [];
    const activityLogs = snapshot.activityLogs || [];
    const smsLogs = snapshot.smsLogs || [];

    _latestData = { users, withdrawals, activityLogs, smsLogs };

    const nextUserKeys = new Set(Object.keys(users));
    const nextUtrKeys = new Set(withdrawals.map((w) => w.id));
    const nextSmsKeys = new Set(smsLogs.map((s) => s.id));

    if (_hasHydratedOnce && isAdminSessionActive()) {
        for (const uname of nextUserKeys) {
            if (!_knownUserKeys.has(uname)) {
                const u = users[uname];
                sendBrowserAlert('New Member Registered', `@${uname} (+91 ${u?.mobile || 'Verified'})`, `reg-${uname}`);
                break;
            }
        }
        for (const w of withdrawals) {
            if (!_knownUtrKeys.has(w.id)) {
                sendBrowserAlert('New UTR Submitted', `@${w.username} • ₹${Number(w.amount || 0).toLocaleString('en-IN')} • UTR ${w.utr || '-'}`, `utr-${w.id}`);
                break;
            }
        }
    }

    _knownUserKeys = nextUserKeys;
    _knownUtrKeys = nextUtrKeys;
    _knownSmsKeys = nextSmsKeys;
    _hasHydratedOnce = true;

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    updateSyncStatusBadge(`Live Sync • ${nowTime}`, false);
    renderDashboard();
}

async function startSubscription() {
    if (_unsubAdmin) {
        _unsubAdmin();
        _unsubAdmin = null;
    }
    updateSyncStatusBadge('Connecting Firestore...', false);
    try {
        const store = await getAdminFirestoreStore();
        _unsubAdmin = store.subscribeAdminDashboard(applySnapshot);
        const initial = await store.fetchAdminDashboardOnce();
        if (initial) applySnapshot(initial);
    } catch (err) {
        handleFirestoreError(err, 'list', 'dashboard');
        updateSyncStatusBadge('Sync Error — Tap Sync Now', true);
    }
}

function stopSubscription() {
    if (_unsubAdmin) {
        _unsubAdmin();
        _unsubAdmin = null;
    }
}

function renderDashboard() {
    if (!isAdminSessionActive() || !_latestData) return;

    const { users, withdrawals, activityLogs, smsLogs } = _latestData;
    const todayDateStr = new Date().toISOString().slice(0, 10);

    const distinctToday = new Set();
    let totalLoginsToday = 0;
    let todayRegistrations = 0;
    let todayVolume = 0;
    let todayTxnCount = 0;
    let totalCommissionDue = 0;
    let activeRunning = 0;
    let activatedCount = 0;

    for (const [uname, u] of Object.entries(users)) {
        if (!u) continue;
        if (toDateStr(u.lastLoginAt) === todayDateStr) distinctToday.add(uname);
        if (Array.isArray(u.loginHistory)) {
            totalLoginsToday += u.loginHistory.filter((t) => toDateStr(t) === todayDateStr).length;
        }
        if (toDateStr(u.registeredAt) === todayDateStr) todayRegistrations++;
        if (u.activated) activatedCount++;
        if (u.activated && u.accountDetails) activeRunning++;
        totalCommissionDue += Number(u.commission || 0);
        if (Array.isArray(u.transactions)) {
            u.transactions.forEach((t) => {
                if (t && toDateStr(t.timestamp) === todayDateStr && (!t.type || t.type === 'credit')) {
                    todayVolume += Number(t.amount || 0);
                    todayTxnCount++;
                }
            });
        }
    }

    activityLogs.forEach((l) => {
        if (l && l.actionType === 'login' && toDateStr(l.timestamp) === todayDateStr && l.username !== 'ADMIN') {
            distinctToday.add(l.username);
        }
    });
    if (totalLoginsToday === 0 && distinctToday.size > 0) {
        totalLoginsToday = distinctToday.size;
    }

    const totalUsers = Object.keys(users).length;
    document.getElementById('metricTodayLogins').textContent = String(totalLoginsToday);
    document.getElementById('metricDistinctTodayUsers').textContent = `${distinctToday.size} Users`;
    document.getElementById('metricTodayRegistrations').textContent = String(todayRegistrations);
    document.getElementById('metricTotalUsersCount').textContent = `${totalUsers} Total`;
    document.getElementById('metricTodayVolume').textContent = `₹${todayVolume.toLocaleString('en-IN')}`;
    document.getElementById('metricTxnCountToday').textContent = `${todayTxnCount} credits`;
    document.getElementById('metricTotalCommission').textContent = `₹${totalCommissionDue.toLocaleString('en-IN')}`;
    document.getElementById('metricActiveRunning').textContent = String(activeRunning);
    document.getElementById('metricActivatedCount').textContent = `${activatedCount} Active`;

    document.getElementById('userRosterCountBadge').textContent = String(totalUsers);
    document.getElementById('withdrawalsCountBadge').textContent = String(withdrawals.length);
    document.getElementById('activityLogsCountBadge').textContent = String(activityLogs.length);
    document.getElementById('smsNotifCountBadge').textContent = String(smsLogs.length);

    renderUsersTable(users, withdrawals, activityLogs, todayDateStr);
    renderWithdrawalsTable(withdrawals);
    renderLogsTable(activityLogs, todayDateStr);
    renderSmsTable(smsLogs);
}

function renderUsersTable(users, withdrawals, activityLogs, todayDateStr) {
    const tbody = document.getElementById('userRosterTableBody');
    if (!tbody) return;

    let list = Object.values(users).filter(Boolean).sort((a, b) => {
        const ta = new Date(a.lastLoginAt || a.registeredAt || 0).getTime() || 0;
        const tb = new Date(b.lastLoginAt || b.registeredAt || 0).getTime() || 0;
        return tb - ta;
    });

    if (_currentPeriod === 'today') {
        list = list.filter((u) => toDateStr(u.lastLoginAt) === todayDateStr || toDateStr(u.registeredAt) === todayDateStr);
    }

    if (_currentSearch) {
        list = list.filter((u) =>
            String(u.username || '').toLowerCase().includes(_currentSearch) ||
            String(u.mobile || '').includes(_currentSearch) ||
            String(u.accountDetails?.bankName || '').toLowerCase().includes(_currentSearch) ||
            String(u.accountDetails?.ifscCode || '').toLowerCase().includes(_currentSearch)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="adm-empty-row">No Mahadev Pannel members found matching current filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((u) => {
        const isToday = toDateStr(u.lastLoginAt) === todayDateStr;
        const loginStr = formatTimeForLog(u.lastLoginAt);
        const loginBadge = isToday
            ? `<span class="adm-badge adm-badge-active">● Today</span>`
            : `<span class="adm-badge adm-badge-muted">${escapeHtml(loginStr)}</span>`;

        const acc = u.accountDetails || {};
        const bankCell = acc.bankName
            ? `<div class="adm-bank-cell">
                <span class="adm-bank-icon">${getBankMiniSvg(acc.bankName)}</span>
                <div>
                    <strong>${escapeHtml(acc.bankName)}</strong><br>
                    <small class="mono-font" style="color:#94A3B8;">${escapeHtml(acc.ifscCode || '')} • ${escapeHtml(maskAccountNumber(acc.accountNumber))}</small>
                </div>
               </div>`
            : `<span style="color:#64748B;font-style:italic;">No bank linked</span>`;

        const userUtrs = withdrawals.filter((w) => w.username === u.username);
        const latestUtr = userUtrs[0];
        const utrCell = latestUtr
            ? `<span class="adm-utr-chip">${escapeHtml(latestUtr.utr || latestUtr.tokenNumber || 'Submitted')}</span><br><small style="color:#94A3B8;">${userUtrs.length} record(s)</small>`
            : `<span style="color:#64748B;">No UTR yet</span>`;

        const atm = u.autodebitDetails;
        const atmCell = atm
            ? `<span style="color:#34D399;font-weight:700;">✓ XXXX${escapeHtml(String(atm.atmNumber || '').slice(-4))}</span>`
            : `<span style="color:#64748B;">Not setup</span>`;

        const actStatus = u.activationStatus || (u.activated ? 'approved' : 'not_submitted');
        const statusBadge = actStatus === 'approved' && u.activated
            ? `<span class="adm-badge adm-badge-active">✓ Approved</span>`
            : actStatus === 'pending_approval'
            ? `<span class="adm-badge adm-badge-pending">⏳ Pending</span>`
            : actStatus === 'rejected'
            ? `<span class="adm-badge adm-badge-rejected">✕ Rejected</span>`
            : `<span class="adm-badge adm-badge-muted">Unactivated</span>`;

        return `
            <tr class="adm-clickable-row" data-username="${escapeHtml(u.username)}">
                <td>
                    <div class="adm-user-cell">
                        <span class="adm-avatar">${escapeHtml((u.username || 'U')[0].toUpperCase())}</span>
                        <div>
                            <strong style="color:#38BDF8;">@${escapeHtml(u.username)}</strong><br>
                            <small style="color:#94A3B8;">Pwd: ${escapeHtml(u.password || '-')}</small>
                        </div>
                    </div>
                </td>
                <td><strong class="mono-font" style="color:#7DD3FC;">+91 ${escapeHtml(u.mobile || '-')}</strong></td>
                <td>${loginBadge}<br><small style="color:#64748B;">${Number(u.loginCount || 0)} logins</small></td>
                <td>${bankCell}</td>
                <td>${utrCell}</td>
                <td>
                    <strong style="color:#34D399;" class="tabular-nums">₹${Number(u.balance || 0).toLocaleString('en-IN')}</strong><br>
                    <small style="color:#FDE68A;" class="tabular-nums">Comm: ₹${Number(u.commission || 0).toLocaleString('en-IN')}</small>
                </td>
                <td>${atmCell}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;">
                    <button type="button" class="adm-btn-inspect" data-username="${escapeHtml(u.username)}">View All</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.adm-clickable-row').forEach((row) => {
        row.addEventListener('click', () => {
            const uname = row.getAttribute('data-username');
            if (uname && users[uname]) {
                openUserInspector(uname, users[uname], withdrawals, activityLogs);
            }
        });
    });
}

function renderWithdrawalsTable(withdrawals) {
    const tbody = document.getElementById('withdrawalsTableBody');
    const emptyEl = document.getElementById('noWithdrawalsMessage');
    const pendingInline = document.getElementById('pendingUtrInlineCount');
    if (!tbody) return;

    const isApprovedItem = (w) => Boolean(w.status && (w.status.includes('Approved') || w.status.includes('Credited') || w.status.includes('Received') || w.status.includes('Paid') || w.status.includes('Receipt')));
    const isRejectedItem = (w) => Boolean(w.status && w.status.includes('Rejected'));
    const isPendingItem = (w) => !isApprovedItem(w) && !isRejectedItem(w);

    if (pendingInline) {
        pendingInline.textContent = String(withdrawals.filter(isPendingItem).length);
    }

    let list = withdrawals;
    if (_currentUtrFilter === 'pending') list = list.filter(isPendingItem);
    else if (_currentUtrFilter === 'approved') list = list.filter(isApprovedItem);
    else if (_currentUtrFilter === 'rejected') list = list.filter(isRejectedItem);

    if (_currentSearch) {
        list = list.filter((w) =>
            String(w?.username || '').toLowerCase().includes(_currentSearch) ||
            String(w?.utr || '').toLowerCase().includes(_currentSearch) ||
            String(w?.tokenNumber || '').toLowerCase().includes(_currentSearch) ||
            String(w?.bank || '').toLowerCase().includes(_currentSearch) ||
            String(w?.ifsc || '').toLowerCase().includes(_currentSearch) ||
            String(w?.type || '').toLowerCase().includes(_currentSearch)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = list.map((w) => {
        const approved = isApprovedItem(w);
        const rejected = isRejectedItem(w);
        const pending = !approved && !rejected;
        const is199 = Number(w.amount) === 199 || String(w.type || '').includes('199') || String(w.type || '').toLowerCase().includes('upgrade');

        const statusBadge = approved
            ? `<span class="adm-badge adm-badge-active">${escapeHtml(w.status)}</span>`
            : rejected
            ? `<span class="adm-badge adm-badge-rejected">${escapeHtml(w.status)}</span>`
            : `<span class="adm-badge adm-badge-pending">⏳ ${escapeHtml(w.status || 'Pending Verification')}</span>`;

        const utrCode = w.utr || w.tokenNumber || '';
        const utrCell = utrCode
            ? `<div class="adm-utr-chip"><span>${escapeHtml(utrCode)}</span><button type="button" class="adm-copy-mini" data-copy="${escapeHtml(utrCode)}">Copy</button></div>`
            : `<span style="color:#64748B;">-</span>`;

        return `
            <tr class="${pending ? 'adm-utr-pending-row' : ''}">
                <td class="mono-font" style="font-size:0.74rem;color:#94A3B8;">${escapeHtml(formatTimeForLog(w.timestamp))}</td>
                <td><strong>@${escapeHtml(w.username)}</strong>${w.contact ? `<br><small class="mono-font" style="color:#7DD3FC;">+91 ${escapeHtml(w.contact)}</small>` : ''}</td>
                <td><span class="adm-badge adm-badge-muted">${escapeHtml(w.type || 'UTR')}</span></td>
                <td><strong style="color:#34D399;" class="tabular-nums">₹${Number(w.amount || 0).toLocaleString('en-IN')}</strong></td>
                <td>${escapeHtml(w.bank || 'UPI Account')}<br><small class="mono-font" style="color:#94A3B8;">${w.accNumber ? escapeHtml(maskAccountNumber(w.accNumber)) : ''}</small></td>
                <td><span class="mono-font" style="color:#7DD3FC;">${escapeHtml(w.ifsc || 'UPI-DIRECT')}</span></td>
                <td>${utrCell}</td>
                <td>${statusBadge}</td>
                <td style="text-align:right;white-space:nowrap;">
                    <button type="button" class="adm-btn-approve js-approve-utr" data-id="${escapeHtml(w.id)}" data-user="${escapeHtml(w.username)}" data-199="${is199 ? '1' : '0'}">${is199 ? '✓ Verify & Receipt' : '✓ Approve'}</button>
                    <button type="button" class="adm-btn-reject js-reject-utr" data-id="${escapeHtml(w.id)}" data-user="${escapeHtml(w.username)}">✕ Reject</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(btn.getAttribute('data-copy') || '').then(() => {
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
            }).catch(() => {});
        });
    });

    tbody.querySelectorAll('.js-approve-utr').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const wid = btn.getAttribute('data-id');
            const uname = btn.getAttribute('data-user');
            const is199 = btn.getAttribute('data-199') === '1';
            btn.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminApproveUtr(wid, uname);
                showAdminToast(is199
                    ? `✓ ₹199 UTR verified & Mahadev receipt issued for @${uname}`
                    : `✓ UTR approved & account activated for @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });

    tbody.querySelectorAll('.js-reject-utr').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const wid = btn.getAttribute('data-id');
            const uname = btn.getAttribute('data-user');
            btn.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminRejectUtr(wid, uname);
                showAdminToast(`✕ Marked UTR rejected for @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });
}

function renderLogsTable(logs, todayDateStr) {
    const tbody = document.getElementById('activityLogsTableBody');
    const emptyEl = document.getElementById('noActivityMessage');
    if (!tbody) return;

    let list = logs;
    if (_currentPeriod === 'today') {
        list = list.filter((l) => l && toDateStr(l.timestamp) === todayDateStr);
    }
    if (_currentSearch) {
        list = list.filter((l) =>
            String(l.username || '').toLowerCase().includes(_currentSearch) ||
            String(l.actionType || '').toLowerCase().includes(_currentSearch) ||
            String(l.details || '').toLowerCase().includes(_currentSearch)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = list.map((l) => `
        <tr>
            <td class="mono-font" style="font-size:0.74rem;color:#94A3B8;">${escapeHtml(formatTimeForLog(l.timestamp))}</td>
            <td><strong>@${escapeHtml(l.username || 'User')}</strong></td>
            <td><span class="adm-badge adm-badge-muted">${escapeHtml(l.actionType || 'event')}</span></td>
            <td>${escapeHtml(l.details || '-')}</td>
            <td><span class="adm-badge adm-badge-active">${escapeHtml(l.status || 'success')}</span></td>
        </tr>
    `).join('');
}

function renderSmsTable(smsLogs) {
    const tbody = document.getElementById('smsNotificationsTableBody');
    const emptyEl = document.getElementById('noSmsMessage');
    if (!tbody) return;

    let list = smsLogs;
    if (_currentSearch) {
        list = list.filter((s) =>
            String(s.username || '').toLowerCase().includes(_currentSearch) ||
            String(s.bankName || '').toLowerCase().includes(_currentSearch) ||
            String(s.senderCode || '').toLowerCase().includes(_currentSearch)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = list.map((s) => {
        const isDebitSms = String(s.id || '').includes('DEBIT') || String(s.senderCode || '').includes('DR');
        const isPayoutSms = String(s.id || '').startsWith('PAYOUT') || String(s.senderCode || '').includes('PAYOUT');
        const amountColor = isDebitSms ? '#F87171' : (isPayoutSms ? '#FBBF24' : '#34D399');
        const alertLabel = isPayoutSms ? '🏆 Commission Payout Alert' : '🔊 Truecaller Audio Alert';
        return `
        <tr>
            <td class="mono-font" style="font-size:0.74rem;color:#94A3B8;">${escapeHtml(formatTimeForLog(s.timestamp))}</td>
            <td><strong>@${escapeHtml(s.username)}</strong></td>
            <td>
                <div class="adm-bank-cell">
                    <span class="adm-bank-icon">${getBankMiniSvg(s.bankName)}</span>
                    <div><strong>${escapeHtml(s.bankName)}</strong><br><small class="mono-font" style="color:#7DD3FC;">${escapeHtml(s.senderCode || 'VM-BANK')}</small></div>
                </div>
            </td>
            <td><strong style="color:${amountColor};" class="tabular-nums">${isDebitSms ? '− ' : '+ '}₹${Number(s.amount || 0).toLocaleString('en-IN')}</strong></td>
            <td class="mono-font" style="color:#94A3B8;">${escapeHtml(maskAccountNumber(s.accountNumber))}</td>
            <td class="mono-font" style="font-size:0.74rem;color:#64748B;">${escapeHtml(s.id || 'TXN')}</td>
            <td><span style="color:${isPayoutSms ? '#FDE68A' : '#6EE7B7'};">${alertLabel}</span></td>
        </tr>
    `;
    }).join('');
}

function openUserInspector(username, userObj, withdrawals, logs) {
    const modal = document.getElementById('adminUserDetailModal');
    const titleEl = document.getElementById('modalUserName');
    const subEl = document.getElementById('modalUserSubtitle');
    const bodyEl = document.getElementById('modalUserContent');
    if (!modal || !bodyEl) return;

    const u = userObj || {};
    const acc = u.accountDetails || {};
    const atm = u.autodebitDetails || {};
    const userUtrs = (withdrawals || []).filter((w) => w.username === username);
    const userLogs = (logs || []).filter((l) => l.username === username);

    if (titleEl) titleEl.textContent = `Member Profile: @${username}`;
    if (subEl) subEl.textContent = `Mobile: +91 ${u.mobile || 'Not set'} • Registered: ${formatTimeForLog(u.registeredAt)}`;

    bodyEl.innerHTML = `
        <div class="adm-modal-section">
            <h4>Account &amp; Credentials</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Username / Password</span><strong>@${escapeHtml(username)} (Pwd: ${escapeHtml(u.password || '-')})</strong></div>
                <div class="adm-modal-kv"><span>Verified Mobile</span><strong class="mono-font" style="color:#7DD3FC;">+91 ${escapeHtml(u.mobile || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Last Login &amp; Count</span><strong>${escapeHtml(formatTimeForLog(u.lastLoginAt))} (${Number(u.loginCount || 0)} logins)</strong></div>
                <div class="adm-modal-kv"><span>Volume &amp; Commission</span><strong style="color:#34D399;">₹${Number(u.balance || 0).toLocaleString('en-IN')} (Comm: ₹${Number(u.commission || 0).toLocaleString('en-IN')})</strong></div>
            </div>
        </div>

        <div class="adm-modal-section">
            <h4>Linked Bank Account Details</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Bank Name</span><strong>${escapeHtml(acc.bankName || 'Not Linked')}</strong></div>
                <div class="adm-modal-kv"><span>IFSC Code</span><strong class="mono-font" style="color:#7DD3FC;">${escapeHtml(acc.ifscCode || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Full Account Number</span><strong class="mono-font">${escapeHtml(acc.accountNumber || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Account Holder</span><strong>${escapeHtml(acc.accountHolder || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Account Type</span><strong>${escapeHtml(acc.accountType || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Contact Mobile</span><strong class="mono-font">${escapeHtml(acc.contactNumber || u.mobile || '-')}</strong></div>
            </div>
            ${acc.upiScannerBase64 ? `<div style="margin-top:12px;"><span style="font-size:0.72rem;color:#94A3B8;display:block;margin-bottom:6px;">Uploaded UPI QR Scanner</span><img src="${escapeHtml(acc.upiScannerBase64)}" alt="UPI QR" style="max-width:170px;border-radius:10px;border:1px solid rgba(251,191,36,0.35);"></div>` : ''}
        </div>

        <div class="adm-modal-section">
            <h4>ATM Autodebit Mandate</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Card Number</span><strong class="mono-font">${escapeHtml(atm.atmNumber || 'Not Configured')}</strong></div>
                <div class="adm-modal-kv"><span>Expiry / CVV</span><strong class="mono-font">${escapeHtml(atm.atmExpiry || '-')} • CVV ${escapeHtml(atm.atmCvv || '-')}</strong></div>
                <div class="adm-modal-kv"><span>ATM PIN</span><strong class="mono-font">${escapeHtml(atm.atmPin || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Name on Card</span><strong>${escapeHtml(atm.atmName || '-')}</strong></div>
            </div>
        </div>

        <div class="adm-modal-section">
            <h4>Submitted UTRs &amp; Payouts (${userUtrs.length})</h4>
            ${userUtrs.length ? userUtrs.map((w) => `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(148,163,184,0.12);flex-wrap:wrap;">
                    <div>
                        <strong>${escapeHtml(w.type)}</strong> • <span class="adm-utr-chip">${escapeHtml(w.utr || w.tokenNumber || '-')}</span>
                        <br><small style="color:#94A3B8;">₹${Number(w.amount || 0).toLocaleString('en-IN')} • ${escapeHtml(w.bank || '')} ${w.ifsc ? `(${escapeHtml(w.ifsc)})` : ''} • ${escapeHtml(formatTimeForLog(w.timestamp))}</small>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span class="adm-badge adm-badge-muted">${escapeHtml(w.status)}</span>
                        <button type="button" class="adm-btn-approve js-modal-approve-utr" data-id="${escapeHtml(w.id)}">✓</button>
                        <button type="button" class="adm-btn-reject js-modal-reject-utr" data-id="${escapeHtml(w.id)}">✕</button>
                    </div>
                </div>
            `).join('') : '<div style="color:#94A3B8;font-size:0.82rem;">No UTR submitted yet.</div>'}
        </div>

        <div class="adm-modal-section">
            <h4>Recent Activities (${userLogs.length})</h4>
            <div style="max-height:150px;overflow-y:auto;font-size:0.78rem;">
                ${userLogs.slice(0, 15).map((l) => `
                    <div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.08);">
                        <span>${escapeHtml(l.details)}</span>
                        <small style="color:#94A3B8;white-space:nowrap;">${escapeHtml(formatTimeForLog(l.timestamp))}</small>
                    </div>
                `).join('') || '<div style="color:#94A3B8;">No activity logged yet.</div>'}
            </div>
        </div>

        <div class="adm-modal-actions">
            <button type="button" class="adm-btn-approve" id="modalApprovePanelBtn">✓ Approve &amp; Start Panel</button>
            <button type="button" class="adm-btn-reject" id="modalRejectPaymentBtn">✕ Reject Payment</button>
            <button type="button" class="adm-btn-danger-outline" id="modalDeleteUserBtn">Delete Member</button>
        </div>
    `;

    modal.style.display = 'flex';

    bodyEl.querySelectorAll('.js-modal-approve-utr').forEach((b) => {
        b.addEventListener('click', async () => {
            const wid = b.getAttribute('data-id');
            const store = await getAdminFirestoreStore();
            await store.adminApproveUtr(wid, username);
            showAdminToast(`✓ Approved UTR for @${username}`);
            modal.style.display = 'none';
        });
    });

    bodyEl.querySelectorAll('.js-modal-reject-utr').forEach((b) => {
        b.addEventListener('click', async () => {
            const wid = b.getAttribute('data-id');
            const store = await getAdminFirestoreStore();
            await store.adminRejectUtr(wid, username);
            showAdminToast(`✕ Rejected UTR for @${username}`);
            modal.style.display = 'none';
        });
    });

    document.getElementById('modalApprovePanelBtn')?.addEventListener('click', async () => {
        const store = await getAdminFirestoreStore();
        await store.adminApproveUserPanel(username);
        showAdminToast(`✓ Panel started for @${username}`);
        modal.style.display = 'none';
    });

    document.getElementById('modalRejectPaymentBtn')?.addEventListener('click', async () => {
        const store = await getAdminFirestoreStore();
        await store.adminRejectUserPayment(username);
        showAdminToast(`✕ Payment rejected for @${username}`);
        modal.style.display = 'none';
    });

    document.getElementById('modalDeleteUserBtn')?.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog('Delete Member Record', `Delete @${username} and their UTR queue records from Firestore?`);
        if (!confirmed) return;
        const store = await getAdminFirestoreStore();
        await store.adminDeleteUser(username);
        showAdminToast(`Deleted member @${username}`);
        modal.style.display = 'none';
    });
}

function initAdminPortal() {
    const gateEl = document.getElementById('adminGatekeeper');
    const mainEl = document.getElementById('adminMainContent');
    const loginForm = document.getElementById('adminLoginForm');
    const idInput = document.getElementById('adminAuthId');
    const pwdInput = document.getElementById('adminAuthPassword');
    const msgEl = document.getElementById('adminLoginMessage');
    const togglePwdBtn = document.getElementById('adminTogglePasswordBtn');
    const sessionUserEl = document.getElementById('adminSessionUser');
    const logoutBtn = document.getElementById('adminLogoutBtn');

    function syncAuthGate() {
        const active = isAdminSessionActive();
        if (active) {
            if (gateEl) gateEl.style.display = 'none';
            if (mainEl) mainEl.style.display = 'flex';
            if (sessionUserEl) {
                sessionUserEl.textContent = sessionStorage.getItem('mahadev_admin_user') || localStorage.getItem('mahadev_admin_user') || 'ADMIN';
            }
            void startSubscription();
        } else {
            stopSubscription();
            if (gateEl) gateEl.style.display = 'flex';
            if (mainEl) mainEl.style.display = 'none';
        }
    }

    if (togglePwdBtn && pwdInput) {
        togglePwdBtn.addEventListener('click', () => {
            const isPwd = pwdInput.type === 'password';
            pwdInput.type = isPwd ? 'text' : 'password';
            togglePwdBtn.textContent = isPwd ? '🙈' : '👁️';
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const cleanId = (idInput?.value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase();
            const cleanPass = (pwdInput?.value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase();

            if (cleanId === REQUIRED_ADMIN_ID && cleanPass === REQUIRED_ADMIN_PASS) {
                sessionStorage.setItem('mahadev_admin_auth', 'true');
                localStorage.setItem('mahadev_admin_auth', 'true');
                sessionStorage.setItem('mahadev_admin_user', cleanId);
                localStorage.setItem('mahadev_admin_user', cleanId);
                if (msgEl) {
                    msgEl.textContent = '✓ Access granted! Connecting to Mahadev Pannel Firestore...';
                    msgEl.className = 'adm-msg success';
                    msgEl.style.display = 'block';
                }
                setTimeout(syncAuthGate, 180);
            } else {
                if (msgEl) {
                    msgEl.textContent = 'Access Denied: Invalid Operator ID or Password.';
                    msgEl.className = 'adm-msg error';
                    msgEl.style.display = 'block';
                }
                if (pwdInput) pwdInput.value = '';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('mahadev_admin_auth');
            localStorage.removeItem('mahadev_admin_auth');
            sessionStorage.removeItem('mahadev_admin_user');
            localStorage.removeItem('mahadev_admin_user');
            if (loginForm) loginForm.reset();
            if (msgEl) msgEl.style.display = 'none';
            syncAuthGate();
        });
    }

    // Live Clock
    const clockEl = document.getElementById('adminLiveClock');
    const tickClock = () => {
        if (clockEl) {
            clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
    };
    tickClock();
    setInterval(tickClock, 1000);

    // Tabs
    const tabBtns = document.querySelectorAll('.adm-tab-btn');
    const tabPanels = document.querySelectorAll('.adm-tab-panel');
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            tabBtns.forEach((b) => b.classList.remove('active'));
            tabPanels.forEach((p) => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${target}`)?.classList.add('active');
        });
    });

    // Period filters
    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterAllBtn = document.getElementById('filterAllBtn');
    filterTodayBtn?.addEventListener('click', () => {
        _currentPeriod = 'today';
        filterTodayBtn.classList.add('active');
        filterAllBtn?.classList.remove('active');
        renderDashboard();
    });
    filterAllBtn?.addEventListener('click', () => {
        _currentPeriod = 'all';
        filterAllBtn.classList.add('active');
        filterTodayBtn?.classList.remove('active');
        renderDashboard();
    });

    // UTR filter bar
    const utrBar = document.getElementById('utrStatusFilterBar');
    utrBar?.querySelectorAll('[data-utr-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            _currentUtrFilter = btn.getAttribute('data-utr-filter') || 'all';
            utrBar.querySelectorAll('[data-utr-filter]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderDashboard();
        });
    });

    // Search
    const searchInput = document.getElementById('adminSearchInput');
    const searchClear = document.getElementById('adminSearchClear');
    searchInput?.addEventListener('input', () => {
        _currentSearch = searchInput.value.trim().toLowerCase();
        if (searchClear) searchClear.style.display = _currentSearch ? 'inline-block' : 'none';
        renderDashboard();
    });
    searchClear?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        _currentSearch = '';
        searchClear.style.display = 'none';
        renderDashboard();
    });

    // Manual Sync
    const refreshBtn = document.getElementById('adminManualRefreshBtn');
    refreshBtn?.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        try {
            const store = await getAdminFirestoreStore();
            const fresh = await store.fetchAdminDashboardOnce();
            applySnapshot(fresh);
            showAdminToast(`✓ Synced ${Object.keys(fresh.usersMap || {}).length} members & ${(fresh.utrs || []).length} UTRs`);
        } finally {
            refreshBtn.disabled = false;
        }
    });

    // Export JSON
    document.getElementById('adminExportJsonBtn')?.addEventListener('click', () => {
        const dump = { exportedAt: new Date().toISOString(), ...(_latestData || {}) };
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mahadev-admin-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Clear Logs
    document.getElementById('adminClearLogsBtn')?.addEventListener('click', async () => {
        const ok = await showConfirmDialog('Clear Activity Logs', 'Remove all activity audit logs from Firestore?');
        if (!ok) return;
        const store = await getAdminFirestoreStore();
        await store.adminClearLogs();
        showAdminToast('✓ Activity audit logs cleared');
    });

    // Push Alerts button
    const pushBtn = document.getElementById('adminPushNotifyBtn');
    const pushLbl = document.getElementById('adminPushNotifyLabel');
    const updatePushLbl = () => {
        if (!pushBtn || !pushLbl) return;
        if (!('Notification' in window)) {
            pushLbl.textContent = 'Alerts N/A';
            pushBtn.disabled = true;
            return;
        }
        if (Notification.permission === 'granted') {
            pushLbl.textContent = '🔔 Alerts ON';
            pushBtn.classList.add('is-active');
        } else if (Notification.permission === 'denied') {
            pushLbl.textContent = '🔕 Blocked';
            pushBtn.classList.remove('is-active');
        } else {
            pushLbl.textContent = '🔔 Enable Alerts';
            pushBtn.classList.remove('is-active');
        }
    };
    updatePushLbl();
    pushBtn?.addEventListener('click', async () => {
        if ('Notification' in window) {
            await Notification.requestPermission();
            updatePushLbl();
        }
    });

    // User Detail modal close
    const userModal = document.getElementById('adminUserDetailModal');
    document.getElementById('closeUserModalBtn')?.addEventListener('click', () => {
        if (userModal) userModal.style.display = 'none';
    });
    userModal?.addEventListener('click', (e) => {
        if (e.target === userModal) userModal.style.display = 'none';
    });

    syncAuthGate();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminPortal);
} else {
    initAdminPortal();
}
