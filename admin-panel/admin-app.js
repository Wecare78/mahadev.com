// ============================================
// MAHADEV ADMIN — STANDALONE CONTROL CENTER
// Connects directly to the shared Mahadev Pannel Firestore DB
// Self-contained for separate GitHub Pages deployment (Deploy from branch -> / root)
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

function getTodayLocalDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function toLocalDateStr(ts) {
    if (!ts) return '';
    if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts.trim())) {
        return ts.trim();
    }
    try {
        let d;
        if (typeof ts === 'object' && ts !== null) {
            if (typeof ts.toDate === 'function') d = ts.toDate();
            else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
            else d = new Date(ts);
        } else {
            d = new Date(ts);
        }
        if (isNaN(d.getTime())) return typeof ts === 'string' ? ts.slice(0, 10) : '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch {
        return '';
    }
}

function shiftDateStr(dateStr, deltaDays) {
    const parts = String(dateStr || getTodayLocalDateStr()).split('-').map(Number);
    const base = new Date(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) + deltaDays);
    const y = base.getFullYear();
    const m = String(base.getMonth() + 1).padStart(2, '0');
    const d = String(base.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatReadableDate(dateStr) {
    const parts = String(dateStr || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

let _storePromise = null;
let _latestData = null;
let _unsubAdmin = null;
let _adminPollTimer = null;
let _knownUserKeys = new Set();
let _knownUtrKeys = new Set();
let _hasHydratedOnce = false;

let _selectedDate = getTodayLocalDateStr();
let _currentSearch = '';
let _currentUserFilter = 'all';
let _currentUtrTypeFilter = 'all';
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
        <rect width="100" height="100" rx="20" fill="hsl(${hue}, 76%, 36%)"/>
        <text x="50" y="61" font-size="38" font-weight="800" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${escapeHtml(initials)}</text>
    </svg>`;
}

function formatTimeForLog(ts) {
    if (!ts) return '-';
    try {
        let d;
        if (typeof ts === 'object' && ts !== null) {
            if (typeof ts.toDate === 'function') d = ts.toDate();
            else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
            else d = new Date(ts);
        } else {
            d = new Date(ts);
        }
        if (isNaN(d.getTime())) return '-';
        const todayStr = getTodayLocalDateStr();
        const itemDateStr = toLocalDateStr(d);
        const t = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
        if (itemDateStr === todayStr) return `Today, ${t}`;
        return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${t}`;
    } catch {
        return '-';
    }
}

function is199UtrRecord(w) {
    if (!w) return false;
    const typeStr = String(w.type || '').toLowerCase();
    return Number(w.amount) === 199 || typeStr.includes('199') || typeStr.includes('upgrade') || typeStr.includes('payout');
}

function is599UtrRecord(w) {
    if (!w || is199UtrRecord(w)) return false;
    const typeStr = String(w.type || '').toLowerCase();
    return Number(w.amount) === 599 || Number(w.amount) === 999 || typeStr.includes('599') || typeStr.includes('999') || typeStr.includes('activation');
}

function isApprovedUtr(w) {
    const s = String(w?.status || '').toLowerCase();
    return s.includes('approved') || s.includes('receipt') || s.includes('activated') || s.includes('credited') || s.includes('paid') || s.includes('received') || s.includes('verified');
}

function isRejectedUtr(w) {
    const s = String(w?.status || '').toLowerCase();
    return s.includes('rejected');
}

function isPendingUtr(w) {
    return !isApprovedUtr(w) && !isRejectedUtr(w);
}

function extractPayoutAmount(w) {
    const typeStr = String(w?.type || '');
    const m = typeStr.match(/Payout\s*₹?\s*([\d,]+(?:\.\d+)?)/i);
    if (!m) return null;
    const num = parseFloat(m[1].replace(/,/g, ''));
    return !isNaN(num) && num > 0 ? num : null;
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
    }, 4000);
}

function updateSyncStatusBadge(text, isWarn = false) {
    const el = document.getElementById('adminSyncStatusText');
    if (el) {
        el.textContent = text;
        el.classList.toggle('is-warn', Boolean(isWarn));
    }
}

function showConfirmDialog(title, message, okLabel = 'Delete') {
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
        okBtn.textContent = okLabel;
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

        // Validate connection on boot
        try {
            await fsMod.getDocFromServer(fsMod.doc(db, 'test', 'connection'));
            updateSyncStatusBadge('Live', false);
        } catch (err) {
            if (err instanceof Error && err.message.includes('the client is offline')) {
                updateSyncStatusBadge('Offline', true);
            }
        }

        const toDocId = (u) => (String(u || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || `user_${Date.now()}`).slice(0, 120);
        const safeId = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        const findAllUsers = async (identifier) => {
            const cleanId = String(identifier || '').trim();
            if (!cleanId) return [];
            const foundById = new Map();
            const lowerTarget = cleanId.toLowerCase();
            const targetDocId = toDocId(cleanId);

            // Check cached map first (exact + case-insensitive)
            if (_latestData?.users) {
                for (const [k, u] of Object.entries(_latestData.users)) {
                    if (!u) continue;
                    if (k === cleanId || k.trim().toLowerCase() === lowerTarget || String(u.username || '').trim().toLowerCase() === lowerTarget) {
                        const did = u._docId || u.docId || toDocId(u.username || k);
                        foundById.set(did, { ...u, _docId: did, docId: u.docId || did });
                    }
                }
            }

            // Direct docId lookup from server
            try {
                const directSnap = await fsMod.getDocFromServer(fsMod.doc(db, 'users', targetDocId)).catch(() =>
                    fsMod.getDoc(fsMod.doc(db, 'users', targetDocId))
                );
                if (directSnap.exists()) {
                    const data = directSnap.data();
                    foundById.set(directSnap.id, { ...data, _docId: directSnap.id, docId: data?.docId || directSnap.id });
                }
            } catch (e) {
                handleFirestoreError(e, 'get', `users/${targetDocId}`);
            }

            // Username query from server
            try {
                const q = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('username', '==', cleanId), fsMod.limit(10));
                const s = await fsMod.getDocsFromServer(q).catch(() => fsMod.getDocs(q));
                s.docs.forEach((docSnap) => {
                    const data = docSnap.data();
                    foundById.set(docSnap.id, { ...data, _docId: docSnap.id, docId: data?.docId || docSnap.id });
                });
            } catch {}

            // Case-insensitive fallback scan if still empty
            if (foundById.size === 0) {
                try {
                    const allSnap = await fsMod.getDocsFromServer(fsMod.collection(db, 'users')).catch(() =>
                        fsMod.getDocs(fsMod.collection(db, 'users'))
                    );
                    allSnap.docs.forEach((docSnap) => {
                        const data = docSnap.data();
                        const uname = String(data?.username || '').trim().toLowerCase();
                        if (uname === lowerTarget || docSnap.id.toLowerCase() === targetDocId.toLowerCase()) {
                            foundById.set(docSnap.id, { ...data, _docId: docSnap.id, docId: data?.docId || docSnap.id });
                        }
                    });
                } catch {}
            }

            return Array.from(foundById.values());
        };

        const findUser = async (identifier) => {
            const list = await findAllUsers(identifier);
            return list[0] || null;
        };

        const buildFallbackUserDoc = (uname, utrData, overrides = {}) => {
            const cleanUsername = String(uname || '').trim().slice(0, 64);
            const docId = toDocId(cleanUsername);
            const now = new Date().toISOString();
            const safeMobile = String(utrData?.contact || '').replace(/\D/g, '').slice(-10);
            const accNo = String(utrData?.accNumber || '').trim().slice(0, 32);
            const ifsc = String(utrData?.ifsc || '').trim().toUpperCase().slice(0, 15);
            const bank = String(utrData?.bank || '').trim().slice(0, 120);
            const hasValidAcc = accNo.length >= 4 && ifsc.length >= 4 && bank.length >= 2 && cleanUsername.length >= 2;

            return {
                docId,
                username: cleanUsername,
                password: 'user1234',
                mobile: safeMobile,
                mobileVerified: true,
                email: `${safeMobile || cleanUsername}@accountfunds.in`.slice(0, 160),
                registeredAt: String(utrData?.timestamp || now).slice(0, 64),
                lastLoginAt: now,
                loginCount: 1,
                loginHistory: [now],
                accountDetails: hasValidAcc
                    ? {
                        accountNumber: accNo,
                        ifscCode: ifsc,
                        bankName: bank,
                        accountHolder: cleanUsername,
                        accountType: 'Saving',
                        contactNumber: safeMobile,
                        upiScannerBase64: null
                    }
                    : null,
                autodebitDetails: null,
                activated: Boolean(overrides.activated),
                activationStatus: overrides.activationStatus || 'not_submitted',
                rejectionMessage: String(overrides.rejectionMessage || '').slice(0, 300),
                activationCode: String(utrData?.utr || '').slice(0, 32),
                otpProvider: 'free-otp',
                firebasePhoneUid: '',
                balance: 0,
                commission: 0,
                transactions: []
            };
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
                        const s = await fsMod.getDocsFromServer(fsMod.collection(db, 'users')).catch(() =>
                            fsMod.getDocs(fsMod.collection(db, 'users'))
                        );
                        const map = {};
                        s.docs.forEach((d) => {
                            const data = d.data();
                            const uname = String(data?.username || d.id || '').trim();
                            if (uname && uname !== 'demo') {
                                map[uname] = { ...data, username: uname, _docId: d.id, docId: data?.docId || d.id };
                            }
                        });
                        return map;
                    } catch (e) {
                        handleFirestoreError(e, 'list', 'users');
                        return {};
                    }
                };
                const safeUtrs = async () => {
                    try {
                        const q = fsMod.query(fsMod.collection(db, 'utrs'), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(1000));
                        const s = await fsMod.getDocsFromServer(q).catch(() => fsMod.getDocs(q));
                        return s.docs.map((d) => ({ ...d.data(), id: d.data()?.id || d.id }));
                    } catch {
                        try {
                            const s = await fsMod.getDocsFromServer(fsMod.collection(db, 'utrs')).catch(() =>
                                fsMod.getDocs(fsMod.collection(db, 'utrs'))
                            );
                            return s.docs
                                .map((d) => ({ ...d.data(), id: d.data()?.id || d.id }))
                                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                                .slice(0, 1000);
                        } catch (e2) {
                            handleFirestoreError(e2, 'list', 'utrs');
                            return [];
                        }
                    }
                };

                const [usersMap, utrs] = await Promise.all([safeUsers(), safeUtrs()]);
                return { usersMap, utrs };
            },

            subscribeAdminDashboard(cb) {
                let usersMap = {};
                let extraUsers = {};
                let utrs = [];
                let stopped = false;
                const extraUnsubs = new Map();

                const emit = () => {
                    if (stopped) return;
                    cb({
                        usersMap: { ...extraUsers, ...usersMap },
                        utrs
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
                                extraUsers[data.username] = { ...data, _docId: snap.id };
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
                            nextMap[data.username] = { ...data, _docId: d.id };
                        }
                    });
                    usersMap = nextMap;
                    updateSyncStatusBadge('Live', false);
                    emit();
                }, (err) => {
                    handleFirestoreError(err, 'list', 'users');
                    updateSyncStatusBadge('Sync Error', true);
                });

                const u2 = fsMod.onSnapshot(
                    fsMod.query(fsMod.collection(db, 'utrs'), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(1000)),
                    (snap) => {
                        const rows = snap.docs.map((d) => ({ ...d.data(), id: d.data()?.id || d.id }));
                        rows.forEach((r) => {
                            if (r?.username) watchExtraUser(r.username);
                        });
                        utrs = rows;
                        emit();
                    },
                    () => {
                        fsMod.onSnapshot(fsMod.collection(db, 'utrs'), (s2) => {
                            const rows = s2.docs
                                .map((d) => ({ ...d.data(), id: d.data()?.id || d.id }))
                                .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
                                .slice(0, 1000);
                            rows.forEach((r) => {
                                if (r?.username) watchExtraUser(r.username);
                            });
                            utrs = rows;
                            emit();
                        }, (err2) => {
                            handleFirestoreError(err2, 'list', 'utrs');
                        });
                    }
                );

                return () => {
                    stopped = true;
                    u1();
                    u2();
                    extraUnsubs.forEach((fn) => { try { fn(); } catch {} });
                };
            },

            async adminApproveUtr(utrId, uname) {
                const ref = fsMod.doc(db, 'utrs', utrId);
                let data = null;
                try {
                    const snap = await fsMod.getDocFromServer(ref).catch(() => fsMod.getDoc(ref));
                    data = snap.exists() ? snap.data() : null;
                } catch (e) {
                    handleFirestoreError(e, 'get', `utrs/${utrId}`);
                }
                const is199 = is199UtrRecord(data);
                try {
                    await fsMod.updateDoc(ref, { status: is199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated' });
                } catch (e) {
                    handleFirestoreError(e, 'update', `utrs/${utrId}`);
                    throw e;
                }

                const resolvedUname = String(uname || data?.username || '').trim();
                const matchedUsers = await findAllUsers(resolvedUname);
                if (matchedUsers.length > 0) {
                    try {
                        await Promise.all(
                            matchedUsers.map((user) => {
                                const userDocId = user._docId || user.docId || toDocId(resolvedUname);
                                return fsMod.updateDoc(fsMod.doc(db, 'users', userDocId), {
                                    activated: true,
                                    activationStatus: 'approved',
                                    rejectionMessage: ''
                                });
                            })
                        );
                    } catch (e) {
                        handleFirestoreError(e, 'update', `users/${resolvedUname}`);
                        throw e;
                    }
                } else if (resolvedUname.length >= 3) {
                    const createdDoc = buildFallbackUserDoc(resolvedUname, data, {
                        activated: true,
                        activationStatus: 'approved',
                        rejectionMessage: ''
                    });
                    try {
                        await fsMod.setDoc(fsMod.doc(db, 'users', createdDoc.docId), createdDoc);
                    } catch (e) {
                        handleFirestoreError(e, 'create', `users/${createdDoc.docId}`);
                        throw e;
                    }
                }

                await writeAct(
                    resolvedUname,
                    'activation',
                    is199
                        ? `Admin verified ₹199 UTR (${data?.utr || utrId}) and generated Payment Receipt for @${resolvedUname}`
                        : `Admin approved ₹599 UTR (${data?.utr || utrId}) and activated Panel Wallet for @${resolvedUname}`,
                    'activation',
                    'success'
                );
                return true;
            },

            async adminRejectUtr(utrId, uname) {
                const ref = fsMod.doc(db, 'utrs', utrId);
                let data = null;
                try {
                    const snap = await fsMod.getDocFromServer(ref).catch(() => fsMod.getDoc(ref));
                    data = snap.exists() ? snap.data() : null;
                } catch {}
                try {
                    await fsMod.updateDoc(ref, { status: '❌ Rejected (Invalid UTR)' });
                } catch (e) {
                    handleFirestoreError(e, 'update', `utrs/${utrId}`);
                    throw e;
                }
                const resolvedUname = String(uname || data?.username || '').trim();
                const matchedUsers = await findAllUsers(resolvedUname);
                const rejectMsg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                if (matchedUsers.length > 0) {
                    try {
                        await Promise.all(
                            matchedUsers.map((user) => {
                                const userDocId = user._docId || user.docId || toDocId(resolvedUname);
                                return fsMod.updateDoc(fsMod.doc(db, 'users', userDocId), {
                                    activated: false,
                                    activationStatus: 'rejected',
                                    rejectionMessage: rejectMsg
                                });
                            })
                        );
                    } catch (e) {
                        handleFirestoreError(e, 'update', `users/${resolvedUname}`);
                        throw e;
                    }
                }
                await writeAct(resolvedUname, 'activation', `Admin rejected UTR (${utrId}) for @${resolvedUname}`, 'activation', 'warning');
                return true;
            },

            async adminApproveUserPanel(uname) {
                const matchedUsers = await findAllUsers(uname);
                if (matchedUsers.length === 0) {
                    if (String(uname || '').trim().length < 3) return null;
                    const createdDoc = buildFallbackUserDoc(uname, null, {
                        activated: true,
                        activationStatus: 'approved',
                        rejectionMessage: ''
                    });
                    try {
                        await fsMod.setDoc(fsMod.doc(db, 'users', createdDoc.docId), createdDoc);
                    } catch (e) {
                        handleFirestoreError(e, 'create', `users/${createdDoc.docId}`);
                        throw e;
                    }
                    await writeAct(uname, 'activation', `Admin approved panel transactions for @${uname}`, 'activation', 'success');
                    return createdDoc;
                }
                try {
                    await Promise.all(
                        matchedUsers.map((user) => {
                            const userDocId = user._docId || user.docId || toDocId(uname);
                            return fsMod.updateDoc(fsMod.doc(db, 'users', userDocId), {
                                activated: true,
                                activationStatus: 'approved',
                                rejectionMessage: ''
                            });
                        })
                    );
                } catch (e) {
                    handleFirestoreError(e, 'update', `users/${uname}`);
                    throw e;
                }
                await writeAct(uname, 'activation', `Admin approved panel transactions for @${uname}`, 'activation', 'success');
                return { ...matchedUsers[0], activated: true, activationStatus: 'approved', rejectionMessage: '' };
            },

            async adminRejectUserPayment(uname) {
                const matchedUsers = await findAllUsers(uname);
                if (matchedUsers.length === 0) return null;
                const msg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                try {
                    await Promise.all(
                        matchedUsers.map((user) => {
                            const userDocId = user._docId || user.docId || toDocId(uname);
                            return fsMod.updateDoc(fsMod.doc(db, 'users', userDocId), {
                                activated: false,
                                activationStatus: 'rejected',
                                rejectionMessage: msg
                            });
                        })
                    );
                } catch (e) {
                    handleFirestoreError(e, 'update', `users/${uname}`);
                    throw e;
                }
                await writeAct(uname, 'activation', `Admin rejected payment for @${uname}`, 'activation', 'warning');
                return { ...matchedUsers[0], activated: false, activationStatus: 'rejected', rejectionMessage: msg };
            },

            async adminDeleteUser(uname) {
                const user = await findUser(uname);
                const docId = user?._docId || user?.docId || toDocId(uname);
                try {
                    await fsMod.deleteDoc(fsMod.doc(db, 'users', docId));
                } catch (e) {
                    handleFirestoreError(e, 'delete', `users/${docId}`);
                    throw e;
                }
                try {
                    const userMatches = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'users'), fsMod.where('username', '==', uname)));
                    await Promise.allSettled(userMatches.docs.map((d) => fsMod.deleteDoc(d.ref)));
                } catch {}
                try {
                    const utrSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'utrs'), fsMod.where('username', '==', uname)));
                    await Promise.allSettled(utrSnap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                } catch {}
                try {
                    const actSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'activityLogs'), fsMod.where('username', '==', uname)));
                    await Promise.allSettled(actSnap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                } catch {}
                try {
                    const smsSnap = await fsMod.getDocs(fsMod.query(fsMod.collection(db, 'smsLogs'), fsMod.where('username', '==', uname)));
                    await Promise.allSettled(smsSnap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                } catch {}
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

function applySnapshot(snapshot) {
    if (!snapshot) return;
    const users = snapshot.usersMap || {};
    const withdrawals = Array.isArray(snapshot.utrs) ? snapshot.utrs : [];

    _latestData = { users, withdrawals };

    const nextUserKeys = new Set(Object.keys(users));
    const nextUtrKeys = new Set(withdrawals.map((w) => w.id));

    if (_hasHydratedOnce && isAdminSessionActive()) {
        for (const uname of nextUserKeys) {
            if (!_knownUserKeys.has(uname)) {
                const u = users[uname];
                showAdminToast(`New member joined: @${uname} (+91 ${u?.mobile || '-'})`);
                break;
            }
        }
        for (const w of withdrawals) {
            if (!_knownUtrKeys.has(w.id)) {
                showAdminToast(`New UTR submitted: @${w.username} · ₹${Number(w.amount || 0).toLocaleString('en-IN')} · ${w.utr || '-'}`);
                break;
            }
        }
    }

    _knownUserKeys = nextUserKeys;
    _knownUtrKeys = nextUtrKeys;
    _hasHydratedOnce = true;

    const nowTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    updateSyncStatusBadge(`Synced ${nowTime}`, false);
    renderDashboard();
}

async function startSubscription() {
    if (_unsubAdmin) {
        _unsubAdmin();
        _unsubAdmin = null;
    }
    if (_adminPollTimer) {
        clearInterval(_adminPollTimer);
        _adminPollTimer = null;
    }
    updateSyncStatusBadge('Connecting', false);
    try {
        const store = await getAdminFirestoreStore();
        _unsubAdmin = store.subscribeAdminDashboard(applySnapshot);
        const initial = await store.fetchAdminDashboardOnce();
        if (initial) applySnapshot(initial);

        _adminPollTimer = setInterval(async () => {
            if (!isAdminSessionActive()) return;
            try {
                const fresh = await store.fetchAdminDashboardOnce();
                if (fresh) applySnapshot(fresh);
            } catch {}
        }, 15000);
    } catch (err) {
        handleFirestoreError(err, 'list', 'dashboard');
        updateSyncStatusBadge('Sync Error', true);
    }
}

function stopSubscription() {
    if (_unsubAdmin) {
        _unsubAdmin();
        _unsubAdmin = null;
    }
    if (_adminPollTimer) {
        clearInterval(_adminPollTimer);
        _adminPollTimer = null;
    }
}

function switchTab(tabKey) {
    document.querySelectorAll('.adm-nav-link').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
    });
    document.querySelectorAll('.adm-tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `tab-${tabKey}`);
    });
}

function updateDateHeaderUI() {
    const picker = document.getElementById('adminDatePicker');
    const todayBtn = document.getElementById('jumpTodayBtn');
    const scopeEl = document.getElementById('dateScopeSummary');
    const todayStr = getTodayLocalDateStr();
    const isToday = _selectedDate === todayStr;

    if (picker && picker.value !== _selectedDate) {
        picker.value = _selectedDate;
    }
    if (todayBtn) {
        todayBtn.classList.toggle('is-current', isToday && !_currentSearch);
    }
    if (scopeEl) {
        if (_currentSearch) {
            scopeEl.textContent = `Global Search across all dates ("${_currentSearch}")`;
            scopeEl.classList.add('is-searching');
        } else {
            scopeEl.classList.remove('is-searching');
            scopeEl.textContent = isToday
                ? `Today · ${formatReadableDate(_selectedDate)}`
                : `Date · ${formatReadableDate(_selectedDate)}`;
        }
    }
}

function userActiveOnDate(u, userUtrs, targetDate) {
    if (!u) return false;
    if (toLocalDateStr(u.lastLoginAt) === targetDate) return true;
    if (toLocalDateStr(u.registeredAt) === targetDate) return true;
    if (Array.isArray(u.loginHistory) && u.loginHistory.some((t) => toLocalDateStr(t) === targetDate)) return true;
    if (userUtrs.some((w) => toLocalDateStr(w.timestamp) === targetDate)) return true;
    return false;
}

function userMatchesSearch(u, userUtrs, q) {
    if (!q) return true;
    const acc = u?.accountDetails || {};
    const fields = [
        u?.username,
        u?.mobile,
        u?.password,
        acc.bankName,
        acc.ifscCode,
        acc.accountNumber,
        acc.accountHolder,
        acc.contactNumber
    ];
    if (fields.some((f) => String(f || '').toLowerCase().includes(q))) return true;
    return userUtrs.some((w) =>
        String(w?.utr || '').toLowerCase().includes(q) ||
        String(w?.tokenNumber || '').toLowerCase().includes(q) ||
        String(w?.bank || '').toLowerCase().includes(q) ||
        String(w?.accNumber || '').toLowerCase().includes(q) ||
        String(w?.ifsc || '').toLowerCase().includes(q)
    );
}

function utrMatchesSearch(w, q) {
    if (!q) return true;
    return (
        String(w?.username || '').toLowerCase().includes(q) ||
        String(w?.contact || '').toLowerCase().includes(q) ||
        String(w?.utr || '').toLowerCase().includes(q) ||
        String(w?.tokenNumber || '').toLowerCase().includes(q) ||
        String(w?.bank || '').toLowerCase().includes(q) ||
        String(w?.ifsc || '').toLowerCase().includes(q) ||
        String(w?.accNumber || '').toLowerCase().includes(q) ||
        String(w?.type || '').toLowerCase().includes(q)
    );
}

function renderDashboard() {
    if (!isAdminSessionActive() || !_latestData) return;

    updateDateHeaderUI();

    const { users, withdrawals } = _latestData;
    const targetDate = _selectedDate;

    // 1. Date-wise UTR stats (599 Accept, 199 Accept, 599 Reject, 199 Reject / Shown)
    const dateUtrs = withdrawals.filter((w) => toLocalDateStr(w?.timestamp) === targetDate);
    const list599 = dateUtrs.filter(is599UtrRecord);
    const list199 = dateUtrs.filter(is199UtrRecord);

    const accept599 = list599.filter(isApprovedUtr).length;
    const reject599 = list599.filter(isRejectedUtr).length;
    const pending599 = list599.filter(isPendingUtr).length;

    const accept199 = list199.filter(isApprovedUtr).length;
    const reject199 = list199.filter(isRejectedUtr).length;
    const pending199 = list199.filter(isPendingUtr).length;

    // 2. Date-wise Logins & Registrations
    const allUsersArr = Object.values(users).filter(Boolean);
    let dateLoginsCount = 0;
    let dateNewUsersCount = 0;
    allUsersArr.forEach((u) => {
        if (toLocalDateStr(u.registeredAt) === targetDate) dateNewUsersCount++;
        if (Array.isArray(u.loginHistory)) {
            const hits = u.loginHistory.filter((t) => toLocalDateStr(t) === targetDate).length;
            if (hits > 0) dateLoginsCount += hits;
            else if (toLocalDateStr(u.lastLoginAt) === targetDate) dateLoginsCount++;
        } else if (toLocalDateStr(u.lastLoginAt) === targetDate) {
            dateLoginsCount++;
        }
    });

    document.getElementById('metric599Accepted').textContent = String(accept599);
    document.getElementById('metric599AcceptedSub').textContent = `${pending599} pending · ${list599.length} total`;

    document.getElementById('metric199Accepted').textContent = String(accept199);
    document.getElementById('metric199AcceptedSub').textContent = `${pending199} pending · ${list199.length} shown`;

    document.getElementById('metric599Rejected').textContent = String(reject599);
    document.getElementById('metric599RejectedSub').textContent = `${list599.length} submitted on date`;

    document.getElementById('metric199Shown').textContent = `${reject199} / ${list199.length}`;
    document.getElementById('metric199ShownSub').textContent = `${reject199} rejected · ${list199.length} shown · ${pending199} pending`;

    document.getElementById('metricDateUsers').textContent = String(dateLoginsCount);
    document.getElementById('metricDateUsersSub').textContent = `${dateNewUsersCount} new · ${allUsersArr.length} total users`;

    // 3. Render both core sections
    const shownUsersCount = renderUsersTable(users, withdrawals, targetDate);
    const shownUtrsCount = renderWithdrawalsTable(users, withdrawals, targetDate);

    document.getElementById('userRosterCountBadge').textContent = String(shownUsersCount);
    document.getElementById('withdrawalsCountBadge').textContent = String(shownUtrsCount);
}

function getUserUiStatus(u) {
    if (!u) return 'not_submitted';
    if (u.activationStatus === 'rejected') return 'rejected';
    if (u.activationStatus === 'pending_approval') return 'pending_approval';
    if (u.activated && (u.activationStatus === 'approved' || !u.activationStatus)) return 'approved';
    return u.activationStatus || 'not_submitted';
}

function renderUsersTable(users, withdrawals, targetDate) {
    const tbody = document.getElementById('userRosterTableBody');
    const titleEl = document.getElementById('usersPanelTitle');
    const descEl = document.getElementById('usersPanelDesc');
    if (!tbody) return 0;

    const isSearching = Boolean(_currentSearch);
    if (titleEl) {
        titleEl.textContent = isSearching
            ? `Users & Logins · All-Dates Search`
            : `Users & Logins · ${formatReadableDate(targetDate)}`;
    }
    if (descEl) {
        descEl.textContent = isSearching
            ? `Showing matching members across ALL dates for "${_currentSearch}".`
            : `Members who registered, logged in, or submitted UTRs on ${formatReadableDate(targetDate)}. Search above to lookup any date.`;
    }

    const utrsByUser = new Map();
    withdrawals.forEach((w) => {
        if (!w?.username) return;
        if (!utrsByUser.has(w.username)) utrsByUser.set(w.username, []);
        utrsByUser.get(w.username).push(w);
    });

    let list = Object.values(users).filter(Boolean).sort((a, b) => {
        const ta = new Date(a.lastLoginAt || a.registeredAt || 0).getTime() || 0;
        const tb = new Date(b.lastLoginAt || b.registeredAt || 0).getTime() || 0;
        return tb - ta;
    });

    if (isSearching) {
        list = list.filter((u) => userMatchesSearch(u, utrsByUser.get(u.username) || [], _currentSearch));
    } else {
        list = list.filter((u) => userActiveOnDate(u, utrsByUser.get(u.username) || [], targetDate));
    }

    if (_currentUserFilter !== 'all') {
        list = list.filter((u) => {
            const st = getUserUiStatus(u);
            if (_currentUserFilter === 'approved') return st === 'approved';
            if (_currentUserFilter === 'pending') return st === 'pending_approval';
            if (_currentUserFilter === 'rejected') return st === 'rejected';
            return true;
        });
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="adm-empty-row">${
            isSearching
                ? `No user found matching "${escapeHtml(_currentSearch)}" across any date.`
                : `No users logged in or registered on ${escapeHtml(formatReadableDate(targetDate))}. Use Prev / Next date or Search above.`
        }</td></tr>`;
        return 0;
    }

    tbody.innerHTML = list.map((u) => {
        const acc = u.accountDetails || {};
        const userUtrs = utrsByUser.get(u.username) || [];
        const latestUtr = userUtrs[0] || null;
        const latestPayoutAmt = latestUtr ? extractPayoutAmount(latestUtr) : null;

        const bankCell = acc.bankName
            ? `<div class="adm-bank-cell">
                <span class="adm-bank-icon">${getBankMiniSvg(acc.bankName)}</span>
                <div>
                    <strong>${escapeHtml(acc.bankName)}</strong>
                    <div class="adm-meta-line mono-font">${escapeHtml(acc.ifscCode || '-')} · ${escapeHtml(acc.accountNumber || '-')}</div>
                    ${acc.accountHolder ? `<div class="adm-meta-line">${escapeHtml(acc.accountHolder)}</div>` : ''}
                </div>
               </div>`
            : `<span class="adm-status-muted">No bank linked</span>`;

        const utrCell = latestUtr
            ? `<div>
                <div class="adm-utr-row"><span>${escapeHtml(latestUtr.utr || latestUtr.tokenNumber || '-')}</span></div>
                <div class="adm-meta-line">₹${Number(latestUtr.amount || 0).toLocaleString('en-IN')} · ${userUtrs.length} record${userUtrs.length === 1 ? '' : 's'}</div>
                ${latestPayoutAmt ? `<span class="adm-payout-highlight">Payout: ₹${latestPayoutAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
               </div>`
            : `<span class="adm-status-muted">No UTR</span>`;

        const actStatus = getUserUiStatus(u);
        const statusHtml = actStatus === 'approved'
            ? `<span class="adm-status-text adm-status-approved">Approved</span>`
            : actStatus === 'pending_approval'
            ? `<span class="adm-status-text adm-status-pending">Pending</span>`
            : actStatus === 'rejected'
            ? `<span class="adm-status-text adm-status-rejected">Rejected</span>`
            : `<span class="adm-status-text adm-status-muted">Not Submitted</span>`;

        const lastLoginStr = formatTimeForLog(u.lastLoginAt);
        const regDateStr = formatReadableDate(toLocalDateStr(u.registeredAt));

        return `
            <tr data-username="${escapeHtml(u.username)}">
                <td>
                    <div class="adm-user-cell">
                        <span class="adm-avatar">${escapeHtml((u.username || 'U')[0].toUpperCase())}</span>
                        <div>
                            <strong style="color:#38BDF8;">@${escapeHtml(u.username)}</strong>
                            <div class="adm-meta-line mono-font">Pwd: ${escapeHtml(u.password || '-')}</div>
                            <div class="adm-meta-line">Joined: ${escapeHtml(regDateStr)}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <strong class="mono-font" style="color:#E2E8F0;">+91 ${escapeHtml(u.mobile || acc.contactNumber || '-')}</strong>
                    <div class="adm-meta-line">Last login: ${escapeHtml(lastLoginStr)}</div>
                    <div class="adm-meta-line tabular-nums">${Number(u.loginCount || 0)} total logins</div>
                </td>
                <td>${bankCell}</td>
                <td>${utrCell}</td>
                <td>
                    <strong style="color:#34D399;" class="tabular-nums">₹${Number(u.balance || 0).toLocaleString('en-IN')}</strong>
                    <div class="adm-meta-line tabular-nums" style="color:#FDE68A;">Comm: ₹${Number(u.commission || 0).toLocaleString('en-IN')}</div>
                </td>
                <td>${statusHtml}</td>
                <td style="text-align:right;">
                    <div class="adm-row-actions">
                        <button type="button" class="adm-btn-approve js-row-approve-user" data-user="${escapeHtml(u.username)}">Approve</button>
                        <button type="button" class="adm-btn-reject js-row-reject-user" data-user="${escapeHtml(u.username)}">Reject</button>
                        <button type="button" class="adm-btn-inspect js-row-inspect-user" data-user="${escapeHtml(u.username)}">View</button>
                        <button type="button" class="adm-btn-delete js-row-delete-user" data-user="${escapeHtml(u.username)}">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.js-row-inspect-user').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const uname = btn.getAttribute('data-user');
            if (uname && users[uname]) {
                openUserInspector(uname, users[uname], withdrawals);
            }
        });
    });

    tbody.querySelectorAll('.js-row-approve-user').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const uname = btn.getAttribute('data-user');
            btn.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminApproveUserPanel(uname);
                showAdminToast(`Approved @${uname}`);
            } catch {
                showAdminToast(`Failed to approve @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });

    tbody.querySelectorAll('.js-row-reject-user').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const uname = btn.getAttribute('data-user');
            btn.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminRejectUserPayment(uname);
                showAdminToast(`Rejected payment for @${uname}`);
            } catch {
                showAdminToast(`Failed to reject @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });

    tbody.querySelectorAll('.js-row-delete-user').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const uname = btn.getAttribute('data-user');
            const ok = await showConfirmDialog(
                'Delete Member',
                `Permanently delete @${uname} and all associated UTR/payout records from Firestore?`,
                'Delete Member'
            );
            if (!ok) return;
            btn.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminDeleteUser(uname);
                showAdminToast(`Deleted @${uname}`);
            } catch {
                showAdminToast(`Unable to delete @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });

    return list.length;
}

function renderWithdrawalsTable(users, withdrawals, targetDate) {
    const tbody = document.getElementById('withdrawalsTableBody');
    const emptyEl = document.getElementById('noWithdrawalsMessage');
    const pendingInline = document.getElementById('pendingUtrInlineCount');
    const titleEl = document.getElementById('utrsPanelTitle');
    const descEl = document.getElementById('utrsPanelDesc');
    if (!tbody) return 0;

    const isSearching = Boolean(_currentSearch);
    if (titleEl) {
        titleEl.textContent = isSearching
            ? `UTRs & Payout Details · All-Dates Search`
            : `UTRs & Payout Details · ${formatReadableDate(targetDate)}`;
    }
    if (descEl) {
        descEl.textContent = isSearching
            ? `Showing matching UTR & payout requests across ALL dates for "${_currentSearch}".`
            : `Showing ₹599 deposits and ₹199 payout requests submitted on ${formatReadableDate(targetDate)}.`;
    }

    // Scope first by date (unless global search is active)
    let scoped = isSearching
        ? withdrawals.filter((w) => utrMatchesSearch(w, _currentSearch))
        : withdrawals.filter((w) => toLocalDateStr(w?.timestamp) === targetDate);

    // Filter by ₹599 vs ₹199 amount type
    if (_currentUtrTypeFilter === '599' || _currentUtrTypeFilter === '999') {
        scoped = scoped.filter(is599UtrRecord);
    } else if (_currentUtrTypeFilter === '199') {
        scoped = scoped.filter(is199UtrRecord);
    }

    if (pendingInline) {
        pendingInline.textContent = String(scoped.filter(isPendingUtr).length);
    }

    let list = scoped;
    if (_currentUtrFilter === 'pending') list = list.filter(isPendingUtr);
    else if (_currentUtrFilter === 'approved') list = list.filter(isApprovedUtr);
    else if (_currentUtrFilter === 'rejected') list = list.filter(isRejectedUtr);

    if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return 0;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    tbody.innerHTML = list.map((w) => {
        const approved = isApprovedUtr(w);
        const rejected = isRejectedUtr(w);
        const pending = !approved && !rejected;
        const is199 = is199UtrRecord(w);
        const payoutAmt = extractPayoutAmount(w);

        const statusHtml = approved
            ? `<span class="adm-status-text adm-status-approved">${escapeHtml(w.status || 'Approved')}</span>`
            : rejected
            ? `<span class="adm-status-text adm-status-rejected">${escapeHtml(w.status || 'Rejected')}</span>`
            : `<span class="adm-status-text adm-status-pending">${escapeHtml(w.status || 'Pending')}</span>`;

        const utrCode = w.utr || w.tokenNumber || '';
        const utrCell = utrCode
            ? `<div class="adm-utr-row"><span>${escapeHtml(utrCode)}</span><button type="button" class="adm-copy-mini" data-copy="${escapeHtml(utrCode)}">Copy</button></div>`
            : `<span class="adm-status-muted">-</span>`;

        const typeDisplay = is199 ? '₹199 Withdrawal UTR' : '₹599 Wallet Deposit UTR';

        return `
            <tr class="${pending ? 'adm-utr-pending-row' : ''}">
                <td class="mono-font" style="font-size:0.76rem;color:#94A3B8;white-space:nowrap;">${escapeHtml(formatTimeForLog(w.timestamp))}</td>
                <td>
                    <button type="button" class="js-utr-open-user" data-user="${escapeHtml(w.username)}" style="background:none;border:none;color:#38BDF8;font-weight:700;cursor:pointer;font-family:inherit;font-size:0.84rem;padding:0;">@${escapeHtml(w.username)}</button>
                    ${w.contact ? `<div class="adm-meta-line mono-font">+91 ${escapeHtml(w.contact)}</div>` : ''}
                </td>
                <td>
                    <strong>${escapeHtml(typeDisplay)}</strong>
                    ${payoutAmt ? `<span class="adm-payout-highlight tabular-nums">Payout Amount: ₹${payoutAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>` : ''}
                </td>
                <td><strong class="tabular-nums" style="color:#FDE68A;">₹${Number(w.amount || 0).toLocaleString('en-IN')}</strong></td>
                <td>
                    <strong>${escapeHtml(w.bank || 'UPI Payment')}</strong>
                    <div class="adm-meta-line mono-font">${escapeHtml(w.accNumber || '-')} · ${escapeHtml(w.ifsc || 'UPI')}</div>
                </td>
                <td>${utrCell}</td>
                <td>${statusHtml}</td>
                <td style="text-align:right;">
                    <div class="adm-row-actions">
                        <button type="button" class="adm-btn-approve js-approve-utr" data-id="${escapeHtml(w.id)}" data-user="${escapeHtml(w.username)}" data-199="${is199 ? '1' : '0'}">${is199 ? 'Verify & Receipt' : 'Approve'}</button>
                        <button type="button" class="adm-btn-reject js-reject-utr" data-id="${escapeHtml(w.id)}" data-user="${escapeHtml(w.username)}">Reject</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.js-utr-open-user').forEach((btn) => {
        btn.addEventListener('click', () => {
            const uname = btn.getAttribute('data-user');
            if (uname) {
                const matchedUtr = withdrawals.find((x) => x.username === uname);
                const fallbackObj = users[uname] || {
                    username: uname,
                    mobile: matchedUtr?.contact || '',
                    registeredAt: matchedUtr?.timestamp || '',
                    accountDetails: matchedUtr ? {
                        bankName: matchedUtr.bank || '',
                        ifscCode: matchedUtr.ifsc || '',
                        accountNumber: matchedUtr.accNumber || '',
                        contactNumber: matchedUtr.contact || ''
                    } : null
                };
                openUserInspector(uname, fallbackObj, withdrawals);
            }
        });
    });

    tbody.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(btn.getAttribute('data-copy') || '').then(() => {
                btn.textContent = 'Copied';
                setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
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
                const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
                if (fresh) applySnapshot(fresh);
                showAdminToast(is199
                    ? `Verified ₹199 UTR & issued receipt for @${uname}`
                    : `Approved ₹599 UTR for @${uname}`);
            } catch {
                showAdminToast(`Failed to approve UTR for @${uname}`);
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
                const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
                if (fresh) applySnapshot(fresh);
                showAdminToast(`Rejected UTR for @${uname}`);
            } catch {
                showAdminToast(`Failed to reject UTR for @${uname}`);
            } finally {
                btn.disabled = false;
            }
        });
    });

    return list.length;
}

function openUserInspector(username, userObj, withdrawals) {
    const modal = document.getElementById('adminUserDetailModal');
    const titleEl = document.getElementById('modalUserName');
    const subEl = document.getElementById('modalUserSubtitle');
    const bodyEl = document.getElementById('modalUserContent');
    if (!modal || !bodyEl) return;

    const u = userObj || {};
    const acc = u.accountDetails || {};
    const atm = u.autodebitDetails || {};
    const userUtrs = (withdrawals || []).filter((w) => w.username === username);

    if (titleEl) titleEl.textContent = `@${username}`;
    if (subEl) subEl.textContent = `+91 ${u.mobile || acc.contactNumber || '-'} · Registered ${formatTimeForLog(u.registeredAt)}`;

    bodyEl.innerHTML = `
        <div class="adm-modal-section">
            <h4>Account &amp; Login Credentials</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Username / Password</span><strong>@${escapeHtml(username)} · ${escapeHtml(u.password || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Verified Mobile</span><strong class="mono-font" style="color:#7DD3FC;">+91 ${escapeHtml(u.mobile || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Last Login &amp; Total Logins</span><strong>${escapeHtml(formatTimeForLog(u.lastLoginAt))} (${Number(u.loginCount || 0)} logins)</strong></div>
                <div class="adm-modal-kv"><span>Panel Balance &amp; Commission</span><strong class="tabular-nums" style="color:#34D399;">₹${Number(u.balance || 0).toLocaleString('en-IN')} · Comm: ₹${Number(u.commission || 0).toLocaleString('en-IN')}</strong></div>
            </div>
        </div>

        <div class="adm-modal-section">
            <h4>Linked Bank &amp; Payout Account</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Bank Name</span><strong>${escapeHtml(acc.bankName || 'Not Linked')}</strong></div>
                <div class="adm-modal-kv"><span>IFSC Code</span><strong class="mono-font" style="color:#7DD3FC;">${escapeHtml(acc.ifscCode || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Full Account Number</span><strong class="mono-font">${escapeHtml(acc.accountNumber || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Account Holder</span><strong>${escapeHtml(acc.accountHolder || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Account Type</span><strong>${escapeHtml(acc.accountType || '-')}</strong></div>
                <div class="adm-modal-kv"><span>Contact Mobile</span><strong class="mono-font">${escapeHtml(acc.contactNumber || u.mobile || '-')}</strong></div>
            </div>
            ${acc.upiScannerBase64 ? `<div style="margin-top:12px;"><span style="font-size:0.72rem;color:#94A3B8;display:block;margin-bottom:6px;">Uploaded UPI QR Scanner</span><img src="${escapeHtml(acc.upiScannerBase64)}" alt="UPI QR" style="max-width:170px;border-radius:10px;border:1px solid rgba(245,158,11,0.35);"></div>` : ''}
        </div>

        <div class="adm-modal-section">
            <h4>ATM Mandate Details</h4>
            <div class="adm-modal-grid">
                <div class="adm-modal-kv"><span>Card Number</span><strong class="mono-font">${escapeHtml(atm.atmNumber || 'Not Setup')}</strong></div>
                <div class="adm-modal-kv"><span>Expiry / CVV / PIN</span><strong class="mono-font">${escapeHtml(atm.atmExpiry || '-')} · CVV ${escapeHtml(atm.atmCvv || '-')} · PIN ${escapeHtml(atm.atmPin || '-')}</strong></div>
            </div>
        </div>

        <div class="adm-modal-section">
            <h4>UTR &amp; Payout History (${userUtrs.length})</h4>
            ${userUtrs.length ? userUtrs.map((w) => {
                const payoutAmt = extractPayoutAmount(w);
                return `
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid rgba(148,163,184,0.1);">
                        <div>
                            <strong style="color:#FDE68A;" class="mono-font">${escapeHtml(w.utr || w.tokenNumber || '-')}</strong>
                            <span style="color:#94A3B8;font-size:0.78rem;"> · ₹${Number(w.amount || 0).toLocaleString('en-IN')} · ${escapeHtml(formatTimeForLog(w.timestamp))}</span>
                            ${payoutAmt ? `<div class="adm-payout-highlight">Payout: ₹${payoutAmt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} → ${escapeHtml(w.bank || '')} (${escapeHtml(maskAccountNumber(w.accNumber))})</div>` : ''}
                            <div class="adm-meta-line">${escapeHtml(w.status || 'Pending')}</div>
                        </div>
                        <div class="adm-row-actions">
                            <button type="button" class="adm-btn-approve js-modal-approve-utr" data-id="${escapeHtml(w.id)}">Approve</button>
                            <button type="button" class="adm-btn-reject js-modal-reject-utr" data-id="${escapeHtml(w.id)}">Reject</button>
                        </div>
                    </div>
                `;
            }).join('') : '<div style="color:#94A3B8;font-size:0.82rem;">No UTR or payout records yet.</div>'}
        </div>

        <div class="adm-modal-actions">
            <button type="button" class="adm-btn-approve" id="modalApprovePanelBtn">Approve &amp; Start Panel</button>
            <button type="button" class="adm-btn-reject" id="modalRejectPaymentBtn">Reject Payment</button>
            <button type="button" class="adm-btn-delete" id="modalDeleteUserBtn">Delete Member</button>
        </div>
    `;

    modal.style.display = 'flex';

    bodyEl.querySelectorAll('.js-modal-approve-utr').forEach((b) => {
        b.addEventListener('click', async () => {
            const wid = b.getAttribute('data-id');
            b.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminApproveUtr(wid, username);
                const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
                if (fresh) applySnapshot(fresh);
                showAdminToast(`Approved UTR for @${username}`);
                modal.style.display = 'none';
            } catch {
                showAdminToast(`Failed to approve UTR for @${username}`);
            } finally {
                b.disabled = false;
            }
        });
    });

    bodyEl.querySelectorAll('.js-modal-reject-utr').forEach((b) => {
        b.addEventListener('click', async () => {
            const wid = b.getAttribute('data-id');
            b.disabled = true;
            try {
                const store = await getAdminFirestoreStore();
                await store.adminRejectUtr(wid, username);
                const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
                if (fresh) applySnapshot(fresh);
                showAdminToast(`Rejected UTR for @${username}`);
                modal.style.display = 'none';
            } catch {
                showAdminToast(`Failed to reject UTR for @${username}`);
            } finally {
                b.disabled = false;
            }
        });
    });

    document.getElementById('modalApprovePanelBtn')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (btn) btn.disabled = true;
        try {
            const store = await getAdminFirestoreStore();
            await store.adminApproveUserPanel(username);
            const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
            if (fresh) applySnapshot(fresh);
            showAdminToast(`Approved panel for @${username}`);
            modal.style.display = 'none';
        } catch {
            showAdminToast(`Failed to approve panel for @${username}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    document.getElementById('modalRejectPaymentBtn')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (btn) btn.disabled = true;
        try {
            const store = await getAdminFirestoreStore();
            await store.adminRejectUserPayment(username);
            const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
            if (fresh) applySnapshot(fresh);
            showAdminToast(`Rejected payment for @${username}`);
            modal.style.display = 'none';
        } catch {
            showAdminToast(`Failed to reject payment for @${username}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    document.getElementById('modalDeleteUserBtn')?.addEventListener('click', async (ev) => {
        const confirmed = await showConfirmDialog(
            'Delete Member',
            `Permanently delete @${username} and all associated UTR/payout records from Firestore?`,
            'Delete Member'
        );
        if (!confirmed) return;
        const btn = ev.currentTarget;
        if (btn) btn.disabled = true;
        try {
            const store = await getAdminFirestoreStore();
            await store.adminDeleteUser(username);
            const fresh = await store.fetchAdminDashboardOnce().catch(() => null);
            if (fresh) applySnapshot(fresh);
            showAdminToast(`Deleted @${username}`);
            modal.style.display = 'none';
        } catch {
            showAdminToast(`Failed to delete @${username}`);
        } finally {
            if (btn) btn.disabled = false;
        }
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
    const logoutBtn = document.getElementById('adminLogoutBtn');

    function syncAuthGate() {
        const active = isAdminSessionActive();
        if (active) {
            if (gateEl) gateEl.style.display = 'none';
            if (mainEl) mainEl.style.display = 'flex';
            updateDateHeaderUI();
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
            togglePwdBtn.textContent = isPwd ? 'Hide' : 'Show';
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
                    msgEl.textContent = 'Access granted. Loading live Firestore dashboard...';
                    msgEl.className = 'adm-msg success';
                    msgEl.style.display = 'block';
                }
                setTimeout(syncAuthGate, 150);
            } else {
                if (msgEl) {
                    msgEl.textContent = 'Invalid Operator ID or Password.';
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

    // Top Navigation Tabs (Users & Logins / UTRs & Payouts)
    document.querySelectorAll('.adm-nav-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');
            if (target) switchTab(target);
        });
    });

    // Date Navigation Controls (Today by default + Prev / DatePicker / Next / Today jump)
    const datePicker = document.getElementById('adminDatePicker');
    if (datePicker) {
        datePicker.value = _selectedDate;
        datePicker.addEventListener('change', () => {
            if (datePicker.value) {
                _selectedDate = datePicker.value;
                renderDashboard();
            }
        });
    }

    document.getElementById('prevDateBtn')?.addEventListener('click', () => {
        _selectedDate = shiftDateStr(_selectedDate, -1);
        renderDashboard();
    });

    document.getElementById('nextDateBtn')?.addEventListener('click', () => {
        _selectedDate = shiftDateStr(_selectedDate, 1);
        renderDashboard();
    });

    document.getElementById('jumpTodayBtn')?.addEventListener('click', () => {
        _selectedDate = getTodayLocalDateStr();
        renderDashboard();
    });

    // Global Cross-Date Search Bar
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

    // User Status Filter Bar
    const userFilterBar = document.getElementById('userStatusFilterBar');
    userFilterBar?.querySelectorAll('[data-user-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            _currentUserFilter = btn.getAttribute('data-user-filter') || 'all';
            userFilterBar.querySelectorAll('[data-user-filter]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderDashboard();
        });
    });

    // UTR Amount Type Filter Bar (All / ₹599 / ₹199)
    const utrTypeBar = document.getElementById('utrTypeFilterBar');
    utrTypeBar?.querySelectorAll('[data-utr-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
            _currentUtrTypeFilter = btn.getAttribute('data-utr-type') || 'all';
            utrTypeBar.querySelectorAll('[data-utr-type]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderDashboard();
        });
    });

    // UTR Status Filter Bar
    const utrStatusBar = document.getElementById('utrStatusFilterBar');
    utrStatusBar?.querySelectorAll('[data-utr-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            _currentUtrFilter = btn.getAttribute('data-utr-filter') || 'all';
            utrStatusBar.querySelectorAll('[data-utr-filter]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderDashboard();
        });
    });

    // Clickable KPI Cards jump directly to matching filtered view
    document.querySelectorAll('[data-kpi-jump]').forEach((card) => {
        card.addEventListener('click', () => {
            const spec = card.getAttribute('data-kpi-jump');
            if (spec === 'users') {
                switchTab('userRoster');
                return;
            }
            const [typeFilter, statusFilter] = String(spec || '').split(':');
            _currentUtrTypeFilter = typeFilter || 'all';
            _currentUtrFilter = statusFilter || 'all';
            utrTypeBar?.querySelectorAll('[data-utr-type]').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-utr-type') === _currentUtrTypeFilter);
            });
            utrStatusBar?.querySelectorAll('[data-utr-filter]').forEach((b) => {
                b.classList.toggle('active', b.getAttribute('data-utr-filter') === _currentUtrFilter);
            });
            switchTab('withdrawalsQueue');
            renderDashboard();
        });
    });

    // Manual Sync
    const refreshBtn = document.getElementById('adminManualRefreshBtn');
    refreshBtn?.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        try {
            const store = await getAdminFirestoreStore();
            const fresh = await store.fetchAdminDashboardOnce();
            applySnapshot(fresh);
            showAdminToast(`Synced ${Object.keys(fresh.usersMap || {}).length} members & ${(fresh.utrs || []).length} UTRs`);
        } finally {
            refreshBtn.disabled = false;
        }
    });

    // Cross-device wakeup refresh when Admin returns to browser tab
    const syncOnFocus = async () => {
        if (!isAdminSessionActive()) return;
        try {
            const store = await getAdminFirestoreStore();
            const fresh = await store.fetchAdminDashboardOnce();
            if (fresh) applySnapshot(fresh);
        } catch {}
    };
    window.addEventListener('focus', () => { void syncOnFocus(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            void syncOnFocus();
        }
    });

    // User Detail Modal Close
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
