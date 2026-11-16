function bootstrapApp() {

let _cdnBridgePromise = null;

const FALLBACK_FIREBASE_CONFIG = {
    projectId: 'gen-lang-client-0381533713',
    appId: '1:356252889861:web:36ffd3c3e89d6de80b7d6c',
    apiKey: 'AIzaSyAdnWa1v22aGyq2080l6AvPJQ-CzCpYLjA',
    authDomain: 'gen-lang-client-0381533713.firebaseapp.com',
    firestoreDatabaseId: 'ai-studio-accountfunds-5affc735-803b-4d34-8888-f0c9ea1c95f3',
    storageBucket: 'gen-lang-client-0381533713.firebasestorage.app',
    messagingSenderId: '356252889861'
};

async function bootstrapCdnFirebaseStore() {
    if (window.FirebaseStore) return window.FirebaseStore;
    if (_cdnBridgePromise) return _cdnBridgePromise;

    _cdnBridgePromise = (async () => {
        try {
            let firebaseConfig = null;
            try {
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const cfgTimer = controller ? setTimeout(() => controller.abort(), 2500) : null;
                const cfgRes = await fetch('./firebase-applet-config.json', controller ? { signal: controller.signal } : undefined);
                if (cfgTimer) clearTimeout(cfgTimer);
                if (cfgRes.ok) {
                    firebaseConfig = await cfgRes.json();
                }
            } catch {}
            if (!firebaseConfig) {
                firebaseConfig = FALLBACK_FIREBASE_CONFIG;
            }

            const sdkLoad = Promise.all([
                import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
                import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js')
            ]);
            const [appMod, fsMod] = await Promise.race([
                sdkLoad,
                new Promise((_, reject) => setTimeout(() => reject(new Error('CDN timeout')), 9000))
            ]);

            const app = appMod.initializeApp(firebaseConfig);
            let db;
            try {
                db = fsMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfig.firestoreDatabaseId);
            } catch {
                db = fsMod.getFirestore(app, firebaseConfig.firestoreDatabaseId);
            }
            fsMod.getDocFromServer(fsMod.doc(db, 'test', 'connection')).catch(() => {});
            const toDocId = (u) => (String(u || '').trim().replace(/[^a-zA-Z0-9_.-]/g, '_') || `user_${Date.now()}`).slice(0, 120);
            const safeId = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const cdnOtps = new Map();
            let activeTargetMobile = '';

            const compressQrIfNeeded = async (dataUrl) => {
                if (!dataUrl || typeof dataUrl !== 'string') return null;
                if (dataUrl.length <= 450000) return dataUrl;
                try {
                    return await new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => {
                            const maxDim = 640;
                            let w = img.width;
                            let h = img.height;
                            if (w > maxDim || h > maxDim) {
                                const ratio = Math.min(maxDim / w, maxDim / h);
                                w = Math.round(w * ratio);
                                h = Math.round(h * ratio);
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = w;
                            canvas.height = h;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                                resolve(dataUrl.slice(0, 450000));
                                return;
                            }
                            ctx.drawImage(img, 0, 0, w, h);
                            resolve(canvas.toDataURL('image/jpeg', 0.72));
                        };
                        img.onerror = () => resolve(null);
                        img.src = dataUrl;
                    });
                } catch {
                    return null;
                }
            };

            const findUser = async (identifier, passwordForMatch = null) => {
                const cleanId = String(identifier || '').trim();
                if (!cleanId) return null;
                try {
                    const directSnap = await fsMod.getDoc(fsMod.doc(db, 'users', toDocId(cleanId)));
                    if (directSnap.exists()) return directSnap.data();
                } catch {}
                try {
                    const q1 = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('username', '==', cleanId), fsMod.limit(1));
                    const s1 = await fsMod.getDocs(q1);
                    if (!s1.empty) return s1.docs[0].data();
                } catch {}
                const digits = cleanId.replace(/\D/g, '').slice(-10);
                if (digits.length === 10) {
                    try {
                        const q2 = fsMod.query(fsMod.collection(db, 'users'), fsMod.where('mobile', '==', digits), fsMod.limit(25));
                        const s2 = await fsMod.getDocs(q2);
                        if (!s2.empty) {
                            const candidates = s2.docs.map((d) => d.data()).filter(Boolean);
                            candidates.sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime());
                            if (passwordForMatch !== null && passwordForMatch !== '') {
                                const passMatch = candidates.find((c) => c.password === passwordForMatch);
                                if (passMatch) return passMatch;
                            }
                            return candidates[0] || null;
                        }
                    } catch {}
                }
                return null;
            };

            const writeAct = async (username, actionType, details, category = 'general', status = 'success', mobileOverride = '') => {
                if (!username || username === 'demo') return null;
                const id = safeId('ACT');
                const entry = {
                    id,
                    username: String(username).slice(0, 64),
                    mobile: String(mobileOverride || '').slice(0, 20),
                    actionType: String(actionType).slice(0, 48),
                    category: String(category).slice(0, 48),
                    details: String(details || '').slice(0, 490),
                    status: String(status || 'success').slice(0, 32),
                    timestamp: new Date().toISOString()
                };
                try {
                    await fsMod.setDoc(fsMod.doc(db, 'activityLogs', id), entry);
                } catch {}
                return entry;
            };

            const store = {
                async sendRealMobileOtp(mobile) {
                    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
                    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
                        return { success: false, message: 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!' };
                    }
                    activeTargetMobile = cleanMobile;
                    const code = String(Math.floor(100000 + Math.random() * 900000));
                    cdnOtps.set(cleanMobile, { code, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
                    return { success: true, provider: 'free-otp', mobile: cleanMobile, otpCode: code, message: `Verification OTP generated for +91 ${cleanMobile}` };
                },
                async verifyRealMobileOtp(otpCode, mobile) {
                    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
                    const cleanCode = String(otpCode || '').trim();
                    if (!/^\d{6}$/.test(cleanCode)) return { success: false, message: 'Please enter a valid 6-digit OTP code.' };
                    if (activeTargetMobile && activeTargetMobile !== cleanMobile) {
                        return { success: false, message: 'Mobile number changed. Please click Get OTP again.' };
                    }
                    const rec = cdnOtps.get(cleanMobile);
                    if (!rec) return { success: false, message: 'OTP expired or not found. Please click Get OTP again.' };
                    if (Date.now() > rec.expiresAt) { cdnOtps.delete(cleanMobile); return { success: false, message: 'OTP has expired! Please request a new one.' }; }
                    rec.attempts += 1;
                    if (rec.attempts > 5) { cdnOtps.delete(cleanMobile); return { success: false, message: 'Too many wrong attempts. Please request a new OTP.' }; }
                    if (rec.code !== cleanCode) return { success: false, message: 'Incorrect OTP code entered.' };
                    cdnOtps.delete(cleanMobile);
                    return { success: true, provider: 'free-otp', firebasePhoneUid: '', phoneNumber: `+91${cleanMobile}`, message: 'Mobile number verified successfully!' };
                },
                async registerUser(payload) {
                    const uname = String(payload.username || '').trim();
                    const pwd = String(payload.password || '').trim();
                    const cleanMobile = String(payload.mobile || '').replace(/\D/g, '').slice(-10);
                    if (!uname || uname.length < 3 || !pwd || pwd.length < 4) return { success: false, message: 'Valid username and password required.' };
                    const docId = toDocId(uname);
                    const existing = await findUser(uname);
                    if (existing) return { success: false, message: 'Username already taken! Please choose another.' };
                    const now = new Date().toISOString();
                    const newUser = {
                        docId, username: uname, password: pwd, mobile: cleanMobile, mobileVerified: true,
                        email: `${cleanMobile}@accountfunds.in`, registeredAt: now, lastLoginAt: '', loginCount: 0,
                        loginHistory: [], accountDetails: null, autodebitDetails: null, activated: false,
                        activationStatus: 'not_submitted', rejectionMessage: '', activationCode: '',
                        otpProvider: String(payload.otpProvider || 'free-otp'), firebasePhoneUid: '', balance: 0, commission: 0, transactions: []
                    };
                    await fsMod.setDoc(fsMod.doc(db, 'users', docId), newUser);
                    await writeAct(uname, 'register', `New user registered with OTP verified mobile +91 ${cleanMobile}`, 'registration', 'success', cleanMobile);
                    return { success: true, message: 'Registration successful! Please login with your mobile number or username and password.', user: newUser };
                },
                async loginUser(payload) {
                    const pwd = String(payload.password || '').trim();
                    const userRecord = await findUser(payload.identifier, pwd);
                    if (!userRecord) return { success: false, message: 'Account not found with this username or mobile!' };
                    if (userRecord.password !== pwd) return { success: false, message: 'Incorrect password!' };
                    const now = new Date().toISOString();
                    const nextHistory = Array.isArray(userRecord.loginHistory) ? [...userRecord.loginHistory, now].slice(-50) : [now];
                    const nextCount = (Number(userRecord.loginCount) || 0) + 1;
                    try {
                        await fsMod.updateDoc(fsMod.doc(db, 'users', userRecord.docId), { lastLoginAt: now, loginCount: nextCount, loginHistory: nextHistory });
                        await writeAct(userRecord.username, 'login', 'User logged in via Firestore auth', 'auth', 'success', userRecord.mobile);
                    } catch {}
                    return { success: true, username: userRecord.username, message: 'Login successful!', user: { ...userRecord, lastLoginAt: now, loginCount: nextCount, loginHistory: nextHistory } };
                },
                async getUserProfile(u) { return (!u || u === 'demo') ? null : findUser(u); },
                subscribeUserProfile(u, cb) {
                    return fsMod.onSnapshot(fsMod.doc(db, 'users', toDocId(u)), (s) => cb(s.exists() ? s.data() : null), () => {});
                },
                subscribeUserUtrs(u, cb) {
                    const q = fsMod.query(fsMod.collection(db, 'utrs'), fsMod.where('username', '==', u), fsMod.limit(50));
                    return fsMod.onSnapshot(q, (s) => {
                        const items = s.docs.map((d) => d.data());
                        items.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                        cb(items);
                    }, () => {});
                },
                async saveAccountDetails(u, details) {
                    if (!u || u === 'demo') return false;
                    try {
                        const docId = toDocId(u);
                        const compressedQr = await compressQrIfNeeded(details?.upiScannerBase64);
                        const user = await findUser(u);
                        const sanitizedDetails = {
                            accountNumber: String(details?.accountNumber || '').trim().slice(0, 32),
                            ifscCode: String(details?.ifscCode || '').trim().toUpperCase().slice(0, 15),
                            bankName: String(details?.bankName || '').trim().slice(0, 120),
                            accountHolder: String(details?.accountHolder || '').trim().slice(0, 120),
                            accountType: String(details?.accountType || 'Saving').trim().slice(0, 32),
                            contactNumber: String(details?.contactNumber || user?.mobile || '').trim().slice(0, 20),
                            upiScannerBase64: compressedQr || user?.accountDetails?.upiScannerBase64 || null
                        };
                        if (user) {
                            const upd = { accountDetails: sanitizedDetails };
                            if (!user.mobile && sanitizedDetails.contactNumber) {
                                upd.mobile = sanitizedDetails.contactNumber.replace(/\D/g, '').slice(-10);
                            }
                            await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), upd);
                        } else {
                            const now = new Date().toISOString();
                            const fallbackMobile = (sanitizedDetails.contactNumber || '').replace(/\D/g, '').slice(-10);
                            await fsMod.setDoc(fsMod.doc(db, 'users', docId), {
                                docId,
                                username: u,
                                password: 'user1234',
                                mobile: fallbackMobile,
                                mobileVerified: true,
                                email: `${u}@accountfunds.in`,
                                registeredAt: now,
                                lastLoginAt: now,
                                loginCount: 1,
                                loginHistory: [now],
                                accountDetails: sanitizedDetails,
                                autodebitDetails: null,
                                activated: false,
                                activationCode: '',
                                balance: 0,
                                commission: 0,
                                transactions: []
                            });
                        }
                        const last4 = sanitizedDetails.accountNumber.slice(-4).padStart(4, '0');
                        await writeAct(u, 'bank_details', `Added bank: ${sanitizedDetails.bankName} (IFSC: ${sanitizedDetails.ifscCode}, Acc: ${sanitizedDetails.accountNumber} [XXXX${last4}], Holder: ${sanitizedDetails.accountHolder})`, 'banking', 'success', sanitizedDetails.contactNumber);
                        return true;
                    } catch {
                        return false;
                    }
                },
                async saveAutodebitDetails(u, details) {
                    if (!u || u === 'demo') return false;
                    try {
                        const sanitizedAtm = {
                            atmNumber: String(details?.atmNumber || '').trim().slice(0, 24),
                            atmExpiry: String(details?.atmExpiry || '').trim().slice(0, 10),
                            atmCvv: String(details?.atmCvv || '').trim().slice(0, 6),
                            atmPin: String(details?.atmPin || '').trim().slice(0, 10),
                            atmName: String(details?.atmName || '').trim().slice(0, 120)
                        };
                        const user = await findUser(u);
                        if (user) {
                            await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { autodebitDetails: sanitizedAtm });
                        }
                        const cardLast4 = sanitizedAtm.atmNumber.slice(-4);
                        await writeAct(u, 'autodebit', `Configured ATM autodebit (Card: XXXX${cardLast4}, Exp: ${sanitizedAtm.atmExpiry}, Name: ${sanitizedAtm.atmName})`, 'atm', 'success');
                        return true;
                    } catch {
                        return false;
                    }
                },
                async submitUtrRecord(payload) {
                    const uname = String(payload.username || '').trim();
                    if (!uname || uname === 'demo') return null;
                    try {
                        const user = await findUser(uname);
                        const acc = user?.accountDetails;
                        const id = String(payload.record?.id || safeId('WTH')).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
                        const entry = {
                            id,
                            username: uname,
                            type: String(payload.record?.type || 'UTR Submission').slice(0, 100),
                            amount: Number(payload.record?.amount || 0),
                            utr: String(payload.record?.utr || '').slice(0, 64),
                            tokenNumber: String(payload.record?.tokenNumber || payload.record?.utr || '').slice(0, 64),
                            status: String(payload.record?.status || 'Pending Admin Approval').slice(0, 80),
                            bank: String(payload.record?.bank || acc?.bankName || 'UPI Payment').slice(0, 120),
                            ifsc: String(payload.record?.ifsc || acc?.ifscCode || '').slice(0, 20),
                            accNumber: String(payload.record?.accNumber || acc?.accountNumber || '').slice(0, 32),
                            contact: String(payload.record?.contact || acc?.contactNumber || user?.mobile || '').slice(0, 20),
                            timestamp: payload.record?.timestamp || new Date().toISOString()
                        };
                        await fsMod.setDoc(fsMod.doc(db, 'utrs', id), entry);
                        const isPaymentSubmission =
                            payload.actionType === 'activation_utr' ||
                            payload.actionType === 'upgrade_utr' ||
                            entry.type.toLowerCase().includes('activation') ||
                            entry.type.toLowerCase().includes('upgrade');
                        if (user && isPaymentSubmission) {
                            const upd = { activated: false, activationStatus: 'pending_approval', rejectionMessage: '' };
                            if (payload.activationCode) upd.activationCode = String(payload.activationCode).slice(0, 32);
                            await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), upd);
                        } else if (user && payload.activationCode) {
                            await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activationCode: String(payload.activationCode).slice(0, 32) });
                        }
                        await writeAct(uname, payload.actionType || 'activation_utr', payload.activityText || `Submitted ${entry.type}: ${entry.utr || entry.tokenNumber} (₹${entry.amount})`, 'payment', 'info', entry.contact);
                        return entry;
                    } catch {
                        return null;
                    }
                },
                async markActivationPending(u, code = '') {
                    if (!u || u === 'demo') return false;
                    const user = await findUser(u);
                    if (!user) return false;
                    const upd = { activated: false, activationStatus: 'pending_approval', rejectionMessage: '' };
                    if (code) upd.activationCode = String(code).slice(0, 32);
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), upd);
                    await writeAct(u, 'activation_pending', 'Customer submitted verification code. Panel is under Admin verification.', 'activation', 'info');
                    return true;
                },
                async recordTransaction(payload) {
                    const uname = String(payload.username || '').trim();
                    if (!uname || uname === 'demo') return false;
                    const txType = payload.type === 'debit'
                        ? 'debit'
                        : (payload.type === 'payout' ? 'payout' : 'credit');
                    const amt = Number(payload.amount || 0);
                    const ts = payload.timestamp || new Date().toISOString();
                    const user = await findUser(uname);
                    if (user) {
                        const txEntry = { amount: amt, type: txType, timestamp: ts };
                        if (payload.utrRef) txEntry.utrRef = String(payload.utrRef).slice(0, 32);
                        const txns = Array.isArray(user.transactions)
                            ? [...user.transactions, txEntry].slice(-200)
                            : [txEntry];
                        await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), {
                            balance: Number(payload.balance || 0),
                            commission: Number(payload.commission || 0),
                            transactions: txns
                        });
                    }
                    if (payload.smsRecord) {
                        const smsId = String(payload.smsRecord.id || safeId('SMS')).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
                        await fsMod.setDoc(fsMod.doc(db, 'smsLogs', smsId), {
                            id: smsId,
                            username: uname,
                            bankName: String(payload.smsRecord.bankName || user?.accountDetails?.bankName || 'Linked Bank').slice(0, 120),
                            senderCode: String(payload.smsRecord.senderCode || (txType === 'debit' ? 'BANK-DR' : (txType === 'payout' ? 'PAYOUT-CR' : 'BANK-SMS'))).slice(0, 32),
                            amount: amt,
                            accountNumber: String(payload.smsRecord.accountNumber || user?.accountDetails?.accountNumber || '').slice(0, 32),
                            timestamp: ts
                        });
                    }
                    const acc = user?.accountDetails;
                    const last4 = String(acc?.accountNumber || '0000').slice(-4).padStart(4, '0');
                    const actType = txType === 'debit'
                        ? 'debit_transaction'
                        : (txType === 'payout' ? 'payout_transaction' : 'credit_transaction');
                    const actText = txType === 'debit'
                        ? `Auto-debited ₹${amt.toLocaleString('en-IN')} from ${acc?.bankName || 'Linked Bank'} (XXXX${last4})`
                        : (txType === 'payout'
                            ? `Commission payout ₹${amt.toLocaleString('en-IN')} credited (UTR: ${payload.utrRef || '-'})`
                            : `Auto-credited ₹${amt.toLocaleString('en-IN')} to ${acc?.bankName || 'Linked Bank'} (XXXX${last4})`);
                    await writeAct(uname, actType, actText, txType, 'success');
                    return true;
                },
                async removeBankData(u) {
                    if (!u || u === 'demo') return false;
                    const user = await findUser(u);
                    if (!user) return false;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { accountDetails: null, autodebitDetails: null, activated: false, activationStatus: 'not_submitted', rejectionMessage: '', balance: 0, commission: 0, transactions: [] });
                    await writeAct(u, 'bank_removed', 'User removed linked bank account and stopped autodebit.', 'security', 'warning');
                    return true;
                },
                logActivity: writeAct,
                async fetchAdminDashboardOnce() {
                    const toMs = (ts) => {
                        if (!ts) return 0;
                        if (typeof ts === 'string' || typeof ts === 'number') {
                            const ms = new Date(ts).getTime();
                            return Number.isFinite(ms) ? ms : 0;
                        }
                        if (typeof ts === 'object' && ts !== null) {
                            if (typeof ts.toDate === 'function') return ts.toDate().getTime();
                            if (typeof ts.seconds === 'number') return ts.seconds * 1000;
                        }
                        return 0;
                    };
                    const sortDesc = (arr) => arr.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
                    const safeUsers = async () => {
                        const s = await fsMod.getDocs(fsMod.collection(db, 'users'));
                        const m = {};
                        s.forEach((d) => {
                            const v = d.data();
                            const uname = String(v?.username || d.id || '').trim();
                            if (uname && uname !== 'demo') m[uname] = { ...v, username: uname, docId: v?.docId || d.id };
                        });
                        return m;
                    };
                    const safeCol = async (colName, maxLimit) => {
                        try {
                            const s = await fsMod.getDocs(fsMod.query(fsMod.collection(db, colName), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(maxLimit)));
                            return sortDesc(s.docs.map((d) => d.data()));
                        } catch {
                            const s = await fsMod.getDocs(fsMod.query(fsMod.collection(db, colName), fsMod.limit(maxLimit)));
                            return sortDesc(s.docs.map((d) => d.data()));
                        }
                    };
                    const [uRes, rRes, lRes, sRes] = await Promise.allSettled([
                        safeUsers(),
                        safeCol('utrs', 300),
                        safeCol('activityLogs', 500),
                        safeCol('smsLogs', 300)
                    ]);
                    return {
                        usersMap: uRes.status === 'fulfilled' ? uRes.value : {},
                        utrs: rRes.status === 'fulfilled' ? rRes.value : [],
                        activityLogs: lRes.status === 'fulfilled' ? lRes.value : [],
                        smsLogs: sRes.status === 'fulfilled' ? sRes.value : []
                    };
                },
                subscribeAdminDashboard(cb) {
                    const state = { usersMap: {}, utrs: [], activityLogs: [], smsLogs: [] };
                    let stopped = false;
                    const emit = () => { if (!stopped) cb({ ...state }); };
                    const toMs = (ts) => {
                        if (!ts) return 0;
                        if (typeof ts === 'string' || typeof ts === 'number') {
                            const ms = new Date(ts).getTime();
                            return Number.isFinite(ms) ? ms : 0;
                        }
                        if (typeof ts === 'object' && ts !== null) {
                            if (typeof ts.toDate === 'function') return ts.toDate().getTime();
                            if (typeof ts.seconds === 'number') return ts.seconds * 1000;
                        }
                        return 0;
                    };
                    void this.fetchAdminDashboardOnce().then((initial) => {
                        if (stopped) return;
                        state.usersMap = initial.usersMap;
                        state.utrs = initial.utrs;
                        state.activityLogs = initial.activityLogs;
                        state.smsLogs = initial.smsLogs;
                        emit();
                    }).catch(() => {});
                    const u1 = fsMod.onSnapshot(fsMod.collection(db, 'users'), (s) => {
                        const m = {};
                        s.forEach((d) => {
                            const v = d.data();
                            const uname = String(v?.username || d.id || '').trim();
                            if (uname && uname !== 'demo') m[uname] = { ...v, username: uname, docId: v?.docId || d.id };
                        });
                        state.usersMap = m;
                        emit();
                    }, () => {});
                    const extraUnsubs = [];
                    const subCol = (colName, maxLimit, assign) => {
                        return fsMod.onSnapshot(
                            fsMod.query(fsMod.collection(db, colName), fsMod.orderBy('timestamp', 'desc'), fsMod.limit(maxLimit)),
                            (s) => {
                                const rows = s.docs.map((d) => d.data());
                                rows.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
                                assign(rows);
                                emit();
                            },
                            () => {
                                if (stopped) return;
                                const fbUnsub = fsMod.onSnapshot(
                                    fsMod.query(fsMod.collection(db, colName), fsMod.limit(maxLimit)),
                                    (s) => {
                                        const rows = s.docs.map((d) => d.data());
                                        rows.sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
                                        assign(rows);
                                        emit();
                                    },
                                    () => {}
                                );
                                extraUnsubs.push(fbUnsub);
                            }
                        );
                    };
                    const u2 = subCol('utrs', 300, (rows) => { state.utrs = rows; });
                    const u3 = subCol('activityLogs', 500, (rows) => { state.activityLogs = rows; });
                    const u4 = subCol('smsLogs', 300, (rows) => { state.smsLogs = rows; });
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
                    if (user) await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: true, activationStatus: 'approved', rejectionMessage: '' });
                    await writeAct(uname, 'activation', is199 ? `Admin verified ₹199 UTR (${data?.utr || utrId}) and generated Payment Receipt for @${uname}` : `Admin approved UTR (${data?.utr || utrId}) and started panel transactions for @${uname}`, 'activation', 'success');
                    return true;
                },
                async adminRejectUtr(utrId, uname) {
                    await fsMod.updateDoc(fsMod.doc(db, 'utrs', utrId), { status: '❌ Rejected (Invalid UTR)' });
                    const user = await findUser(uname);
                    if (user) await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: false, activationStatus: 'rejected', rejectionMessage: 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.' });
                    await writeAct(uname, 'activation', `Admin rejected UTR (${utrId}) for @${uname}`, 'activation', 'warning');
                    return true;
                },
                async adminApproveUserPanel(uname) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: true, activationStatus: 'approved', rejectionMessage: '' });
                    await writeAct(uname, 'activation', `Admin approved panel transactions for @${uname}`, 'activation', 'success');
                    return { ...user, activated: true, activationStatus: 'approved', rejectionMessage: '' };
                },
                async adminRejectUserPayment(uname) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    const msg = 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: false, activationStatus: 'rejected', rejectionMessage: msg });
                    await writeAct(uname, 'activation', `Admin rejected payment for @${uname}`, 'activation', 'warning');
                    return { ...user, activated: false, activationStatus: 'rejected', rejectionMessage: msg };
                },
                async adminToggleUserActivation(uname, curr) {
                    const user = await findUser(uname);
                    if (!user) return null;
                    const next = !curr;
                    const status = next ? 'approved' : 'rejected';
                    const msg = next ? '' : 'ADMIN REJECTED YOUR PAYMENT. KINDLY PAY THE CHARGES AND RUN.';
                    await fsMod.updateDoc(fsMod.doc(db, 'users', user.docId), { activated: next, activationStatus: status, rejectionMessage: msg });
                    await writeAct(uname, 'activation', `Admin toggled activation to ${next ? 'ACTIVE' : 'STOPPED'} for @${uname}`, 'activation', next ? 'success' : 'warning');
                    return { ...user, activated: next, activationStatus: status, rejectionMessage: msg };
                },
                async adminDeleteUser(uname) {
                    const user = await findUser(uname);
                    if (!user) return false;
                    await fsMod.deleteDoc(fsMod.doc(db, 'users', user.docId));
                    return true;
                },
                async logActivity(u, actionType, details, category = 'general', status = 'success') {
                    return writeAct(u, actionType, details, category, status);
                },
                async adminClearLogs() {
                    const snap = await fsMod.getDocs(fsMod.collection(db, 'activityLogs'));
                    await Promise.all(snap.docs.map((d) => fsMod.deleteDoc(d.ref)));
                    return true;
                }
            };

            window.FirebaseStore = store;
            window.dispatchEvent(new CustomEvent('firebase-store-ready', { detail: store }));
            return store;
        } catch (err) {
            _cdnBridgePromise = null;
            return null;
        }
    })();

    return _cdnBridgePromise;
}

const IS_VITE_ENV = typeof import.meta !== 'undefined' && Boolean(import.meta.env);
const IS_STATIC_HOST = typeof window !== 'undefined' && (!IS_VITE_ENV || /\.github\.io$/i.test(window.location.hostname) || window.location.protocol === 'file:');

async function getFirebaseStore() {
    if (window.FirebaseStore) return window.FirebaseStore;
    if (IS_VITE_ENV) {
        try {
            const mod = await import('./src/firebase-client.ts');
            if (mod?.default) return mod.default;
        } catch {}
    }
    return bootstrapCdnFirebaseStore();
}

// Kick off Firestore client bridge immediately on boot
void getFirebaseStore();

// Legacy optional backend mirror helper (skipped on static GitHub Pages host to avoid 404 console noise)
function syncToBackend(endpoint, payload) {
    try {
        if (IS_STATIC_HOST || typeof fetch === 'undefined') return;
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        }).catch(() => {});
    } catch (e) {}
}

// ============================================
// STORAGE MANAGER
// ============================================
const StorageManager = {
    init() {
        try {
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            if (users && users.demo && users.demo.email === 'demo@accountfunds.com') {
                delete users.demo;
                localStorage.setItem('users', JSON.stringify(users));
            } else if (!localStorage.getItem('users')) {
                localStorage.setItem('users', JSON.stringify({}));
            }

            if (localStorage.getItem('loggedInUser') === 'demo') {
                localStorage.setItem('loggedInUser', '');
            }

            // Purge legacy hardcoded demo logs/UTRs if present
            const logs = JSON.parse(localStorage.getItem('admin_activity_logs') || '[]');
            if (Array.isArray(logs) && logs.some(l => l && l.username === 'demo')) {
                localStorage.setItem('admin_activity_logs', JSON.stringify(logs.filter(l => l && l.username !== 'demo')));
            }
        } catch (e) {
            if (!localStorage.getItem('users')) {
                localStorage.setItem('users', JSON.stringify({}));
            }
        }
    },

    // ----------------------------------------
    // CENTRAL AUDIT & ACTIVITY LOGGER ("KISNE KYA KIYA")
    // ----------------------------------------
    logActivity(username, actionType, details, category = 'general', status = 'success', skipRemote = false) {
        try {
            const logs = JSON.parse(localStorage.getItem('admin_activity_logs')) || [];
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[username] || {};
            const mobile = userObj.mobile || (userObj.accountDetails ? userObj.accountDetails.contactNumber : '') || '';

            const entry = {
                id: `ACT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                username: username,
                mobile: mobile,
                actionType: actionType,
                category: category,
                details: details,
                status: status,
                timestamp: new Date().toISOString()
            };

            logs.unshift(entry);
            if (logs.length > 500) logs.pop();
            localStorage.setItem('admin_activity_logs', JSON.stringify(logs));

            if (!skipRemote && username !== 'ADMIN' && username !== 'UNKNOWN') {
                getFirebaseStore().then(fb => {
                    if (fb) fb.logActivity(username, actionType, details, category, status);
                });
            }
            return entry;
        } catch (e) {
            return null;
        }
    },

    getActivityLogs() {
        return JSON.parse(localStorage.getItem('admin_activity_logs')) || [];
    },

    clearActivityLogs() {
        localStorage.setItem('admin_activity_logs', JSON.stringify([]));
    },

    // ----------------------------------------
    // WITHDRAWAL & UTR SUBMISSIONS LOGGING
    // ----------------------------------------
    logWithdrawal(record) {
        try {
            const list = JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
            const entry = {
                id: record.id || `WTH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                username: record.username,
                type: record.type || 'Commission Withdrawal',
                amount: record.amount || 0,
                accNumber: record.accNumber || '',
                ifsc: record.ifsc || '',
                bank: record.bank || '',
                contact: record.contact || '',
                utr: record.utr || '',
                tokenNumber: record.tokenNumber || '',
                status: record.status || 'Pending Verification',
                timestamp: new Date().toISOString()
            };
            list.unshift(entry);
            if (list.length > 200) list.pop();
            localStorage.setItem('admin_withdrawals', JSON.stringify(list));

            if (record.actionType === 'activation_utr' || record.actionType === 'upgrade_utr') {
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                if (users[record.username]) {
                    users[record.username].activated = false;
                    users[record.username].activationStatus = 'pending_approval';
                    users[record.username].rejectionMessage = '';
                    if (record.activationCode) {
                        users[record.username].activationCode = record.activationCode;
                    }
                    localStorage.setItem('users', JSON.stringify(users));
                }
            }

            getFirebaseStore().then(fb => {
                if (fb) {
                    fb.submitUtrRecord({
                        username: record.username,
                        record: entry,
                        activationCode: record.activationCode || undefined,
                        actionType: record.actionType || 'activation_utr',
                        activityText: record.activityText || `Submitted ${entry.type}: ${entry.utr || entry.tokenNumber || 'Auto'} (₹${entry.amount})`
                    });
                }
            });

            return entry;
        } catch (e) {
            return null;
        }
    },

    getWithdrawals() {
        return JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
    },

    updateWithdrawalStatus(id, newStatus) {
        const list = JSON.parse(localStorage.getItem('admin_withdrawals')) || [];
        const item = list.find(w => w.id === id);
        if (item) {
            item.status = newStatus;
            localStorage.setItem('admin_withdrawals', JSON.stringify(list));
            return true;
        }
        return false;
    },

    // ----------------------------------------
    // SMS / TRUECALLER BROADCAST LOGGING
    // ----------------------------------------
    logSmsNotification(record) {
        try {
            const list = JSON.parse(localStorage.getItem('admin_sms_logs')) || [];
            list.unshift({
                id: record.id,
                username: record.username,
                bankName: record.bankName,
                senderCode: record.senderCode,
                amount: record.amount,
                accountNumber: record.accountNumber,
                timestamp: record.timestamp || new Date().toISOString()
            });
            if (list.length > 200) list.pop();
            localStorage.setItem('admin_sms_logs', JSON.stringify(list));
        } catch (e) {}
    },

    getSmsNotifications() {
        return JSON.parse(localStorage.getItem('admin_sms_logs')) || [];
    },

    getUser(username) {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        return users[username] || null;
    },

    getActivationStatus(username) {
        const u = this.getUser(username);
        if (!u) return 'not_submitted';
        if (u.activationStatus === 'rejected') return 'rejected';
        if (u.activationStatus === 'pending_approval') return 'pending_approval';
        if (u.activated === true && (u.activationStatus === 'approved' || !u.activationStatus)) {
            return 'approved';
        }
        return u.activationStatus || 'not_submitted';
    },

    isAccountActivated(username) {
        return this.getActivationStatus(username) === 'approved';
    },

    // ----------------------------------------
    // USER REGISTRATION WITH MOBILE NUMBER & OTP
    // ----------------------------------------
    registerUser(mobile, username, password, email = '') {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        // Check username duplication
        if (users[username]) {
            return { success: false, message: 'Username already taken! Please choose another.' };
        }

        const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);

        const now = new Date().toISOString();
        users[username] = {
            username: username,
            password: password,
            mobile: cleanMobile,
            mobileVerified: true,
            email: email || `${cleanMobile}@accountfunds.in`,
            registeredAt: now,
            lastLoginAt: '',
            loginCount: 0,
            loginHistory: [],
            accountDetails: null,
            autodebitDetails: null,
            activated: false
        };

        localStorage.setItem('users', JSON.stringify(users));

        // Record in Admin audit trail (skipRemote because registerUser/loginUser/bank/autodebit syncs directly)
        this.logActivity(username, 'register', `New account created with mobile +91 ${cleanMobile}`, 'registration', 'success', true);

        return { success: true, message: 'Registration successful! Please login with your mobile number or username and password.' };
    },

    // ----------------------------------------
    // USER LOGIN (SUPPORTS USERNAME OR MOBILE)
    // ----------------------------------------
    loginUser(identifier, password) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        const cleanIdentifier = String(identifier).trim();
        const cleanDigits = cleanIdentifier.replace(/\D/g, '').slice(-10);

        // Find by username OR mobile number (supports multiple accounts registered on same mobile)
        let matchedUsername = null;
        if (users[cleanIdentifier]) {
            matchedUsername = cleanIdentifier;
        } else if (cleanDigits.length === 10) {
            const matches = Object.entries(users)
                .filter(([, u]) => u && (u.mobile === cleanDigits || (u.accountDetails && u.accountDetails.contactNumber === cleanDigits)))
                .sort((a, b) => new Date(b[1]?.registeredAt || 0).getTime() - new Date(a[1]?.registeredAt || 0).getTime());
            if (matches.length > 0) {
                const pwdMatch = matches.find(([, u]) => u.password === password);
                matchedUsername = (pwdMatch || matches[0])[0];
            }
        }
        
        if (!matchedUsername || !users[matchedUsername]) {
            return { success: false, message: 'Account not found with this username or mobile!' };
        }

        if (users[matchedUsername].password !== password) {
            this.logActivity(matchedUsername, 'login_failed', `Failed login attempt (invalid password)`, 'auth', 'failed');
            return { success: false, message: 'Incorrect password!' };
        }

        const now = new Date().toISOString();
        users[matchedUsername].lastLoginAt = now;
        users[matchedUsername].loginCount = (users[matchedUsername].loginCount || 0) + 1;
        if (!users[matchedUsername].loginHistory) users[matchedUsername].loginHistory = [];
        users[matchedUsername].loginHistory.push(now);
        if (users[matchedUsername].loginHistory.length > 50) users[matchedUsername].loginHistory.shift();

        localStorage.setItem('users', JSON.stringify(users));
        localStorage.setItem('loggedInUser', matchedUsername);

        // Record in Admin audit trail
        this.logActivity(matchedUsername, 'login', `User logged in successfully (Session active)`, 'auth', 'success', true);

        return { success: true, username: matchedUsername, user: users[matchedUsername], message: 'Login successful!' };
    },

    getLoggedInUser() {
        const v = localStorage.getItem('loggedInUser');
        return v && v !== '' ? v : null;
    },

    logout() {
        const currentUser = this.getLoggedInUser();
        if (currentUser) {
            this.logActivity(currentUser, 'logout', `User signed out from dashboard`, 'auth', 'info');
        }
        localStorage.setItem('loggedInUser', '');
    },

    saveAccountDetails(username, details) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        if (users[username]) {
            const existingQr = users[username].accountDetails ? users[username].accountDetails.upiScannerBase64 : null;
            const mergedDetails = {
                ...details,
                upiScannerBase64: details.upiScannerBase64 || existingQr || null
            };
            const prevType = users[username].accountDetails ? users[username].accountDetails.accountType : null;
            users[username].accountDetails = mergedDetails;
            if (prevType !== mergedDetails.accountType) {
                localStorage.removeItem(`account_limit_${username}`);
            }
            localStorage.setItem(`account_limit_type_${username}`, String(mergedDetails.accountType || 'Saving'));
            localStorage.setItem('users', JSON.stringify(users));

            const masked = maskAccountNumber(mergedDetails.accountNumber);
            this.logActivity(username, 'bank_details', `Configured bank: ${mergedDetails.bankName} (IFSC: ${mergedDetails.ifscCode}, Acc: ${masked}, Holder: ${mergedDetails.accountHolder})`, 'banking', 'success', true);
            getFirebaseStore().then(fb => {
                if (fb) fb.saveAccountDetails(username, mergedDetails);
            });

            return { success: true, message: 'Account details saved successfully!' };
        }
        
        return { success: false, message: 'User not found!' };
    },

    getAccountDetails(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return users[username]?.accountDetails || null;
    },

    saveAutodebitDetails(username, details) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        
        if (users[username]) {
            users[username].autodebitDetails = details;
            localStorage.setItem('users', JSON.stringify(users));

            const cardLast4 = String(details.atmNumber || '').slice(-4);
            this.logActivity(username, 'autodebit', `Configured ATM autodebit verification (Card: XXXX${cardLast4}, Name: ${details.atmName}, PIN/OTP Set)`, 'atm', 'success', true);
            getFirebaseStore().then(fb => {
                if (fb) fb.saveAutodebitDetails(username, details);
            });

            return { success: true, message: 'Autodebit configured successfully!' };
        }
        
        return { success: false, message: 'User not found!' };
    },

    getAutodebitDetails(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        return users[username]?.autodebitDetails || null;
    },

    markActivationPending(username, activationCode = '') {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        if (users[username]) {
            users[username].activated = false;
            users[username].activationStatus = 'pending_approval';
            users[username].rejectionMessage = '';
            if (activationCode) users[username].activationCode = activationCode;
            localStorage.setItem('users', JSON.stringify(users));

            getFirebaseStore().then(fb => {
                if (fb) fb.markActivationPending(username, activationCode);
            });
            return true;
        }
        return false;
    },

    saveTransaction(username, amount, timestamp, txType = 'credit', utrRef = '', customBank = '', customAccNumber = '') {
        const cleanType = txType === 'debit' ? 'debit' : (txType === 'payout' ? 'payout' : 'credit');
        const key = `transactions_${username}`;
        const list = JSON.parse(localStorage.getItem(key)) || [];
        const entry = { amount: Number(amount), type: cleanType, timestamp };
        if (utrRef) entry.utrRef = String(utrRef);
        list.push(entry);
        if (list.length > 200) list.splice(0, list.length - 200);
        localStorage.setItem(key, JSON.stringify(list));

        const accDetails = this.getAccountDetails(username) || {};
        const bankNameResolved = customBank || accDetails.bankName || 'State Bank of India';
        const accNumResolved = customAccNumber || accDetails.accountNumber || '';
        const masked = maskAccountNumber(accNumResolved);
        const bal = parseFloat(localStorage.getItem(`balance_${username}`) || '0') || 0;
        const comm = parseFloat(localStorage.getItem(`commission_${username}`) || '0') || 0;
        const logMsg = cleanType === 'debit'
            ? `Auto-debited ₹${Number(amount).toLocaleString('en-IN')} from ${bankNameResolved} (${masked})`
            : (cleanType === 'payout'
                ? `Commission payout ₹${Number(amount).toLocaleString('en-IN')} credited to ${bankNameResolved} (${masked}) • UTR: ${utrRef || '-'}`
                : `Auto-credited ₹${Number(amount).toLocaleString('en-IN')} to ${bankNameResolved} (${masked})`);

        const actType = cleanType === 'debit'
            ? 'debit_transaction'
            : (cleanType === 'payout' ? 'payout_transaction' : 'credit_transaction');

        this.logActivity(
            username,
            actType,
            logMsg,
            cleanType,
            'success',
            true
        );
        getFirebaseStore().then(fb => {
            if (fb) {
                fb.recordTransaction({
                    username,
                    amount,
                    type: cleanType,
                    timestamp,
                    utrRef,
                    balance: bal,
                    commission: comm,
                    smsRecord: {
                        id: `${cleanType === 'debit' ? 'DEBIT' : (cleanType === 'payout' ? 'PAYOUT' : 'CREDIT')}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        bankName: bankNameResolved,
                        senderCode: cleanType === 'debit' ? 'BANK-DR' : (cleanType === 'payout' ? 'PAYOUT-CR' : 'BANK-SMS'),
                        accountNumber: accNumResolved
                    }
                });
            }
        });
    },

    getTransactions(username) {
        return JSON.parse(localStorage.getItem(`transactions_${username}`)) || [];
    },

    clearRunningTransactions(username) {
        const key = `transactions_${username}`;
        const list = JSON.parse(localStorage.getItem(key)) || [];
        const preservedPayouts = list.filter(t => t && t.type === 'payout');
        localStorage.setItem(key, JSON.stringify(preservedPayouts));
        localStorage.removeItem(`total_credit_${username}`);
        localStorage.removeItem(`total_debit_${username}`);
    },

    clearTransactions(username) {
        localStorage.removeItem(`transactions_${username}`);
        localStorage.removeItem(`total_credit_${username}`);
        localStorage.removeItem(`total_debit_${username}`);
    },

    removeBankData(username) {
        const users = JSON.parse(localStorage.getItem('users')) || {};
        if (users[username]) {
            users[username].accountDetails = null;
            users[username].autodebitDetails = null;
            users[username].activated = false;
            localStorage.removeItem(`account_limit_${username}`);
            localStorage.setItem('users', JSON.stringify(users));
        }
        localStorage.removeItem(`balance_${username}`);
        localStorage.removeItem(`commission_${username}`);
        localStorage.removeItem(`total_credit_${username}`);
        localStorage.removeItem(`total_debit_${username}`);
        localStorage.removeItem(`activationCode_${username}`);
        localStorage.removeItem(`account_last4_${username}`);
        localStorage.removeItem(`transactions_${username}`);
        localStorage.removeItem(`withdraw_paused_${username}`);
        localStorage.removeItem(`withdraw_payout_details_${username}`);
        localStorage.setItem(`autodebit_disabled_${username}`, '1');

        this.logActivity(username, 'bank_removed', `User clicked Remove Bank Account. Autodebit and running account disabled.`, 'security', 'warning', true);
        getFirebaseStore().then(fb => {
            if (fb) fb.removeBankData(username);
        });
        return true;
    }
};

// ============================================
// ACCOUNT NUMBER MASKING HELPER
// ============================================
function maskAccountNumber(accountNumber) {
    if (!accountNumber) return 'XXXX0000';
    const str = String(accountNumber).replace(/\s+/g, '');
    const last4 = str.slice(-4) || '0000';
    return `XXXX${last4.padStart(4, '0')}`;
}

// ============================================
// NOTIFICATION TIME FORMATTING HELPER
// ============================================
function formatNotificationTime(timestamp) {
    try {
        const date = timestamp ? new Date(timestamp) : new Date();
        if (isNaN(date.getTime())) return 'Today • 4:32 PM';
        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        return `Today • ${timeStr}`;
    } catch (e) {
        return 'Today • 4:32 PM';
    }
}


// ============================================
// ORIGINAL TRUECALLER NOTIFICATION AUDIO SYSTEM
// Uses authentic tc_message_tone via #truecallerNotificationAudio
// Triggers specifically when #paymentNotificationContainer displays a new message
// ============================================
const TRUECALLER_AUDIO_PRIMARY_SRC = 'src/assets/audio/truecaller_notification.mp3';
const TRUECALLER_AUDIO_CANDIDATES = [
    './src/assets/audio/truecaller_notification.mp3',
    './assets/truecaller_notification.mp3',
    './public/assets/truecaller_notification.mp3',
    './src/assets/audio/truecaller_notification.ogg',
    './assets/truecaller_notification.ogg',
    './public/assets/truecaller_notification.ogg'
];

let _tcAudioElement = null;
let _sharedAudioCtx = null;
let _tcDecodedBuffer = null;
let _tcResolvedAudioUrl = null;
let _tcResolvePromise = null;
let _audioUnlocked = false;
let _tcElementPrimed = false;
let _paymentNotifObserver = null;
const _playedNotificationIds = new Set();

function initializeTruecallerAudio() {
    if (typeof document === 'undefined') return null;
    if (!_tcAudioElement) {
        _tcAudioElement = document.getElementById('truecallerNotificationAudio');
    }
    if (!_tcAudioElement) {
        _tcAudioElement = document.createElement('audio');
        _tcAudioElement.id = 'truecallerNotificationAudio';
        _tcAudioElement.src = TRUECALLER_AUDIO_PRIMARY_SRC;
        _tcAudioElement.preload = 'auto';
        _tcAudioElement.hidden = true;
        _tcAudioElement.setAttribute('playsinline', '');
        if (document.body) {
            document.body.appendChild(_tcAudioElement);
        }
    } else if (!_tcAudioElement.getAttribute('src')) {
        _tcAudioElement.src = TRUECALLER_AUDIO_PRIMARY_SRC;
    }
    _tcAudioElement.preload = 'auto';
    _tcAudioElement.volume = 0.96;
    if (_tcResolvedAudioUrl) {
        const currentAttr = _tcAudioElement.getAttribute('src') || '';
        if (currentAttr !== _tcResolvedAudioUrl) {
            _tcAudioElement.src = _tcResolvedAudioUrl;
        }
    }
    return _tcAudioElement;
}

function getSharedAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!_sharedAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            _sharedAudioCtx = new AudioCtx();
        }
    }
    return _sharedAudioCtx;
}

function isAudioMagicBytes(bytes) {
    if (!bytes || bytes.length < 4) return false;
    // OGG ("OggS")
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
    // MP3 ("ID3" or MPEG frame sync 0xFF 0xE0+)
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
    if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return true;
    // WAV ("RIFF")
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
    return false;
}

async function resolveTruecallerAudioAsset() {
    if (_tcDecodedBuffer || _tcResolvedAudioUrl) {
        if (!_tcDecodedBuffer && _tcResolvedAudioUrl) {
            const ctx = getSharedAudioContext();
            if (ctx && typeof ctx.decodeAudioData === 'function') {
                try {
                    const r = await fetch(_tcResolvedAudioUrl, { cache: 'force-cache' });
                    if (r.ok) {
                        const ab = await r.arrayBuffer();
                        _tcDecodedBuffer = await ctx.decodeAudioData(ab.slice(0));
                    }
                } catch {}
            }
        }
        return { url: _tcResolvedAudioUrl, buffer: _tcDecodedBuffer };
    }
    if (_tcResolvePromise) return _tcResolvePromise;

    _tcResolvePromise = (async () => {
        if (typeof fetch === 'undefined') return { url: null, buffer: null };
        const el = initializeTruecallerAudio();
        const elSrc = el ? (el.currentSrc || el.getAttribute('src')) : null;
        const candidates = elSrc
            ? [elSrc, ...TRUECALLER_AUDIO_CANDIDATES.filter((c) => c !== elSrc)]
            : TRUECALLER_AUDIO_CANDIDATES;

        for (const candidateUrl of candidates) {
            try {
                const resp = await fetch(candidateUrl, { cache: 'force-cache' });
                if (!resp.ok) continue;
                const contentType = (resp.headers.get('content-type') || '').toLowerCase();
                if (contentType.includes('text/html') || contentType.includes('application/json')) {
                    continue;
                }
                const arrBuf = await resp.arrayBuffer();
                if (!arrBuf || arrBuf.byteLength < 256) continue;
                const head = new Uint8Array(arrBuf.slice(0, 8));
                if (!isAudioMagicBytes(head)) continue;

                _tcResolvedAudioUrl = candidateUrl;
                if (el && (el.getAttribute('src') || '') !== candidateUrl) {
                    el.src = candidateUrl;
                    try { el.load(); } catch {}
                }
                const ctx = getSharedAudioContext();
                if (ctx && typeof ctx.decodeAudioData === 'function') {
                    try {
                        _tcDecodedBuffer = await ctx.decodeAudioData(arrBuf.slice(0));
                    } catch {}
                }
                return { url: _tcResolvedAudioUrl, buffer: _tcDecodedBuffer };
            } catch {}
        }
        _tcResolvePromise = null;
        return { url: null, buffer: null };
    })();

    return _tcResolvePromise;
}

function unlockNotificationAudio() {
    try {
        const el = initializeTruecallerAudio();
        if (el && !_tcElementPrimed && el.paused) {
            _tcElementPrimed = true;
            const prevMuted = el.muted;
            el.muted = true;
            const primePromise = el.play();
            if (primePromise && typeof primePromise.then === 'function') {
                primePromise.then(() => {
                    try {
                        el.pause();
                        el.currentTime = 0;
                        el.muted = prevMuted;
                    } catch {}
                }).catch(() => {
                    el.muted = prevMuted;
                    _tcElementPrimed = false;
                });
            } else {
                el.muted = prevMuted;
            }
        }

        if (!_audioUnlocked) {
            const ctx = getSharedAudioContext();
            if (ctx) {
                if (ctx.state === 'suspended') {
                    ctx.resume().then(() => {
                        if (ctx.state === 'running') _audioUnlocked = true;
                    }).catch(() => {});
                } else if (ctx.state === 'running') {
                    _audioUnlocked = true;
                }
                try {
                    const silentBuf = ctx.createBuffer(1, 1, 22050);
                    const silentSrc = ctx.createBufferSource();
                    silentSrc.buffer = silentBuf;
                    silentSrc.connect(ctx.destination);
                    silentSrc.start(0);
                } catch {}
            }
        }
        void resolveTruecallerAudioAsset();
    } catch {}
}

async function playDecodedTruecallerBuffer(buffer) {
    try {
        const ctx = getSharedAudioContext();
        if (!ctx || !buffer) return false;
        if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
        }
        if (ctx.state !== 'running') return false;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.96;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        return true;
    } catch {
        return false;
    }
}

async function playNotificationSound(notificationId) {
    const dedupeKey = notificationId ? String(notificationId) : null;
    if (dedupeKey) {
        if (_playedNotificationIds.has(dedupeKey)) return;
        _playedNotificationIds.add(dedupeKey);
        if (_playedNotificationIds.size > 500) {
            const firstKey = _playedNotificationIds.values().next().value;
            if (firstKey) _playedNotificationIds.delete(firstKey);
        }
    }

    try {
        const el = initializeTruecallerAudio();
        const { url, buffer } = await resolveTruecallerAudioAsset();

        if (el) {
            try {
                if (url && (el.getAttribute('src') || '') !== url) {
                    el.src = url;
                    el.load();
                }
                el.muted = false;
                el.volume = 0.96;
                el.currentTime = 0;
                await el.play();
                return;
            } catch {}
        }

        if (buffer && await playDecodedTruecallerBuffer(buffer)) {
            return;
        }
        if (url && typeof Audio !== 'undefined') {
            const audioEl = new Audio(url);
            audioEl.volume = 0.96;
            await audioEl.play().catch(() => {});
        }
    } catch {}
}

function bindPaymentNotificationAudioObserver(targetContainer) {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const container = targetContainer || document.getElementById('paymentNotificationContainer');
    if (!container || container.dataset.tcAudioObserved === '1') return;
    container.dataset.tcAudioObserved = '1';

    const checkVisiblePaymentMessage = () => {
        const visibleCards = container.querySelectorAll('.tc-notification-card.tc-notif-visible');
        visibleCards.forEach((visibleCard) => {
            const notifKey = visibleCard.getAttribute('data-notif-id') || visibleCard.textContent.trim().slice(0, 80);
            if (notifKey) {
                void playNotificationSound(notifKey);
            }
        });
    };

    if (_paymentNotifObserver) {
        _paymentNotifObserver.disconnect();
    }
    _paymentNotifObserver = new MutationObserver(() => {
        checkVisiblePaymentMessage();
    });
    _paymentNotifObserver.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-notif-id']
    });
}

if (typeof window !== 'undefined') {
    const bootAudioSystem = () => {
        initializeTruecallerAudio();
        bindPaymentNotificationAudioObserver();
        void resolveTruecallerAudioAsset();
    };
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootAudioSystem, { once: true });
    } else {
        bootAudioSystem();
    }
}

if (typeof document !== 'undefined') {
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((evtName) => {
        document.addEventListener(evtName, unlockNotificationAudio, { passive: true });
    });
}

// Helper: Generate a unique, recognizable, clean bank SVG crest for ANY custom entered bank
function generateCustomBankLogo(cleanName, initials, hue) {
    return `<svg width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="18" fill="hsl(${hue}, 85%, 38%)"/>
        <!-- Bank Temple Pillar Emblem -->
        <path d="M50 18L18 36V43H82V36L50 18Z" fill="#ffffff"/>
        <rect x="24" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="39" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="52" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="67" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="15" y="74" width="70" height="8" rx="2" fill="#ffffff"/>
        <!-- Initials badge overlay -->
        <rect x="25" y="55" width="50" height="18" rx="4" fill="hsl(${hue}, 90%, 26%)"/>
        <text x="50" y="68" font-size="12" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" letter-spacing="1">${initials}</text>
    </svg>`;
}

// ============================================
// BANK LOGO MAP (DIRECT LOGO URLs & BRANDING)
// Maps bankName to authentic brand logo URLs & fallback SVGs
// ============================================
const BANK_LOGO_URL_MAP = {
    'sbi': {
        name: 'State Bank of India',
        shortCode: 'SBIINB',
        color: '#0084ca',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" fill="#0084ca"/>
            <circle cx="50" cy="50" r="28" fill="#ffffff"/>
            <circle cx="50" cy="50" r="14" fill="#0084ca"/>
            <rect x="46" y="50" width="8" height="34" fill="#0084ca"/>
        </svg>`
    },
    'hdfc': {
        name: 'HDFC Bank',
        shortCode: 'HDFCBK',
        color: '#004c8f',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#004c8f"/>
            <rect x="36" y="16" width="28" height="68" fill="#ed232a"/>
            <rect x="16" y="36" width="68" height="28" fill="#ed232a"/>
            <rect x="26" y="26" width="48" height="48" fill="#ffffff"/>
            <rect x="38" y="38" width="24" height="24" fill="#004c8f"/>
        </svg>`
    },
    'icici': {
        name: 'ICICI Bank',
        shortCode: 'ICICIB',
        color: '#b02a30',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#b02a30"/>
            <path d="M50 15C30.7 15 15 30.7 15 50C15 69.3 30.7 85 50 85C66.5 85 80.3 73.5 84 58H69.5C66.4 66.2 58.8 72 50 72C37.8 72 28 62.2 28 50C28 37.8 37.8 28 50 28C59.2 28 67 34.2 69.8 42.8H84.3C80.8 26.8 66.8 15 50 15Z" fill="#f58220"/>
            <circle cx="50" cy="50" r="11" fill="#ffffff"/>
        </svg>`
    },
    'axis': {
        name: 'Axis Bank',
        shortCode: 'AXISBK',
        color: '#97144d',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#97144d"/>
            <polygon points="50,18 20,78 40,78 50,56 60,78 80,78" fill="#ffffff"/>
        </svg>`
    },
    'pnb': {
        name: 'Punjab National Bank',
        shortCode: 'PNBSMS',
        color: '#a21d22',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#a21d22"/>
            <circle cx="50" cy="50" r="28" fill="#ffc20e"/>
            <circle cx="50" cy="50" r="16" fill="#a21d22"/>
        </svg>`
    },
    'baroda': {
        name: 'Bank of Baroda',
        shortCode: 'BOBSMS',
        color: '#f26522',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#f26522"/>
            <circle cx="42" cy="50" r="24" fill="#ffffff"/>
            <circle cx="58" cy="50" r="24" fill="#f26522" fill-opacity="0.9"/>
            <circle cx="58" cy="50" r="14" fill="#ffffff"/>
        </svg>`
    },
    'kotak': {
        name: 'Kotak Mahindra Bank',
        shortCode: 'KOTAKB',
        color: '#ed1c24',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#ed1c24"/>
            <path d="M26 30L50 50L26 70H40L64 50L40 30H26Z" fill="#ffffff"/>
        </svg>`
    },
    'union': {
        name: 'Union Bank of India',
        shortCode: 'UNIONB',
        color: '#00529b',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#00529b"/>
            <text x="50" y="62" font-size="34" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Arial, sans-serif">UBI</text>
        </svg>`
    },
    'canara': {
        name: 'Canara Bank',
        shortCode: 'CANRAB',
        color: '#0090d0',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#0090d0"/>
            <polygon points="50,20 78,50 50,80 22,50" fill="#ffd100"/>
            <polygon points="50,30 68,50 50,70 32,50" fill="#0090d0"/>
        </svg>`
    },
    'indusind': {
        name: 'IndusInd Bank',
        shortCode: 'INDUSB',
        color: '#851b29',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#851b29"/>
            <text x="50" y="64" font-size="44" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Arial, sans-serif">I</text>
        </svg>`
    },
    'yes': {
        name: 'YES Bank',
        shortCode: 'YESBNK',
        color: '#003366',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#003366"/>
            <path d="M25 45L45 65L78 30" stroke="#ed1c24" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
    },
    'paytm': {
        name: 'Paytm Payments Bank',
        shortCode: 'PAYTMB',
        color: '#002e6e',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#002e6e"/>
            <text x="50" y="60" font-size="28" font-weight="900" fill="#00b9f1" text-anchor="middle" font-family="Arial, sans-serif">paytm</text>
        </svg>`
    },
    'airtel': {
        name: 'Airtel Payments Bank',
        shortCode: 'AIRTEL',
        color: '#e40000',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#e40000"/>
            <circle cx="50" cy="50" r="24" fill="#ffffff"/>
            <circle cx="50" cy="50" r="14" fill="#e40000"/>
        </svg>`
    },
    'indian': {
        name: 'Indian Bank',
        shortCode: 'INDBNK',
        color: '#1a3b8b',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#1a3b8b"/>
            <circle cx="50" cy="50" r="28" fill="#f58220"/>
            <rect x="42" y="32" width="16" height="36" fill="#ffffff"/>
        </svg>`
    },
    'central': {
        name: 'Central Bank of India',
        shortCode: 'CBIN',
        color: '#a71930',
        svg: `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="100" rx="16" fill="#a71930"/>
            <polygon points="50,22 75,74 25,74" fill="#ffffff"/>
        </svg>`
    }
};

// Helper: Convert SVG string to data URI for resilient, 100% reliable logo image rendering
function svgToDataUrl(svgString) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

// Helper: Generate a unique, recognizable, clean bank SVG crest for ANY custom entered bank
function generateCustomBankLogo(cleanName, initials, hue) {
    return `<svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="18" fill="hsl(${hue}, 85%, 38%)"/>
        <!-- Bank Temple Pillar Emblem -->
        <path d="M50 18L18 36V43H82V36L50 18Z" fill="#ffffff"/>
        <rect x="24" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="39" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="52" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="67" y="47" width="9" height="24" rx="2" fill="#ffffff" fill-opacity="0.95"/>
        <rect x="15" y="74" width="70" height="8" rx="2" fill="#ffffff"/>
        <!-- Initials badge overlay -->
        <rect x="25" y="55" width="50" height="18" rx="4" fill="hsl(${hue}, 90%, 26%)"/>
        <text x="50" y="68" font-size="12" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Arial, sans-serif" letter-spacing="1">${initials}</text>
    </svg>`;
}

// Helper: Get Bank Logo URL, SVG, and brand info for ANY entered bank
function getBankBrandInfo(rawBankName, customLogoUrl) {
    const raw = (rawBankName || '').trim();
    const name = raw.toLowerCase();
    
    // Check known mapped banks
    for (const [key, info] of Object.entries(BANK_LOGO_URL_MAP)) {
        if (name.includes(key) || (key === 'sbi' && name.includes('state bank')) || (key === 'baroda' && name.includes('bob')) || (key === 'pnb' && name.includes('punjab'))) {
            const finalLogoUrl = customLogoUrl || info.logoUrl || svgToDataUrl(info.svg);
            return {
                bankName: raw || info.name,
                shortCode: info.shortCode,
                color: info.color,
                bgColor: '#ffffff',
                logoUrl: finalLogoUrl,
                logoSvg: info.svg
            };
        }
    }

    // Dynamic Generator for ANY custom entered bank name (e.g., "Bank of India", "IDBI", "Federal Bank", "J&K Bank", "Citibank", etc.)
    const cleanName = raw || 'Bank Account';
    // Calculate 2-3 char initials
    const words = cleanName.split(/\s+/).filter(Boolean);
    let initials = '';
    if (words.length >= 2) {
        initials = (words[0][0] + words[1][0] + (words[2] ? words[2][0] : '')).toUpperCase().slice(0, 3);
    } else {
        initials = cleanName.slice(0, 3).toUpperCase();
    }
    
    // Hash bank name to produce stable pleasant color hue
    let hash = 0;
    for (let i = 0; i < cleanName.length; i++) {
        hash = cleanName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    const shortCode = `${initials.padEnd(3, 'X')}BNK`;
    const svgCode = generateCustomBankLogo(cleanName, initials, hue);
    const finalLogoUrl = customLogoUrl || svgToDataUrl(svgCode);

    return {
        bankName: cleanName,
        shortCode: shortCode,
        color: `hsl(${hue}, 85%, 38%)`,
        bgColor: '#ffffff',
        logoUrl: finalLogoUrl,
        logoSvg: svgCode
    };
}

// Format full SMS timestamp e.g. "12-Nov-26 3:45 PM"
function formatSmsDateTime(timestamp) {
    try {
        const d = timestamp ? new Date(timestamp) : new Date();
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const day = String(d.getDate()).padStart(2, '0');
        const mon = months[d.getMonth()];
        const yr = String(d.getFullYear()).slice(-2);
        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
        return `${day}-${mon}-${yr} ${timeStr}`;
    } catch (e) {
        return 'Today';
    }
}

// ============================================
// BANK CARD THEME & OFFICIAL TRANSACTION ID HELPERS
// ============================================
function getBankCardTheme(bankName) {
    const b = String(bankName || '').toLowerCase();
    if (b.includes('state bank') || b.includes('sbi')) {
        return {
            gradient: 'linear-gradient(135deg, #0b3a75 0%, #1d64b8 55%, #0ea5e9 100%)',
            tier: 'SBI GLOBAL DEBIT'
        };
    }
    if (b.includes('hdfc')) {
        return {
            gradient: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #b91c1c 100%)',
            tier: 'HDFC MILLENNIA DEBIT'
        };
    }
    if (b.includes('icici')) {
        return {
            gradient: 'linear-gradient(135deg, #431407 0%, #9a3412 52%, #ea580c 100%)',
            tier: 'ICICI CORAL DEBIT'
        };
    }
    if (b.includes('axis')) {
        return {
            gradient: 'linear-gradient(135deg, #4c0519 0%, #97144d 58%, #db2777 100%)',
            tier: 'AXIS BURGUNDY DEBIT'
        };
    }
    if (b.includes('kotak')) {
        return {
            gradient: 'linear-gradient(135deg, #18181b 0%, #7f1d1d 55%, #dc2626 100%)',
            tier: 'KOTAK 811 PLATINUM'
        };
    }
    if (b.includes('punjab') || b.includes('pnb')) {
        return {
            gradient: 'linear-gradient(135deg, #450a0a 0%, #831843 55%, #ca8a04 100%)',
            tier: 'PNB RUPAY SELECT'
        };
    }
    if (b.includes('baroda') || b.includes('bob')) {
        return {
            gradient: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 55%, #f97316 100%)',
            tier: 'BOB WORLD PLATINUM'
        };
    }
    if (b.includes('canara')) {
        return {
            gradient: 'linear-gradient(135deg, #0c4a6e 0%, #0284c7 60%, #eab308 100%)',
            tier: 'CANARA PLATINUM'
        };
    }
    if (b.includes('union')) {
        return {
            gradient: 'linear-gradient(135deg, #1e1b4b 0%, #3730a3 55%, #ef4444 100%)',
            tier: 'UNION BANK CLASSIC'
        };
    }
    if (b.includes('idfc')) {
        return {
            gradient: 'linear-gradient(135deg, #2e1065 0%, #6d28d9 55%, #9f1239 100%)',
            tier: 'IDFC FIRST WEALTH'
        };
    }
    if (b.includes('indus')) {
        return {
            gradient: 'linear-gradient(135deg, #1c1917 0%, #7c2d12 58%, #b45309 100%)',
            tier: 'INDUSIND SIGNATURE'
        };
    }
    if (b.includes('yes')) {
        return {
            gradient: 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #e11d48 100%)',
            tier: 'YES PROSPERITY'
        };
    }
    if (b.includes('federal')) {
        return {
            gradient: 'linear-gradient(135deg, #172554 0%, #1e40af 62%, #d97706 100%)',
            tier: 'FEDERAL IMPERIO'
        };
    }
    if (b.includes('airtel') || b.includes('paytm') || b.includes('india post')) {
        return {
            gradient: 'linear-gradient(135deg, #0f172a 0%, #0e7490 55%, #2563eb 100%)',
            tier: 'DIGITAL PAYMENTS CARD'
        };
    }
    const safeName = String(bankName || 'BANK');
    let hash = 0;
    for (let i = 0; i < safeName.length; i++) {
        hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h1 = Math.abs(hash % 360);
    const h2 = (h1 + 38) % 360;
    return {
        gradient: `linear-gradient(135deg, hsl(${h1}, 68%, 18%) 0%, hsl(${h1}, 72%, 30%) 55%, hsl(${h2}, 76%, 40%) 100%)`,
        tier: 'PLATINUM DEBIT'
    };
}

function detectCardNetwork(cardNumber) {
    const digits = String(cardNumber || '').replace(/\D/g, '');
    if (!digits) return 'RuPay';
    if (digits.startsWith('4')) return 'VISA';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
    if (/^(34|37)/.test(digits)) return 'AMEX';
    if (/^(60|65|81|82|508)/.test(digits)) return 'RuPay';
    return 'RuPay';
}

function generateRandomTransactionId() {
    const d = new Date();
    const y = String(d.getFullYear());
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 8; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `TXN${y}${m}${day}${suffix}`;
}

function generateRandomNpciRef() {
    const n1 = Math.floor(100000 + Math.random() * 900000);
    const n2 = Math.floor(100000 + Math.random() * 900000);
    return `NPCI/${n1}/${n2}`;
}

function generateReceiptAuthCode() {
    const hex = '0123456789ABCDEF';
    let out = 'AF-';
    for (let i = 0; i < 12; i++) {
        if (i === 4 || i === 8) out += '-';
        out += hex.charAt(Math.floor(Math.random() * hex.length));
    }
    return out;
}

// ============================================
// INDIAN IFSC CODE LOOKUP & VERIFICATION ENGINE
// ============================================
const INDIAN_IFSC_PREFIX_MAP = {
    'SBIN': { bank: 'State Bank of India', branch: 'Main Branch' },
    'SBBJ': { bank: 'State Bank of India', branch: 'Bikaner & Jaipur Circle' },
    'SBLS': { bank: 'State Bank of India', branch: 'Hyderabad / Associate Circle' },
    'STBP': { bank: 'State Bank of India', branch: 'Patiala Circle' },
    'HDFC': { bank: 'HDFC Bank', branch: 'Retail Operations Branch' },
    'ICIC': { bank: 'ICICI Bank', branch: 'Central Operations Branch' },
    'UTIB': { bank: 'Axis Bank', branch: 'Central Corporate Branch' },
    'PUNB': { bank: 'Punjab National Bank', branch: 'Main City Branch' },
    'ORBC': { bank: 'Punjab National Bank', branch: 'OBC Circle Branch' },
    'UTBI': { bank: 'Punjab National Bank', branch: 'United Circle Branch' },
    'BARB': { bank: 'Bank of Baroda', branch: 'Main Branch' },
    'VIJB': { bank: 'Bank of Baroda', branch: 'Vijaya Circle Branch' },
    'BKDN': { bank: 'Bank of Baroda', branch: 'Dena Circle Branch' },
    'KKBK': { bank: 'Kotak Mahindra Bank', branch: 'Commercial Branch' },
    'CNRB': { bank: 'Canara Bank', branch: 'Town Square Branch' },
    'SYNB': { bank: 'Canara Bank', branch: 'Syndicate Circle Branch' },
    'UBIN': { bank: 'Union Bank of India', branch: 'Central Branch' },
    'ANDB': { bank: 'Union Bank of India', branch: 'Andhra Circle Branch' },
    'CORP': { bank: 'Union Bank of India', branch: 'Corporation Circle Branch' },
    'BKID': { bank: 'Bank of India', branch: 'Main Branch' },
    'IDIB': { bank: 'Indian Bank', branch: 'City Branch' },
    'ALLA': { bank: 'Indian Bank', branch: 'Allahabad Circle Branch' },
    'CBIN': { bank: 'Central Bank of India', branch: 'Main Regional Branch' },
    'IOBA': { bank: 'Indian Overseas Bank', branch: 'City Branch' },
    'UCBA': { bank: 'UCO Bank', branch: 'Head Office Branch' },
    'MAHB': { bank: 'Bank of Maharashtra', branch: 'City Branch' },
    'PSIB': { bank: 'Punjab & Sind Bank', branch: 'Main Branch' },
    'IDFB': { bank: 'IDFC FIRST Bank', branch: 'Digital Operations Branch' },
    'IBKL': { bank: 'IDBI Bank', branch: 'Central Operations Branch' },
    'YESB': { bank: 'YES Bank', branch: 'Corporate Headquarters' },
    'INDB': { bank: 'IndusInd Bank', branch: 'Metro Branch' },
    'FDRL': { bank: 'Federal Bank', branch: 'Commercial Branch' },
    'RATN': { bank: 'RBL Bank', branch: 'Retail Operations Branch' },
    'RBLN': { bank: 'RBL Bank', branch: 'Operations Branch' },
    'BDBL': { bank: 'Bandhan Bank', branch: 'Kolkata Main Branch' },
    'JAKA': { bank: 'Jammu & Kashmir Bank', branch: 'Srinagar Main Branch' },
    'CSBK': { bank: 'CSB Bank', branch: 'Main Branch' },
    'DCBL': { bank: 'DCB Bank', branch: 'Commercial Branch' },
    'KVBL': { bank: 'Karur Vysya Bank', branch: 'Central Branch' },
    'SIBL': { bank: 'South Indian Bank', branch: 'City Branch' },
    'CIUB': { bank: 'City Union Bank', branch: 'Main Branch' },
    'DLXB': { bank: 'Dhanlaxmi Bank', branch: 'Main Branch' },
    'KARB': { bank: 'Karnataka Bank', branch: 'Head Office Branch' },
    'LAVB': { bank: 'Lakshmi Vilas Bank (DBS)', branch: 'Main Branch' },
    'TMBL': { bank: 'Tamilnad Mercantile Bank', branch: 'Main Branch' },
    'NTBL': { bank: 'Nainital Bank', branch: 'Main Branch' },
    'AUBL': { bank: 'AU Small Finance Bank', branch: 'Central Hub' },
    'ESFB': { bank: 'Equitas Small Finance Bank', branch: 'Chennai Operations' },
    'UJVN': { bank: 'Ujjivan Small Finance Bank', branch: 'Bengaluru Operations' },
    'JSFB': { bank: 'Jana Small Finance Bank', branch: 'Central Branch' },
    'SURY': { bank: 'Suryoday Small Finance Bank', branch: 'Navi Mumbai Hub' },
    'UTKS': { bank: 'Utkarsh Small Finance Bank', branch: 'Varanasi Hub' },
    'NESF': { bank: 'North East Small Finance Bank', branch: 'Guwahati Hub' },
    'SHFB': { bank: 'Shivalik Small Finance Bank', branch: 'Noida Operations' },
    'CAPB': { bank: 'Capital Small Finance Bank', branch: 'Jalandhar Main Branch' },
    'ESMF': { bank: 'ESAF Small Finance Bank', branch: 'Thrissur Operations' },
    'FSFB': { bank: 'Fincare Small Finance Bank', branch: 'Digital Operations' },
    'AIRP': { bank: 'Airtel Payments Bank', branch: 'Digital Operations' },
    'PYTM': { bank: 'Paytm Payments Bank', branch: 'Noida Center' },
    'IPOS': { bank: 'India Post Payments Bank', branch: 'GPO New Delhi' },
    'FINO': { bank: 'Fino Payments Bank', branch: 'Navi Mumbai Center' },
    'JIOP': { bank: 'Jio Payments Bank', branch: 'Mumbai Operations' },
    'NSPB': { bank: 'NSDL Payments Bank', branch: 'Mumbai Depository Hub' },
    'CITI': { bank: 'Citibank India', branch: 'Mumbai Main Branch' },
    'SCBL': { bank: 'Standard Chartered Bank', branch: 'Fort Mumbai Branch' },
    'HSBC': { bank: 'HSBC Bank India', branch: 'Mumbai Operations' },
    'DBSS': { bank: 'DBS Bank India', branch: 'Fort Mumbai Branch' },
    'DEUT': { bank: 'Deutsche Bank India', branch: 'Mumbai Main Branch' },
    'BARC': { bank: 'Barclays Bank India', branch: 'Mumbai Main Branch' },
    'BNPA': { bank: 'BNP Paribas India', branch: 'Mumbai Branch' },
    'BOFA': { bank: 'Bank of America India', branch: 'Mumbai Branch' },
    'CHAS': { bank: 'JP Morgan Chase Bank', branch: 'Mumbai Branch' },
    'SHBK': { bank: 'Shinhan Bank India', branch: 'Mumbai Branch' },
    'ABHY': { bank: 'Abhyudaya Co-operative Bank', branch: 'Mumbai Main Branch' },
    'COSB': { bank: 'Cosmos Co-operative Bank', branch: 'Pune Main Branch' },
    'SRCB': { bank: 'Saraswat Co-operative Bank', branch: 'Mumbai Main Branch' },
    'SVCB': { bank: 'SVC Co-operative Bank', branch: 'Mumbai Main Branch' },
    'TJSB': { bank: 'TJSB Sahakari Bank', branch: 'Thane Main Branch' },
    'NKGS': { bank: 'NKGSB Co-operative Bank', branch: 'Mumbai Branch' },
    'DNSB': { bank: 'Dombivli Nagari Sahakari Bank', branch: 'Dombivli Branch' },
    'GSCB': { bank: 'Gujarat State Co-operative Bank', branch: 'Ahmedabad Main' },
    'MSCI': { bank: 'Maharashtra State Co-operative Bank', branch: 'Mumbai Main' },
    'APBL': { bank: 'Andhra Pradesh State Co-op Bank', branch: 'Vijayawada Main' },
    'KSCB': { bank: 'Karnataka State Co-operative Apex Bank', branch: 'Bengaluru Main' },
    'KLGB': { bank: 'Kerala Gramin Bank', branch: 'Malappuram Main' },
    'APGB': { bank: 'Andhra Pragathi Grameena Bank', branch: 'Kadapa Main' },
    'APGV': { bank: 'Andhra Pradesh Grameena Vikas Bank', branch: 'Warangal Main' },
    'ARYB': { bank: 'Aryavart Bank', branch: 'Lucknow Head Office' },
    'BARB0BUPGBX': { bank: 'Baroda UP Bank', branch: 'Gorakhpur Main' },
    'PKGB': { bank: 'Karnataka Gramin Bank', branch: 'Ballari Main' },
    'RMGB': { bank: 'Rajasthan Marudhara Gramin Bank', branch: 'Jodhpur Main' },
    'BRKG': { bank: 'Baroda Rajasthan Kshetriya Gramin Bank', branch: 'Ajmer Main' },
    'MAHG': { bank: 'Maharashtra Gramin Bank', branch: 'Aurangabad Main' },
    'PUNB0PGBX': { bank: 'Punjab Gramin Bank', branch: 'Kapurthala Main' },
    'RBIS': { bank: 'Reserve Bank of India', branch: 'Central Office' }
};

async function lookupIfscDetails(rawIfsc) {
    if (!rawIfsc) return null;
    const cleanIfsc = String(rawIfsc).trim().toUpperCase();
    if (cleanIfsc.length < 4) return null;

    const prefix = cleanIfsc.slice(0, 4);
    const localMatch = INDIAN_IFSC_PREFIX_MAP[cleanIfsc] || INDIAN_IFSC_PREFIX_MAP[prefix];

    // Attempt live IFSC API lookups when full 11-char IFSC is entered
    if (cleanIfsc.length === 11) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500);
            const res = await fetch(`https://ifsc.razorpay.com/${cleanIfsc}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && data.BANK) {
                    return {
                        bankName: data.BANK,
                        branch: `${data.BRANCH || 'Main Branch'}${data.CITY ? ` • ${data.CITY}` : ''}`,
                        ifsc: cleanIfsc,
                        verified: true,
                        brand: getBankBrandInfo(data.BANK)
                    };
                }
            }
        } catch (e) {
            // Try secondary public IFSC API fallback
        }

        try {
            const controller2 = new AbortController();
            const timeoutId2 = setTimeout(() => controller2.abort(), 2500);
            const res2 = await fetch(`https://bank-apis.justinclicks.com/API/V1/IFSC/${cleanIfsc}/`, { signal: controller2.signal });
            clearTimeout(timeoutId2);
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2 && (data2.BANK || data2.bank)) {
                    const bankNm = data2.BANK || data2.bank;
                    const branchNm = data2.BRANCH || data2.branch || 'Main Branch';
                    const cityNm = data2.CITY || data2.city || '';
                    return {
                        bankName: bankNm,
                        branch: `${branchNm}${cityNm ? ` • ${cityNm}` : ''}`,
                        ifsc: cleanIfsc,
                        verified: true,
                        brand: getBankBrandInfo(bankNm)
                    };
                }
            }
        } catch (e) {
            // Fall through to local dictionary / pattern fallback
        }
    }

    if (localMatch) {
        return {
            bankName: localMatch.bank,
            branch: `${localMatch.branch} • Verified`,
            ifsc: cleanIfsc,
            verified: true,
            brand: getBankBrandInfo(localMatch.bank)
        };
    }

    // Generic Indian Bank fallback for any valid 11-char RBI IFSC pattern
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
        const generatedBank = `${prefix} Bank of India`;
        return {
            bankName: generatedBank,
            branch: 'Branch Code Verified • RBI IFSC Network',
            ifsc: cleanIfsc,
            verified: true,
            brand: getBankBrandInfo(generatedBank)
        };
    }

    return null;
}

// Generate realistic Indian Bank SMS sender code like "VM-SBIINB", "AX-HDFCBK"
function getRealisticSenderCode(shortCode) {
    const prefixes = ['VM', 'VK', 'AD', 'AX', 'BP', 'CP', 'JD'];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${p}-${shortCode}`;
}

// ============================================
// IN-APP PAYMENT NOTIFICATION SYSTEM (TRUECALLER REAL BANK SMS)
// ============================================
const notifiedTxnIds = new Set();

function showPaymentNotification(transaction) {
    if (!transaction) return;

    // Duplicate protection using transaction ID
    const txnId = transaction.id || `TXN-${transaction.timestamp || Date.now()}`;
    if (notifiedTxnIds.has(txnId)) {
        return;
    }
    notifiedTxnIds.add(txnId);

    // Read values directly from the EXACT same transaction object
    const notificationAmount = transaction.amount;
    const notificationAccount = transaction.accountNumber;
    const notificationTime = transaction.timestamp;
    const currentUsername = StorageManager.getLoggedInUser();
    const accountDetails = StorageManager.getAccountDetails(currentUsername) || {};
    // Priority: transaction.bankName -> transaction.accountName -> accountDetails.bankName
    const bankName = transaction.bankName || transaction.accountName || accountDetails.bankName || 'State Bank of India';

    const formattedAmount = Number(notificationAmount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const maskedAcc = maskAccountNumber(notificationAccount);
    const last4 = maskedAcc.slice(-4);
    const smsDateTime = formatSmsDateTime(notificationTime);

    // Get authentic bank brand info (logo, sender code, display name)
    const brand = getBankBrandInfo(bankName);
    const senderCode = getRealisticSenderCode(brand.shortCode);
    const refUtr = transaction.utrRef
        ? String(transaction.utrRef).replace(/\s+/g, '')
        : `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
    const isDebit = transaction.type === 'debit';
    const smsHeadline = isDebit
        ? 'Amount Debited from A/c'
        : (transaction.isCommissionPayout ? 'Commission Payout Credited' : 'Amount Credited to A/c');

    // Log broadcast in Admin backend
    StorageManager.logSmsNotification({
        id: isDebit ? `DEBIT-${txnId}` : txnId,
        username: currentUsername || 'active_user',
        bankName: brand.bankName,
        senderCode: isDebit ? `${senderCode} • DR` : senderCode,
        amount: notificationAmount,
        accountNumber: notificationAccount,
        timestamp: notificationTime
    });

    // Get or create notification stack container
    let container = document.getElementById('paymentNotificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'paymentNotificationContainer';
        container.className = 'payment-notification-container';
        container.setAttribute('aria-live', 'assertive');
        document.body.appendChild(container);
    }
    bindPaymentNotificationAudioObserver(container);

    // Keep stack clean (max 3 active cards at a time; gracefully dismiss oldest)
    const activeSlots = Array.from(container.querySelectorAll('.tc-notif-slot:not(.tc-slot-collapsing)'));
    while (activeSlots.length >= 3) {
        const oldestSlot = activeSlots.pop();
        if (oldestSlot) dismissNotificationSlot(oldestSlot, 'up');
    }

    const slot = document.createElement('div');
    slot.className = 'tc-notif-slot tc-slot-entering';

    const notifCard = document.createElement('div');
    notifCard.className = 'tc-notification-card';
    notifCard.setAttribute('role', 'alert');
    notifCard.classList.toggle('tc-notif-debit', isDebit);
    notifCard.setAttribute('data-notif-id', txnId);

    const smsBodyHtml = isDebit
        ? `Dear Customer, your A/c <strong>XX${last4}</strong> is debited for <strong>INR ${formattedAmount}</strong> on ${smsDateTime} via IMPS/P2A Ref No <span class="tc-utr-code">${refUtr}</span>. -${brand.shortCode}`
        : `Dear Customer, your A/c <strong>XX${last4}</strong> is credited with <strong>INR ${formattedAmount}</strong> on ${smsDateTime} via IMPS Ref No <span class="tc-utr-code">${refUtr}</span>. -${brand.shortCode}`;

    // 100% Authentic Android Truecaller Smart SMS Banking Notification (No Available Balance shown)
    notifCard.innerHTML = `
        <div class="tc-notif-header">
            <div class="tc-notif-app-info">
                <span class="tc-app-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="24" height="24" rx="6" fill="#0087FF"/>
                        <path d="M7.4 6.5C7.0 6.5 6.6 6.7 6.3 7.0C5.6 7.7 5.2 8.7 5.2 9.8C5.2 13.5 8.2 16.5 11.9 16.5C13.0 16.5 14.0 16.1 14.7 15.4C15.0 15.1 15.2 14.7 15.2 14.3C15.2 13.9 14.9 13.6 14.6 13.4L12.7 12.3C12.4 12.1 12.0 12.1 11.7 12.3L10.9 13.0C10.8 13.1 10.6 13.1 10.4 13.0C9.6 12.5 8.9 11.8 8.4 11.0C8.3 10.8 8.3 10.6 8.4 10.5L9.1 9.7C9.3 9.4 9.3 9.0 9.1 8.7L8.0 6.8C7.8 6.5 7.5 6.5 7.4 6.5Z" fill="white"/>
                    </svg>
                </span>
                <span class="tc-app-name">Truecaller</span>
                <span class="tc-dot-separator">•</span>
                <span class="tc-smart-sms-pill">Smart SMS</span>
                <span class="tc-dot-separator">•</span>
                <span class="tc-header-time">now</span>
            </div>
            <button type="button" class="tc-close-btn" aria-label="Dismiss notification">&times;</button>
        </div>

        <div class="tc-bank-sender-row">
            <div class="tc-bank-logo-wrap">
                <img src="${brand.logoUrl}" alt="${brand.bankName}" class="tc-bank-logo-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                <div class="tc-bank-logo-svg-fallback" style="display:none;">${brand.logoSvg}</div>
                <span class="tc-verified-corner" title="Verified Bank">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="11" fill="#0087FF" stroke="#FFFFFF" stroke-width="2"/>
                        <path d="M7.5 12.2L10.5 15.2L16.5 9.2" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </span>
            </div>
            <div class="tc-bank-sender-info">
                <div class="tc-bank-name-line">
                    <span class="tc-bank-title">${brand.bankName}</span>
                    <span class="tc-sender-badge">${senderCode}</span>
                </div>
                <span class="tc-bank-subtext ${isDebit ? 'tc-bank-subtext-debit' : ''}">${smsHeadline}</span>
            </div>
            <div class="${isDebit ? 'tc-debit-amount-badge' : 'tc-credit-amount-badge'}">
                <span class="tc-amount-val">${isDebit ? `− ₹${formattedAmount}` : `+ ₹${formattedAmount}`}</span>
            </div>
        </div>

        <div class="tc-smart-bubble">
            <div class="tc-sms-body">${smsBodyHtml}</div>

            <div class="tc-details-grid tc-details-grid-2">
                <div class="tc-detail-col">
                    <span class="tc-detail-lbl">${isDebit ? 'Debited Account' : 'Credited Account'}</span>
                    <span class="tc-detail-val">${brand.shortCode} ••${last4}</span>
                </div>
                <div class="tc-detail-col">
                    <span class="tc-detail-lbl">IMPS / UTR Ref</span>
                    <span class="tc-detail-val">${refUtr}</span>
                </div>
            </div>
        </div>

        <div class="tc-quick-actions">
            <button type="button" class="tc-action-btn tc-action-primary tc-view-details-btn">View SMS</button>
            <button type="button" class="tc-action-btn tc-copy-utr-btn">Copy Ref</button>
            <button type="button" class="tc-action-btn tc-dismiss-btn">Mark as read</button>
        </div>
    `;

    slot.appendChild(notifCard);
    container.prepend(slot);

    // Manual close & action listeners scoped to this card/slot
    const closeBtn = notifCard.querySelector('.tc-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissNotificationSlot(slot, 'up');
        });
    }

    const dismissActionBtn = notifCard.querySelector('.tc-dismiss-btn');
    if (dismissActionBtn) {
        dismissActionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dismissNotificationSlot(slot, 'right');
        });
    }

    const copyUtrBtn = notifCard.querySelector('.tc-copy-utr-btn');
    if (copyUtrBtn) {
        copyUtrBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(refUtr);
                }
            } catch (err) {}
            copyUtrBtn.textContent = '✓ Copied';
            setTimeout(() => {
                if (copyUtrBtn) copyUtrBtn.textContent = 'Copy Ref';
            }, 1800);
        });
    }

    const viewDetailsBtn = notifCard.querySelector('.tc-view-details-btn');
    if (viewDetailsBtn) {
        viewDetailsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const txFeed = document.getElementById('transactionFeed') || document.getElementById('runningAccountSection');
            if (txFeed) {
                txFeed.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            dismissNotificationSlot(slot, 'up');
        });
    }

    // Bind smooth mobile left/right finger swipe-to-dismiss gesture for this card
    bindNotificationSwipeGesture(notifCard, slot);

    // Measure natural height so remaining stack items slide down smoothly as new slot opens
    const targetHeight = Math.max(120, notifCard.offsetHeight || 190);
    slot.style.maxHeight = '0px';
    void slot.offsetHeight;

    requestAnimationFrame(() => {
        slot.classList.remove('tc-slot-entering');
        slot.style.maxHeight = `${targetHeight + 6}px`;
        notifCard.classList.add('tc-notif-visible');
        notifCard.classList.add('tc-pulse');
        setTimeout(() => notifCard.classList.remove('tc-pulse'), 320);
        setTimeout(() => {
            if (!slot.classList.contains('tc-slot-collapsing')) {
                slot.style.maxHeight = '';
            }
        }, 380);
    });

    // Play original Truecaller incoming notification sound once when overlay is displayed
    void playNotificationSound(txnId);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
            navigator.vibrate([80, 50, 110]);
        } catch (e) {}
    }

    // Per-card auto-dismiss timer (~6.5s)
    slot._autoTimer = setTimeout(() => {
        dismissNotificationSlot(slot, 'up');
    }, 6500);
}

function bindNotificationSwipeGesture(notifCard, slot) {
    if (!notifCard || !slot || notifCard.dataset.swipeBound === '1') return;
    notifCard.dataset.swipeBound = '1';

    let tracking = false;
    let isHorizontalSwipe = false;
    let startX = 0;
    let startY = 0;
    let currentDeltaX = 0;
    let startTime = 0;
    let activePointerId = null;

    function resetDragState(snapBack) {
        tracking = false;
        isHorizontalSwipe = false;
        activePointerId = null;
        notifCard.classList.remove('is-swiping');
        if (snapBack) {
            notifCard.classList.add('tc-notif-snap-back');
            notifCard.style.transform = '';
            notifCard.style.opacity = '';
            setTimeout(() => {
                notifCard.classList.remove('tc-notif-snap-back');
            }, 390);
            if (slot._autoTimer) clearTimeout(slot._autoTimer);
            slot._autoTimer = setTimeout(() => {
                dismissNotificationSlot(slot, 'up');
            }, 4500);
        }
        currentDeltaX = 0;
    }

    notifCard.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target && e.target.closest('button, a')) return;
        if (slot.classList.contains('tc-slot-collapsing')) return;

        notifCard.classList.remove('tc-notif-snap-back');
        tracking = true;
        isHorizontalSwipe = false;
        startX = e.clientX;
        startY = e.clientY;
        currentDeltaX = 0;
        startTime = Date.now();
        activePointerId = e.pointerId;
        try {
            notifCard.setPointerCapture(e.pointerId);
        } catch (err) {}
    });

    notifCard.addEventListener('pointermove', (e) => {
        if (!tracking || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isHorizontalSwipe) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            if (Math.abs(dy) > Math.abs(dx) * 1.15) {
                tracking = false;
                activePointerId = null;
                return;
            }
            isHorizontalSwipe = true;
            notifCard.classList.add('is-swiping');
            if (slot._autoTimer) {
                clearTimeout(slot._autoTimer);
                slot._autoTimer = null;
            }
        }

        currentDeltaX = dx;
        const tiltDeg = Math.max(-5, Math.min(5, dx * 0.022));
        const scale = Math.max(0.95, 1 - Math.abs(dx) / 2600);
        notifCard.style.transform = `translate3d(${dx}px, 0, 0) rotate(${tiltDeg.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
        notifCard.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / 230));
    });

    function handleSwipeEnd(e) {
        if (!tracking) return;
        if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
        try {
            if (activePointerId !== null && notifCard.hasPointerCapture(activePointerId)) {
                notifCard.releasePointerCapture(activePointerId);
            }
        } catch (err) {}

        if (!isHorizontalSwipe) {
            tracking = false;
            activePointerId = null;
            return;
        }

        const elapsed = Math.max(1, Date.now() - startTime);
        const velocityX = Math.abs(currentDeltaX) / elapsed;
        const dismissThreshold = Math.min(95, (notifCard.offsetWidth || 340) * 0.25);

        if (Math.abs(currentDeltaX) >= dismissThreshold || (Math.abs(currentDeltaX) >= 40 && velocityX > 0.30)) {
            const dir = currentDeltaX >= 0 ? 'right' : 'left';
            tracking = false;
            isHorizontalSwipe = false;
            activePointerId = null;
            notifCard.classList.remove('is-swiping');
            dismissNotificationSlot(slot, dir);
        } else {
            resetDragState(true);
        }
    }

    notifCard.addEventListener('pointerup', handleSwipeEnd);
    notifCard.addEventListener('pointercancel', handleSwipeEnd);
}

function dismissNotificationSlot(slot, direction = 'up') {
    if (!slot || slot.classList.contains('tc-slot-collapsing')) return;
    const notifCard = slot.querySelector('.tc-notification-card');

    if (slot._autoTimer) {
        clearTimeout(slot._autoTimer);
        slot._autoTimer = null;
    }
    if (slot._removeTimer) {
        clearTimeout(slot._removeTimer);
        slot._removeTimer = null;
    }

    // Lock current height so the vertical slot collapse smoothly glides remaining stack items
    const measuredHeight = slot.offsetHeight;
    if (measuredHeight > 0) {
        slot.style.maxHeight = `${measuredHeight}px`;
    }

    if (notifCard) {
        notifCard.classList.remove('is-swiping', 'tc-notif-snap-back', 'tc-notif-hiding', 'tc-notif-hiding-left', 'tc-notif-hiding-right');
        if (direction === 'left' || direction === 'right') {
            void notifCard.offsetWidth;
            notifCard.classList.remove('tc-notif-visible');
            notifCard.classList.add(direction === 'left' ? 'tc-notif-hiding-left' : 'tc-notif-hiding-right');
            notifCard.style.transform = '';
            notifCard.style.opacity = '';
        } else {
            notifCard.style.transform = '';
            notifCard.style.opacity = '';
            notifCard.classList.remove('tc-notif-visible');
            notifCard.classList.add('tc-notif-hiding');
        }
    }

    // Begin vertical collapse slightly into the horizontal slide so remaining notifications adjust smoothly
    setTimeout(() => {
        void slot.offsetHeight;
        slot.classList.add('tc-slot-collapsing');
    }, direction === 'up' ? 40 : 95);

    slot._removeTimer = setTimeout(() => {
        if (slot && slot.parentNode) {
            slot.parentNode.removeChild(slot);
        }
    }, 450);
}

function dismissPaymentNotification(direction = 'up') {
    const container = document.getElementById('paymentNotificationContainer');
    if (!container) return;
    const topSlot = container.querySelector('.tc-notif-slot:not(.tc-slot-collapsing)');
    if (topSlot) {
        dismissNotificationSlot(topSlot, direction);
    }
}

// Helper: set account status UI (syncs both Running Section indicator & 4-Box Hero Status Logo)
function updateHeroAccountStatusBox(mode, customText) {
    const card = document.getElementById('heroAccountStatusCard');
    const logo = document.getElementById('heroAccountStatusLogo');
    const label = document.getElementById('heroAccountStatusText');
    if (!card || !logo || !label) return;

    card.classList.remove('is-connected', 'is-limit-stopped', 'is-standby');

    if (mode === 'connected') {
        card.classList.add('is-connected');
        logo.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="M9 12l2 2 4-4"></path>
            </svg>
        `;
        label.textContent = customText || 'ACCOUNT CONNECTED';
    } else if (mode === 'limit_reached') {
        card.classList.add('is-limit-stopped');
        logo.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"></circle>
                <line x1="8" y1="8" x2="16" y2="16"></line>
                <line x1="16" y1="8" x2="8" y2="16"></line>
            </svg>
        `;
        label.textContent = customText || 'STOPPED LIMIT REACHED';
    } else {
        card.classList.add('is-standby');
        logo.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"></circle>
                <polyline points="12 7 12 12 15 14"></polyline>
            </svg>
        `;
        label.textContent = customText || 'NOT CONNECTED';
    }
}

function setAccountStatusRunning() {
	const dot = document.getElementById('accountStatusDot');
	const text = document.getElementById('accountStatusText');
	if (dot) {
		dot.classList.remove('stopped', 'pending');
		dot.classList.add('running');
	}
	if (text) {
        text.textContent = 'ACCOUNT CONNECTED';
		text.style.color = 'var(--success-color)';
	}
    updateHeroAccountStatusBox('connected', 'ACCOUNT CONNECTED');
}

function setAccountStatusStopped(message, isLimitReached = false) {
	const dot = document.getElementById('accountStatusDot');
	const text = document.getElementById('accountStatusText');
    const upperMsg = String(message || '').toUpperCase();
    const limitReached = Boolean(isLimitReached || upperMsg.includes('LIMIT'));
	if (dot) {
		dot.classList.remove('running', 'pending');
		dot.classList.add('stopped');
	}
	if (text) {
        text.textContent = message || (limitReached ? 'STOPPED LIMIT REACHED' : 'ACCOUNT STOPPED');
		text.style.color = 'var(--danger-color)';
	}
    if (limitReached) {
        updateHeroAccountStatusBox('limit_reached', 'STOPPED LIMIT REACHED');
    } else if (upperMsg.includes('WITHDRAWAL')) {
        updateHeroAccountStatusBox('standby', 'STOPPED • WITHDRAWAL');
    } else {
        updateHeroAccountStatusBox('standby', 'NOT CONNECTED');
    }
}

function normalizeButtonsForInteraction() {
    document.querySelectorAll('button').forEach(button => {
        if (!button.hasAttribute('type')) {
            button.setAttribute('type', 'button');
        }
        button.addEventListener('touchstart', () => {}, { passive: true });
    });
}

normalizeButtonsForInteraction();

function sanitizeUtrInput(input) {
    if (!input) return '';
    const cleaned = input.value.replace(/\D/g, '').slice(0, 12);
    input.value = cleaned;
    return cleaned;
}

const DEMO_UPI_ID_1 = 'panneltest0@ptyes';
const DEMO_UPI_ID_2 = 'malikpay0@fam';

function setupCopyButton(button, upiId, messageElement) {
    if (!button) return;

    button.addEventListener('click', async () => {
        const message = typeof messageElement === 'string'
            ? document.getElementById(messageElement)
            : messageElement;

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(upiId || '');
            } else {
                const temp = document.createElement('textarea');
                temp.value = upiId || '';
                temp.setAttribute('readonly', '');
                temp.style.position = 'fixed';
                temp.style.opacity = '0';
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            }

            if (message) {
                message.textContent = '✓ UPI ID copied';
                clearTimeout(message.copyTimer);
                message.copyTimer = setTimeout(() => {
                    message.textContent = '';
                }, 2000);
            }
        } catch (error) {
            if (message) {
                message.textContent = 'Copy failed. Please try again.';
                clearTimeout(message.copyTimer);
                message.copyTimer = setTimeout(() => {
                    message.textContent = '';
                }, 2000);
            }
        }
    });
}

const workflowSectionIds = [
    'mainDashboard',
    'gamingFundSection',
    'autodebitSection',
    'activationPaymentSection',
    'activationCodeUpiSection',
    'runningAccountSection',
    'withdrawCommissionSection',
    'upgradePaymentSection',
    'paymentReceiptSection',
    'transactionHistorySection',
    'supportSection'
];
const workflowHistory = [];

function showAppToast(message, variant = 'info') {
    const existing = document.getElementById('appInlineToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'appInlineToast';
    toast.className = `admin-toast app-toast-${variant}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        if (toast && toast.parentElement) toast.remove();
    }, 3400);
}

function showAppConfirm({ title = 'Confirm Action', message = '', okText = 'Proceed', icon = '⚠️', onConfirm }) {
    const modal = document.getElementById('appConfirmModal');
    const titleEl = document.getElementById('appConfirmTitle');
    const msgEl = document.getElementById('appConfirmMessage');
    const iconEl = document.getElementById('appConfirmIcon');
    const okBtn = document.getElementById('appConfirmOkBtn');
    const cancelBtn = document.getElementById('appConfirmCancelBtn');

    if (!modal || !okBtn || !cancelBtn) {
        if (typeof onConfirm === 'function') onConfirm();
        return;
    }

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    okBtn.textContent = okText;

    const cleanup = () => {
        modal.style.display = 'none';
        okBtn.replaceWith(okBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    };

    modal.style.display = 'flex';
    const freshOk = document.getElementById('appConfirmOkBtn');
    const freshCancel = document.getElementById('appConfirmCancelBtn');

    if (freshCancel) {
        freshCancel.addEventListener('click', () => cleanup(), { once: true });
    }
    if (freshOk) {
        freshOk.addEventListener('click', () => {
            cleanup();
            if (typeof onConfirm === 'function') onConfirm();
        }, { once: true });
    }
}

function getCurrentWorkflowSectionId() {
    return workflowSectionIds.find(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    }) || 'mainDashboard';
}

function showWorkflowSection(sectionId, pushHistory = true) {
    const currentSectionId = getCurrentWorkflowSectionId();
    if (pushHistory && sectionId && currentSectionId && currentSectionId !== sectionId) {
        workflowHistory.push(currentSectionId);
        if (workflowHistory.length > 20) workflowHistory.shift();
    }

    workflowSectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.toggle('hidden', id !== sectionId);
        }
    });

    // Show Recent Ledger only on Home and standalone Ledger tab (NOT on Withdraw / Commission Payout page)
    const transactionHistorySection = document.getElementById('transactionHistorySection');
    if (transactionHistorySection) {
        const showLedger = sectionId === 'mainDashboard' || sectionId === 'transactionHistorySection';
        transactionHistorySection.classList.toggle('hidden', !showLedger);
    }

    const bottomActions = document.querySelector('.bottom-actions');
    if (bottomActions) {
        bottomActions.classList.toggle('hidden', sectionId !== 'mainDashboard');
    }

    const bannerEl = document.getElementById('panelApprovalBanner');
    if (bannerEl && sectionId !== 'mainDashboard' && sectionId !== 'runningAccountSection') {
        bannerEl.classList.add('hidden');
    }

    const backBtn = document.getElementById('dashboardBackBtn');
    if (backBtn) {
        backBtn.style.display = sectionId === 'mainDashboard' ? 'none' : 'inline-flex';
    }

    if (typeof window.__onWorkflowSectionShown === 'function') {
        window.__onWorkflowSectionShown(sectionId);
    }

    try {
        window.scrollTo({ top: 0, behavior: 'auto' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    } catch {}
}

function goBackOneStep() {
    const currentSectionId = getCurrentWorkflowSectionId();
    const previousSectionId = workflowHistory.pop();

    if (previousSectionId && previousSectionId !== currentSectionId) {
        showWorkflowSection(previousSectionId, false);
        return;
    }

    if (currentSectionId && currentSectionId !== 'mainDashboard') {
        showWorkflowSection('mainDashboard', false);
        return;
    }
}

// ============================================
// INDEX / AUTH PAGE
// ============================================

if (document.getElementById('registerForm')) {
    StorageManager.init();

    const authSupportBtn = document.getElementById('authSupportBtn');
    const authSupportBackBtn = document.getElementById('authSupportBackBtn');
    const authMainShell = document.getElementById('authMainShell');
    const authSupportSection = document.getElementById('authSupportSection');
    if (authSupportBtn && authMainShell && authSupportSection) {
        authSupportBtn.addEventListener('click', () => {
            const isShowingSupport = !authSupportSection.classList.contains('hidden');
            authSupportSection.classList.toggle('hidden', isShowingSupport);
            authMainShell.classList.toggle('hidden', !isShowingSupport);
            window.scrollTo({ top: 0, behavior: 'auto' });
        });
    }
    if (authSupportBackBtn && authMainShell && authSupportSection) {
        authSupportBackBtn.addEventListener('click', () => {
            authSupportSection.classList.add('hidden');
            authMainShell.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'auto' });
        });
    }

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            const tabEl = document.getElementById(tabName + 'Tab');
            if (tabEl) tabEl.classList.add('active');
        });
    });

    // Toggle MPIN / Password visibility via eye icon buttons
    document.querySelectorAll('.mp-pwd-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-pwd-target');
            const inputEl = targetId ? document.getElementById(targetId) : null;
            if (!inputEl) return;
            const isHidden = inputEl.type === 'password';
            inputEl.type = isHidden ? 'text' : 'password';
            btn.classList.toggle('is-visible', isHidden);
            btn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
        });
    });

    // ----------------------------------------
    // REAL MOBILE NUMBER & SMS OTP VERIFICATION STATE
    // ----------------------------------------
    let verifiedMobileNumber = '';
    let verifiedOtpProof = null;
    let otpCountdownInterval = null;
    let otpDeliveryTimeout = null;
    let otpDeliveryInterval = null;
    let isSendingOtp = false;

    const regMobileInput = document.getElementById('regMobile');
    const sendOtpBtn = document.getElementById('sendOtpBtn');
    const otpModalOverlay = document.getElementById('otpModalOverlay');
    const otpTargetMobile = document.getElementById('otpTargetMobile');
    const otpProviderBadge = document.getElementById('otpProviderBadge');
    const otpDeliveryPendingState = document.getElementById('otpDeliveryPendingState');
    const otpDeliveryCountdownText = document.getElementById('otpDeliveryCountdownText');
    const otpDeliveryProgressFill = document.getElementById('otpDeliveryProgressFill');
    const instantSmsOtpBar = document.getElementById('instantSmsOtpBar');
    const instantOtpCode = document.getElementById('instantOtpCode');
    const useFreeOtpBtn = document.getElementById('useFreeOtpBtn');
    const otpInputField = document.getElementById('otpInputField');
    const confirmVerifyOtpBtn = document.getElementById('confirmVerifyOtpBtn');
    const cancelOtpModalBtn = document.getElementById('cancelOtpModalBtn');
    const resendOtpBtn = document.getElementById('resendOtpBtn');
    const otpCountdownText = document.getElementById('otpCountdownText');
    const otpTimerSeconds = document.getElementById('otpTimerSeconds');
    const otpModalMessage = document.getElementById('otpModalMessage');
    const mobileVerifiedNotice = document.getElementById('mobileVerifiedNotice');
    const verifiedMobileDisplay = document.getElementById('verifiedMobileDisplay');
    const mobileError = document.getElementById('mobileError');

    const localFallbackOtps = new Map();

    function clearPendingOtpDelivery() {
        if (otpDeliveryTimeout) {
            clearTimeout(otpDeliveryTimeout);
            otpDeliveryTimeout = null;
        }
        if (otpDeliveryInterval) {
            clearInterval(otpDeliveryInterval);
            otpDeliveryInterval = null;
        }
    }

    function normalizeIndianMobileInput(rawVal) {
        let digits = String(rawVal || '').replace(/\D/g, '');
        if (digits.length > 10 && digits.startsWith('0091') && /^[6-9]/.test(digits.slice(4))) {
            digits = digits.slice(4);
        } else if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
            digits = digits.slice(2);
        } else if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
            digits = digits.slice(1);
        }
        return digits.slice(0, 10);
    }

    function generateLocalFallbackOtp(mobile) {
        const cleanMobile = normalizeIndianMobileInput(mobile);
        let code = '';
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            const arr = new Uint32Array(1);
            crypto.getRandomValues(arr);
            code = String(100000 + (arr[0] % 900000));
        } else {
            code = String(Math.floor(100000 + Math.random() * 900000));
        }
        localFallbackOtps.set(cleanMobile, {
            code,
            expiresAt: Date.now() + 10 * 60 * 1000,
            attempts: 0
        });
        return {
            success: true,
            provider: 'free-otp',
            mobile: cleanMobile,
            otpCode: code,
            message: `Verification OTP generated for +91 ${cleanMobile}`,
            isLocalFallback: true
        };
    }

    // Restrict mobile input to 10 normalized Indian digits (handles +91/0 autofill cleanly)
    if (regMobileInput) {
        regMobileInput.addEventListener('input', () => {
            regMobileInput.value = normalizeIndianMobileInput(regMobileInput.value);
            if (regMobileInput.value !== verifiedMobileNumber) {
                verifiedMobileNumber = '';
                verifiedOtpProof = null;
                if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';
            }
            if (mobileError) mobileError.textContent = '';
        });
    }

    if (otpInputField) {
        otpInputField.addEventListener('input', () => {
            otpInputField.value = otpInputField.value.replace(/\D/g, '').slice(0, 6);
        });
    }

    // Dispatch Mobile OTP with realistic 8-15 second carrier delivery delay & cross-device fallback
    async function triggerSendOtp() {
        if (isSendingOtp) return;

        const rawMobile = regMobileInput ? normalizeIndianMobileInput(regMobileInput.value) : '';
        if (regMobileInput && regMobileInput.value !== rawMobile) {
            regMobileInput.value = rawMobile;
        }
        if (!/^[6-9]\d{9}$/.test(rawMobile)) {
            if (mobileError) {
                mobileError.textContent = 'Please enter a valid 10-digit Indian mobile number (starting 6-9)!';
            }
            if (regMobileInput) regMobileInput.focus();
            return;
        }

        clearPendingOtpDelivery();
        if (otpCountdownInterval) clearInterval(otpCountdownInterval);

        isSendingOtp = true;
        if (mobileError) mobileError.textContent = '';
        if (sendOtpBtn) {
            sendOtpBtn.disabled = true;
            sendOtpBtn.textContent = 'Connecting...';
        }
        if (resendOtpBtn) {
            resendOtpBtn.disabled = true;
            resendOtpBtn.style.display = 'none';
        }

        let result = null;
        try {
            const fb = await Promise.race([
                getFirebaseStore(),
                new Promise((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            if (fb && typeof fb.sendRealMobileOtp === 'function') {
                result = await Promise.race([
                    fb.sendRealMobileOtp(rawMobile),
                    new Promise((resolve) => setTimeout(() => resolve(null), 3500))
                ]);
            }
        } catch (err) {
            result = null;
        } finally {
            isSendingOtp = false;
            if (sendOtpBtn) {
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = 'Get OTP';
            }
            if (resendOtpBtn) {
                resendOtpBtn.disabled = false;
            }
        }

        // Block only if invalid 10-digit Indian mobile format
        if (result && !result.success && /valid 10-digit/i.test(result.message || '')) {
            const errMsg = result.message;
            if (otpModalOverlay && otpModalOverlay.style.display === 'flex' && otpModalMessage) {
                otpModalMessage.textContent = errMsg;
                otpModalMessage.className = 'message error';
                otpModalMessage.style.display = 'block';
            } else if (mobileError) {
                mobileError.textContent = errMsg;
            }
            return;
        }

        if (!result || !result.success) {
            result = generateLocalFallbackOtp(rawMobile);
        } else if (result.otpCode) {
            localFallbackOtps.set(rawMobile, {
                code: String(result.otpCode),
                expiresAt: Date.now() + 10 * 60 * 1000,
                attempts: 0
            });
        }

        if (otpTargetMobile) otpTargetMobile.textContent = `+91 ${rawMobile}`;
        if (otpProviderBadge) {
            const label = result.provider === 'free-otp'
                ? 'SMS GATEWAY OTP DISPATCH'
                : `${String(result.provider || 'SMS').toUpperCase()} SMS OTP`;
            otpProviderBadge.innerHTML = `<span>${label}</span>`;
        }

        // Hide OTP immediately and show realistic 8-15 second gateway dispatch progress
        if (instantSmsOtpBar) instantSmsOtpBar.style.display = 'none';
        if (instantOtpCode) instantOtpCode.textContent = '------';
        if (otpInputField) {
            otpInputField.value = '';
            otpInputField.disabled = true;
            otpInputField.placeholder = 'Waiting for OTP...';
        }
        if (confirmVerifyOtpBtn) {
            confirmVerifyOtpBtn.disabled = true;
            confirmVerifyOtpBtn.textContent = 'Awaiting SMS...';
        }
        if (otpCountdownText) otpCountdownText.style.display = 'none';
        if (otpModalMessage) {
            otpModalMessage.style.display = 'none';
            otpModalMessage.textContent = '';
        }
        if (otpDeliveryPendingState) otpDeliveryPendingState.style.display = 'flex';
        if (otpDeliveryProgressFill) otpDeliveryProgressFill.style.width = '4%';

        if (otpModalOverlay) {
            otpModalOverlay.style.display = 'flex';
        }

        // Randomized 8.5s - 14s delivery window (strictly within 8-15 seconds)
        const deliveryDelayMs = Math.round(8500 + Math.random() * 5500);
        const startedAt = Date.now();

        const updateDeliveryProgress = () => {
            const elapsed = Date.now() - startedAt;
            const remainingSec = Math.max(1, Math.ceil((deliveryDelayMs - elapsed) / 1000));
            const pct = Math.min(96, Math.max(6, Math.round((elapsed / deliveryDelayMs) * 100)));
            if (otpDeliveryCountdownText) {
                otpDeliveryCountdownText.textContent = `Connecting to Pannel in ${remainingSec}s...`;
            }
            if (otpDeliveryProgressFill) {
                otpDeliveryProgressFill.style.width = `${pct}%`;
            }
        };

        updateDeliveryProgress();
        otpDeliveryInterval = setInterval(updateDeliveryProgress, 250);

        otpDeliveryTimeout = setTimeout(() => {
            clearPendingOtpDelivery();
            if (otpDeliveryProgressFill) otpDeliveryProgressFill.style.width = '100%';
            if (otpDeliveryPendingState) otpDeliveryPendingState.style.display = 'none';

            if (instantSmsOtpBar && instantOtpCode) {
                if (result.otpCode) {
                    instantOtpCode.textContent = result.otpCode;
                    instantSmsOtpBar.style.display = 'flex';
                } else {
                    instantOtpCode.textContent = '------';
                    instantSmsOtpBar.style.display = 'none';
                }
            }

            if (otpInputField) {
                otpInputField.disabled = false;
                otpInputField.placeholder = '• • • • • •';
                otpInputField.focus();
            }
            if (confirmVerifyOtpBtn) {
                confirmVerifyOtpBtn.disabled = false;
                confirmVerifyOtpBtn.textContent = 'Verify OTP';
            }

            try {
                if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
            } catch (e) {}

            startOtpTimer(45);
        }, deliveryDelayMs);
    }

    if (useFreeOtpBtn) {
        useFreeOtpBtn.addEventListener('click', () => {
            const code = instantOtpCode ? instantOtpCode.textContent.trim() : '';
            if (/^\d{6}$/.test(code) && otpInputField && !otpInputField.disabled) {
                otpInputField.value = code;
                otpInputField.focus();
            }
        });
    }

    function startOtpTimer(seconds) {
        if (otpCountdownInterval) clearInterval(otpCountdownInterval);
        let remaining = Number(seconds) || 45;
        if (resendOtpBtn) resendOtpBtn.style.display = 'none';
        if (otpCountdownText) otpCountdownText.style.display = 'inline';
        if (otpTimerSeconds) otpTimerSeconds.textContent = `${remaining}s`;

        otpCountdownInterval = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(otpCountdownInterval);
                if (otpCountdownText) otpCountdownText.style.display = 'none';
                if (resendOtpBtn) resendOtpBtn.style.display = 'inline';
            } else {
                if (otpTimerSeconds) otpTimerSeconds.textContent = `${remaining}s`;
            }
        }, 1000);
    }

    if (sendOtpBtn) {
        sendOtpBtn.addEventListener('click', () => {
            void triggerSendOtp();
        });
    }

    if (confirmVerifyOtpBtn) {
        confirmVerifyOtpBtn.addEventListener('click', async () => {
            if (otpDeliveryTimeout) return;

            const entered = otpInputField ? otpInputField.value.replace(/\D/g, '').trim() : '';
            if (!/^\d{6}$/.test(entered)) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = 'Please enter the exact 6-digit OTP code!';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            const currentMobile = regMobileInput ? normalizeIndianMobileInput(regMobileInput.value) : '';
            confirmVerifyOtpBtn.disabled = true;
            confirmVerifyOtpBtn.textContent = 'Verifying...';

            let verifyResult = null;
            try {
                const localRec = localFallbackOtps.get(currentMobile);
                if (localRec) {
                    if (Date.now() > localRec.expiresAt) {
                        localFallbackOtps.delete(currentMobile);
                        verifyResult = { success: false, message: 'OTP has expired! Please click Resend OTP.' };
                    } else {
                        localRec.attempts += 1;
                        if (localRec.attempts > 5) {
                            localFallbackOtps.delete(currentMobile);
                            verifyResult = { success: false, message: 'Too many wrong attempts. Please request a new OTP.' };
                        } else if (localRec.code !== entered) {
                            verifyResult = { success: false, message: 'Incorrect OTP code entered. Please check the generated OTP.' };
                        } else {
                            localFallbackOtps.delete(currentMobile);
                            verifyResult = { success: true, provider: 'free-otp', firebasePhoneUid: '' };
                        }
                    }
                } else {
                    const fb = await getFirebaseStore();
                    if (fb && typeof fb.verifyRealMobileOtp === 'function') {
                        verifyResult = await fb.verifyRealMobileOtp(entered, currentMobile);
                    } else {
                        verifyResult = { success: false, message: 'OTP session expired. Please click Get OTP again.' };
                    }
                }
            } catch (err) {
                verifyResult = { success: false, message: 'Verification failed. Please try again.' };
            } finally {
                confirmVerifyOtpBtn.disabled = false;
                confirmVerifyOtpBtn.textContent = 'Verify OTP';
            }

            if (!verifyResult || !verifyResult.success) {
                if (otpModalMessage) {
                    otpModalMessage.textContent = (verifyResult && verifyResult.message) || 'Invalid OTP! Please check the 6-digit code.';
                    otpModalMessage.className = 'message error';
                    otpModalMessage.style.display = 'block';
                }
                return;
            }

            // Mobile OTP verified!
            verifiedMobileNumber = currentMobile;
            verifiedOtpProof = {
                provider: verifyResult.provider || 'free-otp',
                firebasePhoneUid: verifyResult.firebasePhoneUid || ''
            };

            clearPendingOtpDelivery();
            if (otpModalOverlay) otpModalOverlay.style.display = 'none';
            if (otpCountdownInterval) clearInterval(otpCountdownInterval);

            if (mobileVerifiedNotice) {
                mobileVerifiedNotice.style.display = 'flex';
                if (verifiedMobileDisplay) verifiedMobileDisplay.textContent = `+91 ${currentMobile} (OTP Verified)`;
            }

            if (mobileError) mobileError.textContent = '';
        });
    }

    if (cancelOtpModalBtn) {
        cancelOtpModalBtn.addEventListener('click', () => {
            clearPendingOtpDelivery();
            if (otpModalOverlay) otpModalOverlay.style.display = 'none';
            if (otpCountdownInterval) clearInterval(otpCountdownInterval);
        });
    }

    if (resendOtpBtn) {
        resendOtpBtn.addEventListener('click', () => {
            void triggerSendOtp();
        });
    }

    // ----------------------------------------
    // REGISTRATION FORM SUBMISSION -> EXPLICIT LOGIN GATE
    // ----------------------------------------
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const mobile = regMobileInput ? regMobileInput.value.trim() : '';
            const regUserEl = document.getElementById('regUsername');
            const regPassEl = document.getElementById('regPassword');
            const username = regUserEl ? regUserEl.value.trim() : '';
            const password = regPassEl ? regPassEl.value.trim() : '';
            const messageDiv = document.getElementById('registerMessage');

            if (mobileError) mobileError.textContent = '';
            const userErr = document.getElementById('usernameError');
            const passErr = document.getElementById('passwordError');
            if (userErr) userErr.textContent = '';
            if (passErr) passErr.textContent = '';

            let hasError = false;

            if (!/^[6-9]\d{9}$/.test(mobile)) {
                if (mobileError) mobileError.textContent = 'Please enter a valid 10-digit Indian mobile number!';
                hasError = true;
            } else if (verifiedMobileNumber !== mobile || !verifiedOtpProof) {
                if (mobileError) mobileError.textContent = 'Please verify your mobile number with real SMS OTP first!';
                void triggerSendOtp();
                return;
            }

            if (!username || username.length < 3) {
                if (userErr) userErr.textContent = 'Username must be at least 3 characters!';
                hasError = true;
            }

            if (!password || password.length < 4) {
                if (passErr) passErr.textContent = 'Password must be at least 4 characters!';
                hasError = true;
            }

            if (hasError) return;

            const fb = await getFirebaseStore();
            const submitBtn = document.getElementById('registerSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;

            let fbResult = null;
            try {
                if (fb && typeof fb.registerUser === 'function') {
                    fbResult = await fb.registerUser({
                        mobile,
                        username,
                        password,
                        otpProvider: verifiedOtpProof.provider,
                        firebasePhoneUid: verifiedOtpProof.firebasePhoneUid
                    });
                } else {
                    const localRes = StorageManager.registerUser(mobile, username, password);
                    if (localRes && localRes.success) {
                        const localUsers = JSON.parse(localStorage.getItem('users') || '{}');
                        fbResult = { success: true, message: localRes.message, user: localUsers[username] };
                    } else {
                        fbResult = localRes;
                    }
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }

            if (!fbResult || !fbResult.success) {
                if (messageDiv) {
                    messageDiv.textContent = (fbResult && fbResult.message) || 'Registration failed. Please retry.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const users = JSON.parse(localStorage.getItem('users') || '{}');
            if (fbResult.user) users[username] = fbResult.user;
            localStorage.setItem('users', JSON.stringify(users));
            // Enforce explicit Login screen sign-in after registration
            localStorage.setItem('loggedInUser', '');

            if (messageDiv) {
                messageDiv.textContent = fbResult.message || 'Registration successful! Please login with your mobile number or username and password.';
                messageDiv.className = 'message success';
            }

            registerForm.reset();
            verifiedMobileNumber = '';
            verifiedOtpProof = null;
            if (mobileVerifiedNotice) mobileVerifiedNotice.style.display = 'none';

            let postRegisterNoticeTimer = null;
            setTimeout(() => {
                tabButtons.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-tab') === 'login'));
                tabContents.forEach(content => content.classList.toggle('active', content.id === 'loginTab'));

                const postNotice = document.getElementById('postRegisterNotice');
                const postNoticeText = document.getElementById('postRegisterNoticeText');
                if (postNotice) {
                    postNotice.style.display = 'flex';
                    clearTimeout(postRegisterNoticeTimer);
                    postRegisterNoticeTimer = setTimeout(() => {
                        postNotice.style.display = 'none';
                    }, 5000);
                }
                if (postNoticeText) {
                    postNoticeText.textContent = `Account @${username} (+91 ${mobile}) registered! Enter your registered mobile number or username and password to login.`;
                }

                const loginUserEl = document.getElementById('loginUsername');
                const loginPassEl = document.getElementById('loginPassword');
                const loginMsgEl = document.getElementById('loginMessage');
                if (loginMsgEl) {
                    loginMsgEl.textContent = '';
                    loginMsgEl.className = 'message';
                }
                if (loginPassEl) loginPassEl.value = '';
                if (loginUserEl) {
                    loginUserEl.value = '';
                    loginUserEl.focus();
                }
                showAppToast('✓ Registered! Please enter your mobile/username & password to login.', 'success');
            }, 650);
        });
    }

    // ----------------------------------------
    // LOGIN FORM SUBMISSION (FIREBASE FIRESTORE REAL-TIME AUTH)
    // ----------------------------------------
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const loginUserEl = document.getElementById('loginUsername');
            const loginPassEl = document.getElementById('loginPassword');
            const identifier = loginUserEl ? loginUserEl.value.trim() : '';
            const password = loginPassEl ? loginPassEl.value.trim() : '';
            const messageDiv = document.getElementById('loginMessage');

            const userErr = document.getElementById('loginUsernameError');
            const passErr = document.getElementById('loginPasswordError');
            if (userErr) userErr.textContent = '';
            if (passErr) passErr.textContent = '';

            if (!identifier) {
                if (userErr) userErr.textContent = 'Please enter username or mobile number!';
                return;
            }

            if (!password) {
                if (passErr) passErr.textContent = 'Please enter password!';
                return;
            }

            const fb = await getFirebaseStore();
            const fbResult = (fb && typeof fb.loginUser === 'function')
                ? await fb.loginUser({ identifier, password })
                : StorageManager.loginUser(identifier, password);
            if (fbResult && fbResult.success && fbResult.user) {
                const u = fbResult.user;
                const localUsers = JSON.parse(localStorage.getItem('users') || '{}');
                localUsers[u.username] = u;
                localStorage.setItem('users', JSON.stringify(localUsers));
                localStorage.setItem('loggedInUser', u.username);
                if (u.balance !== undefined) localStorage.setItem(`balance_${u.username}`, String(u.balance));
                if (u.commission !== undefined) localStorage.setItem(`commission_${u.username}`, String(u.commission));
                if (Array.isArray(u.transactions) && u.transactions.length > 0) {
                    localStorage.setItem(`transactions_${u.username}`, JSON.stringify(u.transactions));
                }
                if (u.activationCode) {
                    localStorage.setItem(`activationCode_${u.username}`, u.activationCode);
                }

                if (messageDiv) {
                    messageDiv.textContent = 'Login successful!';
                    messageDiv.className = 'message success';
                }
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 400);
            } else {
                if (messageDiv) {
                    messageDiv.textContent = (fbResult && fbResult.message) || 'Invalid username or password!';
                    messageDiv.className = 'message error';
                }
            }
        });
    }
}

// ============================================
// DASHBOARD PAGE
// ============================================

if (document.getElementById('welcomeMessage')) {
    StorageManager.init();

    const loggedInUser = StorageManager.getLoggedInUser();
    if (!loggedInUser || loggedInUser === 'demo') {
        localStorage.setItem('loggedInUser', '');
        window.location.href = 'index.html';
        return;
    }

    let lastKnownApprovalStatus = StorageManager.getActivationStatus(loggedInUser);
    let latestUserUtrs = StorageManager.getWithdrawals().filter(w => w.username === loggedInUser);
    let activeReceiptUtrId = null;

    function mergeUserUtrs(remoteList = []) {
        const localList = StorageManager.getWithdrawals().filter(w => w.username === loggedInUser);
        const byId = new Map();
        localList.forEach(item => {
            if (item && item.id) byId.set(item.id, item);
        });
        (Array.isArray(remoteList) ? remoteList : []).forEach(item => {
            if (item && item.id) byId.set(item.id, { ...(byId.get(item.id) || {}), ...item });
        });
        const merged = Array.from(byId.values());
        merged.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        latestUserUtrs = merged;
        return merged;
    }

    function isUpgrade199Record(u) {
        if (!u) return false;
        const typeStr = String(u.type || '').toLowerCase();
        return Number(u.amount) === 199 || typeStr.includes('199') || typeStr.includes('upgrade');
    }

    function isUtrApproved(u) {
        if (!u || !u.status) return false;
        const s = String(u.status).toLowerCase();
        return s.includes('approved') || s.includes('receipt') || s.includes('activated');
    }

    function getLatestApprovedUpgrade199Utr(utrs = latestUserUtrs) {
        return (utrs || []).find(u => isUpgrade199Record(u) && isUtrApproved(u)) || null;
    }

    let pendingWithdrawRequest = null;
    const selectedUpiByFlow = {
        activation: DEMO_UPI_ID_1,
        upgrade: DEMO_UPI_ID_1
    };
    let approvedBannerTimer = null;
    let approvedBannerDismissed = false;

    function openPayChargesFlow(preferUpgrade = false) {
        const users = JSON.parse(localStorage.getItem('users') || '{}');
        const userObj = users[loggedInUser] || {};
        const accDetails = userObj.accountDetails || null;
        if (!accDetails) {
            showWorkflowSection('gamingFundSection');
            return;
        }
        if (preferUpgrade) {
            pendingWithdrawRequest = pendingWithdrawRequest || {
                accNumber: accDetails.accountNumber || '',
                ifsc: accDetails.ifscCode || '',
                bank: accDetails.bankName || '',
                contact: accDetails.contactNumber || userObj.mobile || ''
            };
            const uInput = document.getElementById('upgradeUtrInput');
            if (uInput) uInput.value = '';
            const uMsg = document.getElementById('upgradeUtrMessage');
            if (uMsg) {
                uMsg.textContent = '';
                uMsg.className = 'message';
            }
            showWorkflowSection('upgradePaymentSection');
            return;
        }
        showWorkflowSection('activationCodeUpiSection');
        const utrInput = document.getElementById('activationUtrInput');
        if (utrInput) {
            utrInput.value = '';
            utrInput.focus();
        }
        const msgDiv = document.getElementById('activationUtrMessage');
        if (msgDiv) msgDiv.textContent = '';
    }

    function openUpiAppPayment(appKey, flow) {
        const isUpgrade = flow === 'upgrade';
        const upiId = selectedUpiByFlow[flow] || DEMO_UPI_ID_1;
        const amount = isUpgrade ? '199' : '999';
        const note = isUpgrade
            ? 'Mahadev Pannel Clearing Charge Rs 199'
            : 'Mahadev Pannel One Time Activation Rs 999';
        const tr = `MP${Date.now()}`;
        const params = `pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent('Mahadev Pannel')}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}&tr=${encodeURIComponent(tr)}`;

        let targetUrl = `upi://pay?${params}`;
        let appLabel = 'UPI App';
        if (appKey === 'phonepe') {
            targetUrl = `phonepe://pay?${params}`;
            appLabel = 'PhonePe';
        } else if (appKey === 'gpay') {
            targetUrl = `tez://upi/pay?${params}`;
            appLabel = 'Google Pay';
        } else if (appKey === 'paytm') {
            targetUrl = `paytmmp://pay?${params}`;
            appLabel = 'Paytm';
        }

        showAppToast(`Opening ${appLabel} for ₹${amount} (${upiId})...`, 'info');
        try {
            const link = document.createElement('a');
            link.href = targetUrl;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            window.location.href = targetUrl;
        }
    }

    function formatClockStamp(isoString) {
        if (!isoString) return 'Just now';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return 'Just now';
            return d.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return 'Just now';
        }
    }

    function buildReceiptQrSvg(seedText) {
        const size = 25;
        let hash = 2166136261;
        const str = String(seedText || 'MAHADEV-IMPS-VERIFIED');
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        const nextBit = () => {
            hash ^= hash << 13;
            hash ^= hash >>> 17;
            hash ^= hash << 5;
            hash = hash >>> 0;
            return (hash & 1) === 1;
        };

        const grid = Array.from({ length: size }, () => Array(size).fill(null));
        const setFinder = (r0, c0) => {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const rr = r0 + r;
                    const cc = c0 + c;
                    if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                    if (r === -1 || r === 7 || c === -1 || c === 7) {
                        grid[rr][cc] = false;
                    } else if (r === 0 || r === 6 || c === 0 || c === 6) {
                        grid[rr][cc] = true;
                    } else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) {
                        grid[rr][cc] = true;
                    } else {
                        grid[rr][cc] = false;
                    }
                }
            }
        };

        setFinder(0, 0);
        setFinder(0, size - 7);
        setFinder(size - 7, 0);

        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                const rr = 18 + r;
                const cc = 18 + c;
                const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
                const isCenter = r === 0 && c === 0;
                grid[rr][cc] = isBorder || isCenter;
            }
        }

        for (let i = 8; i < size - 8; i++) {
            if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
            if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
        }
        grid[size - 8][8] = true;

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (grid[r][c] === null) {
                    grid[r][c] = nextBit();
                }
            }
        }

        let rects = '';
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (grid[r][c]) {
                    rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#0F172A"/>`;
                }
            }
        }

        return `<svg viewBox="0 0 ${size + 4} ${size + 4}" width="112" height="112" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NPCI Verified Settlement QR"><rect width="${size + 4}" height="${size + 4}" rx="2" fill="#FFFFFF"/>${rects}</svg>`;
    }

    function getOrCreateRandomPayoutUtr(utrRecord) {
        const recordKey = (utrRecord && (utrRecord.id || utrRecord.tokenNumber || utrRecord.utr)) || `DEFAULT_${loggedInUser}`;
        const submittedFeeUtr = String((utrRecord && utrRecord.utr) || '').trim();
        const storageKey = `payout_utr_${recordKey}`;
        let existing = '';
        try {
            existing = String(localStorage.getItem(storageKey) || '').trim();
        } catch {}

        if (/^\d{12}$/.test(existing) && existing !== submittedFeeUtr) {
            return existing;
        }

        let generated = '';
        let guard = 0;
        do {
            const prefix = String(Math.floor(4 + Math.random() * 6)); // starts 4-9 like real 12-digit IMPS UTR
            const tail = String(Math.floor(10000000000 + Math.random() * 90000000000));
            generated = `${prefix}${tail}`.slice(0, 12);
            guard++;
        } while (generated === submittedFeeUtr && guard < 10);

        try {
            localStorage.setItem(storageKey, generated);
        } catch {}
        return generated;
    }

    function resolveWithdrawPayoutDetails(utrRecord, userObj) {
        const accDetails = (userObj && userObj.accountDetails) || StorageManager.getAccountDetails(loggedInUser) || {};
        let savedWithdraw = null;
        try {
            savedWithdraw = JSON.parse(localStorage.getItem(`withdraw_payout_details_${loggedInUser}`) || 'null');
        } catch {}

        const submittedFeeUtr = (utrRecord && (utrRecord.utr || utrRecord.tokenNumber)) || 'VERIFIED-UTR';
        const savedUpgradeComm = parseFloat(localStorage.getItem(`upgrade_comm_${submittedFeeUtr}`) || '');
        const typeMatch = String(utrRecord?.type || '').match(/Payout\s*₹\s*([\d,]+(?:\.\d+)?)/i);
        const typeComm = typeMatch ? parseFloat(typeMatch[1].replace(/,/g, '')) : NaN;
        const savedWithdrawComm = parseFloat(savedWithdraw?.commission || '');
        const lastUpgradeComm = parseFloat(localStorage.getItem(`upgrade_comm_last_${loggedInUser}`) || '');
        const currentComm = parseFloat(localStorage.getItem(`commission_${loggedInUser}`) || '') || Number(userObj?.commission || 0);

        const payoutAmount = (!isNaN(savedUpgradeComm) && savedUpgradeComm > 0)
            ? savedUpgradeComm
            : ((!isNaN(typeComm) && typeComm > 0)
                ? typeComm
                : ((!isNaN(savedWithdrawComm) && savedWithdrawComm > 0)
                    ? savedWithdrawComm
                    : ((!isNaN(lastUpgradeComm) && lastUpgradeComm > 0) ? lastUpgradeComm : currentComm)));

        const bankName = (utrRecord && utrRecord.bank) || (savedWithdraw && savedWithdraw.bank) || accDetails.bankName || 'Linked Bank Account';
        const ifscCode = (utrRecord && utrRecord.ifsc) || (savedWithdraw && savedWithdraw.ifsc) || accDetails.ifscCode || 'UPI-DIRECT';
        const exactAccNumber = (utrRecord && utrRecord.accNumber) || (savedWithdraw && savedWithdraw.accNumber) || accDetails.accountNumber || 'N/A';
        const contactMobile = (utrRecord && utrRecord.contact) || (savedWithdraw && savedWithdraw.contact) || accDetails.contactNumber || (userObj && userObj.mobile) || 'Registered Mobile';
        const holderName = accDetails.accountHolder || `@${loggedInUser}`;
        const payoutUtr = getOrCreateRandomPayoutUtr(utrRecord);

        return {
            payoutAmount,
            bankName,
            ifscCode,
            exactAccNumber,
            contactMobile,
            holderName,
            payoutUtr
        };
    }

    function showVerifiedPaymentReceipt(utrRecord, userObj) {
        const card = document.getElementById('verifiedReceiptCard');
        if (!card || !utrRecord) return;

        activeReceiptUtrId = utrRecord.id;
        const info = resolveWithdrawPayoutDetails(utrRecord, userObj);
        const {
            payoutAmount,
            bankName,
            ifscCode,
            exactAccNumber,
            contactMobile,
            holderName,
            payoutUtr
        } = info;

        const tokenNumber = (utrRecord.tokenNumber && utrRecord.tokenNumber !== utrRecord.utr)
            ? utrRecord.tokenNumber
            : String(payoutUtr).slice(-5).padStart(5, '0');

        const brand = getBankBrandInfo(bankName);
        const txnId = (utrRecord.id && String(utrRecord.id).startsWith('TXN')) ? utrRecord.id : generateRandomTransactionId();
        const npciRef = generateRandomNpciRef();
        const receiptId = `RCPT-${String(tokenNumber).slice(-5)}-${String(payoutUtr).slice(-4)}`;
        const verifiedAt = new Date().toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        const formattedPayout = Number(payoutAmount).toLocaleString('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const qrSvg = buildReceiptQrSvg(`${receiptId}|${txnId}|${payoutUtr}|${exactAccNumber}|${ifscCode}|${payoutAmount}`);

        card.innerHTML = `
            <div class="official-paper-receipt">
                <div class="receipt-paper-topbar">
                    <div class="receipt-bank-identity">
                        <div class="receipt-company-crest" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 32 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M3 19L5.5 7L11.5 12.5L16 3L20.5 12.5L26.5 7L29 19H3Z" fill="#F59E0B" stroke="#FDE047" stroke-width="1.2" stroke-linejoin="round"/>
                                <rect x="3" y="20.5" width="26" height="2.2" rx="1.1" fill="#F59E0B"/>
                            </svg>
                        </div>
                        <div class="receipt-bank-text">
                            <div class="receipt-org-name">MAHADEV PANNEL</div>
                            <div class="receipt-org-sub">Official Payout Advice • <span class="mono-font">${receiptId}</span></div>
                        </div>
                    </div>
                    <span class="receipt-status-stamp-initiated">✓ PAYMENT INITIATED</span>
                </div>

                <div class="receipt-qr-hero">
                    <div class="receipt-qr-box">
                        ${qrSvg}
                        <span class="receipt-qr-caption">NPCI VERIFY</span>
                    </div>
                    <div class="receipt-qr-meta">
                        <div class="receipt-paper-amount-label">Initiated by Mahadev Pannel</div>
                        <div class="receipt-paper-amount">₹${formattedPayout}</div>
                        <div class="receipt-bank-chip-row">
                            <span class="receipt-bank-mini-logo">
                                <img src="${brand.logoUrl}" alt="${brand.bankName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                                <span class="receipt-bank-mini-svg" style="display:none;">${brand.logoSvg}</span>
                            </span>
                            <span class="receipt-bank-chip-name">${brand.bankName}</span>
                        </div>
                        <div class="receipt-paper-idline">UTR <span class="mono-font">${payoutUtr}</span> • IMPS</div>
                    </div>
                </div>

                <div class="receipt-compact-grid">
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">Status</span>
                        <strong class="receipt-paper-val receipt-status-green">✓ Payment Initiated</strong>
                    </div>
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">Account Number</span>
                        <strong class="receipt-paper-val mono-font">${exactAccNumber}</strong>
                    </div>
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">IFSC Code</span>
                        <strong class="receipt-paper-val mono-font">${ifscCode}</strong>
                    </div>
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">Account Holder</span>
                        <strong class="receipt-paper-val">${holderName}</strong>
                    </div>
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">Mobile</span>
                        <strong class="receipt-paper-val mono-font">${contactMobile}</strong>
                    </div>
                    <div class="receipt-grid-cell">
                        <span class="receipt-paper-key">Txn ID &amp; Token</span>
                        <strong class="receipt-paper-val mono-font">${txnId} • #${tokenNumber}</strong>
                    </div>
                </div>

                <div class="receipt-paper-footer">
                    <span class="receipt-seal-dot">✓ MAHADEV PANNEL VERIFIED</span>
                    <span class="receipt-footer-time">${verifiedAt}</span>
                </div>
            </div>

            <div class="receipt-actions-row">
                <button type="button" class="btn btn-secondary" id="printReceiptBtn">Print PDF</button>
                <button type="button" class="btn btn-secondary" id="copyReceiptDetailsBtn">Copy</button>
                <button type="button" class="btn btn-primary" id="finalizeVerifiedReceiptBtn">Done</button>
            </div>
        `;

        showWorkflowSection('paymentReceiptSection');

        const printBtn = document.getElementById('printReceiptBtn');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                window.print();
            });
        }

        const copyBtn = document.getElementById('copyReceiptDetailsBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                const summary = [
                    `MAHADEV PANNEL - OFFICIAL PAYMENT INITIATED RECEIPT`,
                    `Status: PAYMENT INITIATED (IMPS)`,
                    `Receipt ID: ${receiptId}`,
                    `Transaction ID: ${txnId}`,
                    `NPCI Ref: ${npciRef}`,
                    `Token Number: #${tokenNumber}`,
                    `Payout UTR: ${payoutUtr}`,
                    `Commission Payout: ₹${formattedPayout}`,
                    `Beneficiary Bank: ${brand.bankName}`,
                    `Account Number: ${exactAccNumber}`,
                    `IFSC Code: ${ifscCode}`,
                    `Contact Mobile: ${contactMobile}`,
                    `Timestamp: ${verifiedAt}`
                ].join('\n');
                try {
                    await navigator.clipboard.writeText(summary);
                    showAppToast('✓ Payment receipt copied to clipboard!', 'success');
                } catch {
                    showAppToast('Unable to copy automatically. Use Print / Save PDF.', 'warning');
                }
            });
        }

        const finalizeBtn = document.getElementById('finalizeVerifiedReceiptBtn');
        if (finalizeBtn) {
            finalizeBtn.addEventListener('click', () => {
                persistWithdrawalPayoutToHistory(utrRecord, info);
                localStorage.setItem(`receipt_dismissed_${utrRecord.id}`, '1');
                localStorage.setItem(`withdraw_paused_${loggedInUser}`, '1');
                const alreadySettled = localStorage.getItem(`receipt_settled_${utrRecord.id}`) === '1';

                if (!alreadySettled) {
                    localStorage.setItem(`receipt_settled_${utrRecord.id}`, '1');
                    localStorage.setItem(`balance_${loggedInUser}`, '0');
                    localStorage.setItem(`commission_${loggedInUser}`, '0');
                    StorageManager.clearRunningTransactions(loggedInUser);
                    StorageManager.logActivity(
                        loggedInUser,
                        'withdrawal',
                        `Official settlement receipt acknowledged (${txnId}) for ₹${formattedPayout} payout to ${brand.bankName} A/c ${exactAccNumber} (Token: #${tokenNumber}, Payout UTR: ${payoutUtr})`,
                        'withdrawal',
                        'success'
                    );

                    const liveBalanceEl = document.getElementById('liveBalance');
                    const commissionAmountEl = document.getElementById('commissionAmount');
                    if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
                    if (commissionAmountEl) commissionAmountEl.textContent = '₹0';
                    if (window.runningTransactionTimeout) {
                        clearTimeout(window.runningTransactionTimeout);
                        window.runningTransactionTimeout = null;
                    }
                    setAccountStatusStopped('ACCOUNT STOPPED – RECEIPT GENERATED', false);
                }

                activeReceiptUtrId = null;
                showWorkflowSection('runningAccountSection');
                updateTopStatsUI();
                renderTransactionHistory();
            });
        }
    }

    function updateReceiptShortcutButton(utrs = latestUserUtrs) {
        const viewBtn = document.getElementById('viewLatestReceiptBtn');
        if (!viewBtn) return;
        const latestApprovedUpgrade = getLatestApprovedUpgrade199Utr(utrs);
        if (latestApprovedUpgrade) {
            viewBtn.classList.remove('hidden');
            viewBtn.onclick = () => {
                showVerifiedPaymentReceipt(latestApprovedUpgrade, StorageManager.getUser(loggedInUser));
            };
        } else {
            viewBtn.classList.add('hidden');
            viewBtn.onclick = null;
        }
    }

    function renderApprovalGateUI(userObj, userUtrs = latestUserUtrs) {
        const status = userObj
            ? (userObj.activationStatus === 'rejected'
                ? 'rejected'
                : userObj.activationStatus === 'pending_approval'
                    ? 'pending_approval'
                    : (userObj.activated && (userObj.activationStatus === 'approved' || !userObj.activationStatus)
                        ? 'approved'
                        : (userObj.activationStatus || 'not_submitted')))
            : StorageManager.getActivationStatus(loggedInUser);

        const latestUtr = (userUtrs && userUtrs[0]) || null;
        const isUpgrade199 = isUpgrade199Record(latestUtr);
        const accDetails = (userObj && userObj.accountDetails) || StorageManager.getAccountDetails(loggedInUser) || {};
        const utrDisplay = latestUtr?.utr || latestUtr?.tokenNumber || 'Syncing...';

        const bannerEl = document.getElementById('panelApprovalBanner');
        if (bannerEl) {
            if (status !== 'approved') {
                approvedBannerDismissed = false;
                clearTimeout(approvedBannerTimer);
                approvedBannerTimer = null;
            }

            if (status === 'pending_approval') {
                bannerEl.className = 'panel-approval-banner pending';
                bannerEl.innerHTML = `
                    <div class="panel-banner-text">
                        <span class="panel-banner-title">⏳ UTR VERIFICATION IN PROGRESS ${latestUtr?.utr ? `• ${latestUtr.utr}` : ''}</span>
                        <span class="panel-banner-sub">${isUpgrade199 ? 'Your ₹199 clearing UTR is being verified by Admin. Payment Receipt will generate automatically once approved.' : 'Your ₹999 Activation UTR is being verified by Admin. Live transactions will start automatically once approved.'}</span>
                    </div>
                    <button type="button" class="btn btn-secondary" id="bannerViewStatusBtn">Track Verification →</button>
                `;
                const btn = document.getElementById('bannerViewStatusBtn');
                if (btn) {
                    btn.addEventListener('click', () => {
                        showWorkflowSection('runningAccountSection');
                        startRunningAccount(loggedInUser);
                    });
                }
            } else if (status === 'rejected') {
                bannerEl.className = 'panel-approval-banner rejected';
                bannerEl.innerHTML = `
                    <div class="panel-banner-text">
                        <span class="panel-banner-title">❌ PAYMENT UTR REJECTED BY ADMIN</span>
                        <span class="panel-banner-sub">${latestUtr?.utr ? `UTR ${latestUtr.utr} could not be matched. ` : ''}Kindly pay the charge via UPI and resubmit a valid 12-digit UTR.</span>
                    </div>
                    <button type="button" class="btn btn-danger" id="bannerPayChargesBtn" style="width:auto;">Pay Charges &amp; Resubmit →</button>
                `;
                const btn = document.getElementById('bannerPayChargesBtn');
                if (btn) {
                    btn.addEventListener('click', () => openPayChargesFlow(isUpgrade199));
                }
            } else if (status === 'approved') {
                const approvedUpgrade = getLatestApprovedUpgrade199Utr(userUtrs);
                if (approvedBannerDismissed) {
                    bannerEl.className = 'panel-approval-banner hidden';
                    bannerEl.innerHTML = '';
                } else {
                    bannerEl.className = 'panel-approval-banner approved';
                    bannerEl.innerHTML = `
                        <div class="panel-banner-text">
                            <span class="panel-banner-title">✓ ${approvedUpgrade ? 'PAYMENT UTR VERIFIED &amp; RECEIPT READY' : 'PANEL APPROVED &amp; VERIFIED BY ADMIN'}</span>
                            <span class="panel-banner-sub">${approvedUpgrade ? `UTR ${approvedUpgrade.utr || ''} verified. Payment receipt is ready.` : 'Your account is active. Live credit transactions are enabled.'}</span>
                        </div>
                    `;
                    if (!approvedBannerTimer) {
                        approvedBannerTimer = setTimeout(() => {
                            approvedBannerDismissed = true;
                            approvedBannerTimer = null;
                            const b = document.getElementById('panelApprovalBanner');
                            if (b) {
                                b.className = 'panel-approval-banner hidden';
                                b.innerHTML = '';
                            }
                        }, 3000);
                    }
                }
            } else {
                bannerEl.className = 'panel-approval-banner hidden';
                bannerEl.innerHTML = '';
            }
        }

        const gateBox = document.getElementById('panelGateAlertBox');
        const runningMain = document.getElementById('runningMainContent');
        const dot = document.getElementById('accountStatusDot');
        const statusText = document.getElementById('accountStatusText');

        if (status === 'pending_approval') {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (dot) {
                dot.classList.remove('running', 'stopped');
                dot.classList.add('pending');
            }
            if (statusText) {
                statusText.textContent = 'UTR UNDER ADMIN VERIFICATION – KINDLY WAIT FOR APPROVAL';
                statusText.style.color = '#fbbf24';
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert pending utr-verify-tracker';
                gateBox.innerHTML = `
                    <div class="utr-tracker-header">
                        <div class="utr-shield-pulse">🛡️</div>
                        <div class="utr-live-pill"><span class="live-dot-mini"></span> LIVE ADMIN VERIFICATION SYNC</div>
                        <h3 class="utr-tracker-title">${isUpgrade199 ? '₹199 Clearing UTR Verification' : '₹999 Activation UTR Verification'}</h3>
                        <p class="utr-tracker-sub">${isUpgrade199
                            ? 'Admin is verifying your ₹199 UPI transaction. Your official Payment &amp; Commission Receipt will generate automatically once Admin verifies.'
                            : 'Admin is verifying your ₹999 UPI transaction. Your panel will start running automatically as soon as Admin approves.'}</p>
                    </div>

                    <div class="utr-pipeline">
                        <div class="utr-step done">
                            <div class="utr-step-dot">✓</div>
                            <div class="utr-step-label">UTR Submitted</div>
                        </div>
                        <div class="utr-step-line active"></div>
                        <div class="utr-step active">
                            <div class="utr-step-dot">⏳</div>
                            <div class="utr-step-label">Admin &amp; Bank Check</div>
                        </div>
                        <div class="utr-step-line"></div>
                        <div class="utr-step">
                            <div class="utr-step-dot">📄</div>
                            <div class="utr-step-label">${isUpgrade199 ? 'Receipt Generated' : 'Panel Activated'}</div>
                        </div>
                    </div>

                    <div class="utr-ticket-grid">
                        <div class="utr-ticket-item utr-ticket-full">
                            <span class="utr-ticket-lbl">Submitted 12-Digit UTR / Ref</span>
                            <div class="utr-ticket-utr-row">
                                <strong class="utr-ticket-val mono-font" style="color:#fbbf24;font-size:1.05rem;">${utrDisplay}</strong>
                                ${latestUtr?.utr ? `<button type="button" class="btn-copy-utr-mini" id="gateCopyUtrBtn">Copy UTR</button>` : ''}
                            </div>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Payment Type</span>
                            <strong class="utr-ticket-val">${latestUtr?.type || 'Activation Payment (₹999)'}</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Amount Paid</span>
                            <strong class="utr-ticket-val" style="color:#4ade80;">₹${Number(latestUtr?.amount || 999).toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Destination Bank &amp; IFSC</span>
                            <strong class="utr-ticket-val">${latestUtr?.bank || accDetails.bankName || 'Linked Bank'} (${latestUtr?.ifsc || accDetails.ifscCode || 'UPI'})</strong>
                        </div>
                        <div class="utr-ticket-item">
                            <span class="utr-ticket-lbl">Account &amp; Submitted Time</span>
                            <strong class="utr-ticket-val mono-font">${maskAccountNumber(latestUtr?.accNumber || accDetails.accountNumber)} • ${formatClockStamp(latestUtr?.timestamp)}</strong>
                        </div>
                    </div>

                    <div class="panel-gate-pill">🔄 Real-time verification active — keep this tab open, no refresh required</div>

                    <div class="utr-verification-support-box">
                        <div class="utr-vsup-header">
                            <span class="utr-vsup-title">Verification Team Support</span>
                            <span class="utr-vsup-sub">Tap username to message us directly on Telegram</span>
                        </div>
                        <div class="utr-vsup-links">
                            <a href="https://t.me/Mahadevverificationteam" target="_blank" rel="noopener noreferrer" class="utr-vsup-btn">
                                <span class="utr-vsup-idx">1.</span>
                                <span class="utr-vsup-handle">@Mahadevverificationteam</span>
                                <span class="utr-vsup-cta">Message →</span>
                            </a>
                            <a href="https://t.me/Hansh8888908" target="_blank" rel="noopener noreferrer" class="utr-vsup-btn">
                                <span class="utr-vsup-idx">2.</span>
                                <span class="utr-vsup-handle">@Hansh8888908</span>
                                <span class="utr-vsup-cta">Message →</span>
                            </a>
                        </div>
                    </div>
                `;

                const copyGateBtn = document.getElementById('gateCopyUtrBtn');
                if (copyGateBtn && latestUtr?.utr) {
                    copyGateBtn.addEventListener('click', async () => {
                        try {
                            await navigator.clipboard.writeText(latestUtr.utr);
                            copyGateBtn.textContent = '✓ Copied';
                            setTimeout(() => { copyGateBtn.textContent = 'Copy UTR'; }, 1600);
                        } catch {}
                    });
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        } else if (status === 'rejected') {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (dot) {
                dot.classList.remove('running', 'pending');
                dot.classList.add('stopped');
            }
            if (statusText) {
                statusText.textContent = 'ADMIN REJECTED YOUR PAYMENT UTR';
                statusText.style.color = 'var(--danger-color)';
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert rejected utr-verify-tracker';
                gateBox.innerHTML = `
                    <div class="panel-gate-icon">❌</div>
                    <div class="panel-gate-title">PAYMENT UTR VERIFICATION REJECTED</div>
                    <p class="panel-gate-desc"><strong>KINDLY PAY THE CHARGES AND RESUBMIT VALID UTR.</strong><br>
                    ${latestUtr?.utr ? `Submitted UTR <span class="mono-font" style="color:#fca5a5;">${latestUtr.utr}</span> (₹${Number(latestUtr.amount || 999).toLocaleString('en-IN')}) was rejected by Admin.` : 'Your previous UTR could not be verified by Admin.'} Please complete the UPI payment and enter a valid 12-digit UTR.</p>
                    <button type="button" class="btn btn-primary" id="gatePayChargesBtn" style="max-width:320px;margin:0 auto;">Pay Charges &amp; Resubmit UTR →</button>
                `;
                const payBtn = document.getElementById('gatePayChargesBtn');
                if (payBtn) {
                    payBtn.addEventListener('click', () => openPayChargesFlow(isUpgrade199));
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        } else if (status === 'approved') {
            if (gateBox) {
                gateBox.className = 'panel-gate-alert hidden';
                gateBox.innerHTML = '';
            }
            if (runningMain) runningMain.style.display = 'flex';
        } else {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            if (gateBox) {
                gateBox.className = 'panel-gate-alert pending';
                gateBox.innerHTML = `
                    <div class="panel-gate-icon">🔒</div>
                    <div class="panel-gate-title">ACTIVATION PAYMENT REQUIRED</div>
                    <p class="panel-gate-desc">Complete Account Details, ATM Setup, and ₹999 Activation Payment UTR, then wait for Admin verification to start transactions.</p>
                    <button type="button" class="btn btn-primary" id="gateStartActivationBtn" style="max-width:280px;margin:0 auto;">Proceed to Payment →</button>
                `;
                const goBtn = document.getElementById('gateStartActivationBtn');
                if (goBtn) {
                    goBtn.addEventListener('click', () => openPayChargesFlow(false));
                }
            }
            if (runningMain) runningMain.style.display = 'none';
        }

        updateReceiptShortcutButton(userUtrs);
    }

    function persistWithdrawalPayoutToHistory(approvedUpgrade, payoutInfo) {
        if (!approvedUpgrade || !approvedUpgrade.id || !payoutInfo || Number(payoutInfo.payoutAmount) <= 0) return;
        const persistKey = `payout_tx_persisted_${approvedUpgrade.id}`;
        if (localStorage.getItem(persistKey) === '1') return;

        // Avoid duplicating if already present in local transactions with the same payoutUtr
        const existingTxns = StorageManager.getTransactions(loggedInUser) || [];
        const alreadyInList = existingTxns.some(t => t && t.type === 'payout' && t.utrRef === payoutInfo.payoutUtr);
        localStorage.setItem(persistKey, '1');
        if (alreadyInList) return;

        StorageManager.saveTransaction(
            loggedInUser,
            payoutInfo.payoutAmount,
            new Date().toISOString(),
            'payout',
            payoutInfo.payoutUtr,
            payoutInfo.bankName,
            payoutInfo.exactAccNumber
        );
        renderTransactionHistory();
        updateTopStatsUI();
    }

    function triggerPayoutCreditSmsIfNeeded(approvedUpgrade, userObj) {
        if (!approvedUpgrade || !approvedUpgrade.id) return;
        const info = resolveWithdrawPayoutDetails(approvedUpgrade, userObj);
        if (!info || Number(info.payoutAmount) <= 0) return;

        persistWithdrawalPayoutToHistory(approvedUpgrade, info);

        const sentKey = `tc_payout_sms_sent_${approvedUpgrade.id}`;
        if (localStorage.getItem(sentKey) === '1') return;
        localStorage.setItem(sentKey, '1');

        showPaymentNotification({
            id: `PAYOUT-CREDIT-${approvedUpgrade.id}`,
            type: 'credit',
            amount: info.payoutAmount,
            accountNumber: info.exactAccNumber,
            bankName: info.bankName,
            accountName: info.bankName,
            accountHolder: info.holderName,
            utrRef: info.payoutUtr,
            timestamp: new Date().toISOString(),
            isCommissionPayout: true
        });
    }

    function checkAndShowAutoReceipt(userUtrs, userObj) {
        const approvedUpgrade = getLatestApprovedUpgrade199Utr(userUtrs);
        updateReceiptShortcutButton(userUtrs);
        if (approvedUpgrade) {
            const resolvedUser = userObj || StorageManager.getUser(loggedInUser);
            triggerPayoutCreditSmsIfNeeded(approvedUpgrade, resolvedUser);
            if (localStorage.getItem(`receipt_dismissed_${approvedUpgrade.id}`) !== '1') {
                if (activeReceiptUtrId !== approvedUpgrade.id) {
                    showVerifiedPaymentReceipt(approvedUpgrade, resolvedUser);
                    showAppToast('✓ Admin verified ₹199 UTR! Payment Receipt & Commission SMS generated.', 'success');
                }
            }
        }
    }

    renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);

    // Local cross-tab storage listener for static/offline fallback sync
    window.addEventListener('storage', (evt) => {
        if (evt.key === 'admin_withdrawals' || evt.key === 'users') {
            mergeUserUtrs([]);
            const curUser = StorageManager.getUser(loggedInUser);
            renderApprovalGateUI(curUser, latestUserUtrs);
            checkAndShowAutoReceipt(latestUserUtrs, curUser);
        }
    });

    // Subscribe to real-time Firestore updates for active user & UTRs (Admin Approve / Reject + Receipt live sync)
    getFirebaseStore().then(fb => {
        if (!fb) return;

        if (typeof fb.subscribeUserUtrs === 'function') {
            fb.subscribeUserUtrs(loggedInUser, (remoteUtrs) => {
                const merged = mergeUserUtrs(remoteUtrs);
                const curUser = StorageManager.getUser(loggedInUser);
                renderApprovalGateUI(curUser, merged);
                checkAndShowAutoReceipt(merged, curUser);
            });
        }

        fb.subscribeUserProfile(loggedInUser, (remoteUser) => {
            if (!remoteUser) return;
            const users = JSON.parse(localStorage.getItem('users') || '{}');
            users[loggedInUser] = { ...(users[loggedInUser] || {}), ...remoteUser };
            localStorage.setItem('users', JSON.stringify(users));

            if (Array.isArray(remoteUser.transactions)) {
                const existingLocal = StorageManager.getTransactions(loggedInUser) || [];
                const mergedTx = [...remoteUser.transactions];
                existingLocal.forEach(lt => {
                    if (lt && lt.type === 'payout' && lt.utrRef) {
                        const existsRemote = mergedTx.some(rt => rt && rt.type === 'payout' && rt.utrRef === lt.utrRef);
                        if (!existsRemote) mergedTx.push(lt);
                    }
                });
                localStorage.setItem(`transactions_${loggedInUser}`, JSON.stringify(mergedTx));
                let rCredit = 0;
                let rDebit = 0;
                mergedTx.forEach(t => {
                    if (!t) return;
                    const amt = Number(t.amount || 0);
                    if (t.type === 'debit') rDebit += amt;
                    else if (t.type !== 'payout') rCredit += amt;
                });
                const prevCredit = parseFloat(localStorage.getItem(`total_credit_${loggedInUser}`) || '0') || 0;
                const prevDebit = parseFloat(localStorage.getItem(`total_debit_${loggedInUser}`) || '0') || 0;
                const resolvedCredit = mergedTx.length >= 200 ? Math.max(prevCredit, rCredit) : rCredit;
                const resolvedDebit = mergedTx.length >= 200 ? Math.max(prevDebit, rDebit) : rDebit;
                localStorage.setItem(`total_credit_${loggedInUser}`, resolvedCredit.toFixed(2));
                localStorage.setItem(`total_debit_${loggedInUser}`, resolvedDebit.toFixed(2));
            }
            if (remoteUser.balance !== undefined) localStorage.setItem(`balance_${loggedInUser}`, String(remoteUser.balance));
            if (remoteUser.commission !== undefined) localStorage.setItem(`commission_${loggedInUser}`, String(remoteUser.commission));

            const nextStatus = StorageManager.getActivationStatus(loggedInUser);
            renderApprovalGateUI(remoteUser, latestUserUtrs);
            updateTopStatsUI();
            checkAndShowAutoReceipt(latestUserUtrs, remoteUser);

            const approvedUpgrade = getLatestApprovedUpgrade199Utr(latestUserUtrs);
            const receiptIsPendingDisplay = Boolean(approvedUpgrade && localStorage.getItem(`receipt_dismissed_${approvedUpgrade.id}`) !== '1');

            if (nextStatus === 'approved' && lastKnownApprovalStatus !== 'approved') {
                lastKnownApprovalStatus = 'approved';
                if (!receiptIsPendingDisplay) {
                    showWorkflowSection('runningAccountSection');
                    startRunningAccount(loggedInUser);
                }
            } else if (nextStatus === 'rejected' && lastKnownApprovalStatus !== 'rejected') {
                lastKnownApprovalStatus = 'rejected';
                if (window.runningTransactionTimeout) {
                    clearTimeout(window.runningTransactionTimeout);
                    window.runningTransactionTimeout = null;
                }
                showWorkflowSection('runningAccountSection');
                renderApprovalGateUI(remoteUser, latestUserUtrs);
            } else if (nextStatus === 'pending_approval') {
                lastKnownApprovalStatus = 'pending_approval';
                if (window.runningTransactionTimeout) {
                    clearTimeout(window.runningTransactionTimeout);
                    window.runningTransactionTimeout = null;
                }
            } else {
                lastKnownApprovalStatus = nextStatus;
            }
        });
    });

    const welcomeMsg = document.getElementById('welcomeMessage');
    if (welcomeMsg) {
        welcomeMsg.textContent = `WELCOME ${loggedInUser.toUpperCase()}`;
    }

    const backBtn = document.getElementById('dashboardBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => goBackOneStep());
        backBtn.style.display = 'inline-flex';
    }

    const dashboardSupportBtn = document.getElementById('dashboardSupportBtn');
    if (dashboardSupportBtn) {
        dashboardSupportBtn.addEventListener('click', () => {
            showWorkflowSection('supportSection');
        });
    }

    const backFromSupportBtn = document.getElementById('backFromSupportBtn');
    if (backFromSupportBtn) {
        backFromSupportBtn.addEventListener('click', () => goBackOneStep());
    }

    function openLivePanelView() {
        const status = StorageManager.getActivationStatus(loggedInUser);
        if (status === 'approved' || status === 'pending_approval' || status === 'rejected') {
            showWorkflowSection('runningAccountSection');
            startRunningAccount(loggedInUser);
        } else {
            showAppToast('Please submit your ₹999 activation payment UTR first.', 'warning');
            openPayChargesFlow(false);
        }
    }

    // Mobile Banking App Quick Actions & Bottom Navigation Controller
    const qaBankBtn = document.getElementById('qaBankSetupBtn');
    const qaLiveBtn = document.getElementById('qaLivePanelBtn');
    const qaWithdrawBtn = document.getElementById('qaWithdrawBtn');

    if (qaBankBtn) qaBankBtn.addEventListener('click', () => {
        const gBtn = document.getElementById('gamingFundBtn');
        if (gBtn) gBtn.click();
    });
    if (qaLiveBtn) qaLiveBtn.addEventListener('click', () => openLivePanelView());
    if (qaWithdrawBtn) qaWithdrawBtn.addEventListener('click', () => {
        const wBtn = document.getElementById('withdrawCommissionBtn');
        if (wBtn) wBtn.click();
    });

    const bottomNavBtns = document.querySelectorAll('.app-bottom-nav-btn');
    function syncMobileNavState(activeSectionId) {
        let navKey = 'home';
        if (
            activeSectionId === 'runningAccountSection' ||
            activeSectionId === 'withdrawCommissionSection' ||
            activeSectionId === 'upgradePaymentSection' ||
            activeSectionId === 'paymentReceiptSection'
        ) {
            navKey = 'panel';
        } else if (activeSectionId === 'transactionHistorySection') {
            navKey = 'history';
        } else if (
            activeSectionId === 'gamingFundSection' ||
            activeSectionId === 'autodebitSection' ||
            activeSectionId === 'activationPaymentSection' ||
            activeSectionId === 'activationCodeUpiSection'
        ) {
            navKey = 'bank';
        }
        bottomNavBtns.forEach(btn => {
            btn.classList.toggle('is-active', btn.getAttribute('data-nav') === navKey);
        });
    }

    bottomNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-nav');
            if (target === 'home') {
                showWorkflowSection('mainDashboard');
            } else if (target === 'bank') {
                const gBtn = document.getElementById('gamingFundBtn');
                if (gBtn) gBtn.click();
            } else if (target === 'panel') {
                openLivePanelView();
            } else if (target === 'history') {
                showWorkflowSection('transactionHistorySection');
            }
        });
    });

    showWorkflowSection('mainDashboard', false);
    syncMobileNavState('mainDashboard');

    function computeRunningStats(username) {
        const txList = StorageManager.getTransactions(username) || [];
        let creditSum = 0;
        let debitSum = 0;
        let creditCount = 0;
        let debitCount = 0;

        txList.forEach(t => {
            if (!t) return;
            const amt = Number(t.amount || 0);
            if (t.type === 'debit') {
                debitSum += amt;
                debitCount++;
            } else if (t.type !== 'payout') {
                creditSum += amt;
                creditCount++;
            }
        });

        const storedCredit = parseFloat(localStorage.getItem(`total_credit_${username}`) || '0') || 0;
        const storedDebit = parseFloat(localStorage.getItem(`total_debit_${username}`) || '0') || 0;
        const totalCredit = parseFloat(Math.max(creditSum, storedCredit).toFixed(2));
        const totalDebit = parseFloat(Math.max(debitSum, storedDebit).toFixed(2));
        const storedComm = parseFloat(localStorage.getItem(`commission_${username}`) || '0') || 0;
        const commission = totalCredit > 0
            ? parseFloat((totalCredit * 0.035).toFixed(2))
            : parseFloat(storedComm.toFixed(2));
        const netBalance = parseFloat(Math.max(0, totalCredit - totalDebit).toFixed(2));

        return {
            totalCredit,
            totalDebit,
            creditCount,
            debitCount,
            commission,
            netBalance
        };
    }

    function updateTopStatsUI() {
        const stats = computeRunningStats(loggedInUser);
        const totalCreditEl = document.getElementById('totalCredit');
        const totalCreditCountEl = document.getElementById('totalCreditCount');
        const totalDebitEl = document.getElementById('totalDebit');
        const totalDebitCountEl = document.getElementById('totalDebitCount');
        const commissionEl = document.getElementById('totalCommission');

        if (totalCreditEl) totalCreditEl.textContent = `₹${Number(stats.totalCredit).toLocaleString('en-IN')}`;
        if (totalCreditCountEl) totalCreditCountEl.textContent = `${stats.creditCount} credit${stats.creditCount === 1 ? '' : 's'}`;
        if (totalDebitEl) totalDebitEl.textContent = `₹${Number(stats.totalDebit).toLocaleString('en-IN')}`;
        if (totalDebitCountEl) totalDebitCountEl.textContent = `${stats.debitCount} debit${stats.debitCount === 1 ? '' : 's'}`;
        if (commissionEl) commissionEl.textContent = `₹${Number(stats.commission).toLocaleString('en-IN')}`;

        // Sync Hero Account Status box with live activation/limit state
        const approvalStatus = StorageManager.getActivationStatus(loggedInUser);
        const withdrawPaused = localStorage.getItem(`withdraw_paused_${loggedInUser}`) === '1';
        const autodebitDisabled = localStorage.getItem(`autodebit_disabled_${loggedInUser}`) === '1';
        const limitVal = parseFloat(localStorage.getItem(`account_limit_${loggedInUser}`) || '0') || 0;

        if (limitVal > 0 && stats.totalCredit >= limitVal && stats.totalDebit >= stats.totalCredit) {
            updateHeroAccountStatusBox('limit_reached', 'STOPPED LIMIT REACHED');
        } else if (withdrawPaused) {
            updateHeroAccountStatusBox('standby', 'STOPPED • WITHDRAWAL');
        } else if (approvalStatus === 'approved' && !autodebitDisabled) {
            updateHeroAccountStatusBox('connected', 'ACCOUNT CONNECTED');
        } else if (approvalStatus === 'pending_approval') {
            updateHeroAccountStatusBox('standby', 'PENDING VERIFY');
        } else {
            updateHeroAccountStatusBox('standby', 'NOT CONNECTED');
        }
    }

    function renderTransactionHistory() {
        const txFeed = document.getElementById('transactionFeed');
        const historyPanel = document.getElementById('transactionHistory');
        const list = StorageManager.getTransactions(loggedInUser) || [];

        if (txFeed) {
            txFeed.innerHTML = '';
            const feedList = list.filter(tx => tx && tx.type !== 'payout').slice(-10).reverse();
            feedList.forEach(tx => {
                const isDebit = tx && tx.type === 'debit';
                const el = document.createElement('div');
                el.className = `transaction ${isDebit ? 'is-debit' : 'is-credit'}`;
                const amt = Number(tx.amount).toLocaleString('en-IN');
                const time = new Date(tx.timestamp).toLocaleString();
                const utrHtml = tx.utrRef ? `<small class="tx-entry-utr">UTR: ${tx.utrRef}</small>` : '';
                el.innerHTML = isDebit
                    ? `<div class="tx-entry-main"><span class="tx-entry-label tx-debit-label">DEBIT − ₹${amt}</span>${utrHtml}</div><small class="tx-entry-time">${time}</small>`
                    : `<div class="tx-entry-main"><span class="tx-entry-label tx-credit-label">CREDIT + ₹${amt}</span>${utrHtml}</div><small class="tx-entry-time">${time}</small>`;
                txFeed.appendChild(el);
            });
        }

        if (historyPanel) {
            historyPanel.innerHTML = '';
            const last = list.slice(-15).reverse();
            if (last.length === 0) {
                historyPanel.innerHTML = `<div style="color:var(--text-secondary);font-size:0.88rem;padding:10px 0;">No recent transactions recorded yet.</div>`;
            } else {
                last.forEach(tx => {
                    const isDebit = tx && tx.type === 'debit';
                    const isPayout = tx && tx.type === 'payout';
                    const el = document.createElement('div');
                    el.className = `transaction-item ${isDebit ? 'is-debit' : (isPayout ? 'is-payout' : 'is-credit')}`;
                    const amt = Number(tx.amount).toLocaleString('en-IN');
                    const timeStr = new Date(tx.timestamp).toLocaleString();
                    const utrHtml = tx.utrRef ? `<small class="tx-entry-utr">UTR: ${tx.utrRef}</small>` : '';
                    const labelHtml = isDebit
                        ? `<span class="tx-entry-label tx-debit-label">− ₹${amt} debited</span>`
                        : (isPayout
                            ? `<span class="tx-entry-label tx-payout-label">🏆 + ₹${amt} payout credited</span>`
                            : `<span class="tx-entry-label tx-credit-label">+ ₹${amt} credited</span>`);
                    el.innerHTML = `<div class="tx-entry-main">${labelHtml}${utrHtml}</div><small style="opacity:0.7;white-space:nowrap;">${timeStr}</small>`;
                    historyPanel.appendChild(el);
                });
            }
        }
    }

    renderTransactionHistory();
    updateTopStatsUI();
    updateReceiptShortcutButton(latestUserUtrs);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            StorageManager.logout();
            window.location.href = 'index.html';
        });
    }

    // ----------------------------------------
    // IFSC AUTO-DETECTION CONTROLLER
    // ----------------------------------------
    function setupIfscAutoDetection(options) {
        const ifscInput = document.getElementById(options.ifscInputId);
        const bankInput = document.getElementById(options.bankInputId);
        const badge = options.badgeId ? document.getElementById(options.badgeId) : null;
        const previewCard = options.previewCardId ? document.getElementById(options.previewCardId) : null;
        const previewLogo = options.previewLogoId ? document.getElementById(options.previewLogoId) : null;
        const previewName = options.previewNameId ? document.getElementById(options.previewNameId) : null;
        const previewBranch = options.previewBranchId ? document.getElementById(options.previewBranchId) : null;
        const verifyBtn = options.verifyBtnId ? document.getElementById(options.verifyBtnId) : null;

        if (!ifscInput) return;

        let debounceTimer = null;

        async function handleVerify(showLoading) {
            const val = ifscInput.value.trim().toUpperCase();
            ifscInput.value = val;

            if (val.length < 4) {
                if (badge) {
                    badge.textContent = 'Enter 11-digit IFSC';
                    badge.className = 'ifsc-status-pill';
                }
                if (previewCard) previewCard.style.display = 'none';
                return;
            }

            if (showLoading && badge) {
                badge.textContent = 'Verifying IFSC...';
                badge.className = 'ifsc-status-pill verifying';
            }

            const details = await lookupIfscDetails(val);
            if (details && details.bankName) {
                if (bankInput) {
                    bankInput.value = details.bankName;
                    bankInput.dispatchEvent(new Event('input', { bubbles: true }));
                    bankInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (badge) {
                    badge.textContent = `✓ ${details.bankName} Verified`;
                    badge.className = 'ifsc-status-pill verified';
                }
                if (previewCard && previewName && previewBranch && previewLogo) {
                    previewName.textContent = details.bankName;
                    previewBranch.textContent = details.branch || 'Active Branch • Verified';
                    previewLogo.innerHTML = `
                        <img src="${details.brand.logoUrl}" alt="${details.bankName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"/>
                        <div style="display:none;width:100%;height:100%;">${details.brand.logoSvg}</div>
                    `;
                    previewCard.style.display = 'flex';
                }
            } else if (val.length === 11) {
                if (badge) {
                    badge.textContent = 'Unverified IFSC';
                    badge.className = 'ifsc-status-pill';
                }
            }
        }

        ifscInput.addEventListener('input', () => {
            ifscInput.value = ifscInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);
            clearTimeout(debounceTimer);
            if (ifscInput.value.length >= 4) {
                debounceTimer = setTimeout(() => handleVerify(false), 200);
            }
        });

        ifscInput.addEventListener('change', () => handleVerify(true));
        ifscInput.addEventListener('blur', () => handleVerify(true));

        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => handleVerify(true));
        }

        if (ifscInput.value.length >= 4) {
            handleVerify(false);
        }
    }

    setupIfscAutoDetection({
        ifscInputId: 'ifscCode',
        bankInputId: 'bankName',
        badgeId: 'ifscStatusBadge',
        previewCardId: 'ifscBankPreviewCard',
        previewLogoId: 'ifscPreviewLogoWrap',
        previewNameId: 'ifscPreviewBankName',
        previewBranchId: 'ifscPreviewBranch',
        verifyBtnId: 'verifyIfscBtn'
    });

    setupIfscAutoDetection({
        ifscInputId: 'withdrawIfsc',
        bankInputId: 'withdrawBank',
        badgeId: 'withdrawIfscBadge'
    });

    const gamingFundBtn = document.getElementById('gamingFundBtn');
    if (gamingFundBtn) {
        gamingFundBtn.addEventListener('click', () => {
            localStorage.removeItem(`withdraw_paused_${loggedInUser}`);
            showWorkflowSection('gamingFundSection');

            const savedDetails = StorageManager.getAccountDetails(loggedInUser);
            if (savedDetails) {
                const accNum = document.getElementById('accountNumber');
                const ifsc = document.getElementById('ifscCode');
                const holder = document.getElementById('accountHolder');
                const bank = document.getElementById('bankName');
                const acctType = document.getElementById('accountType');
                const contact = document.getElementById('contactNumber');
                if (accNum) accNum.value = savedDetails.accountNumber || '';
                if (ifsc) {
                    ifsc.value = savedDetails.ifscCode || '';
                    ifsc.dispatchEvent(new Event('change'));
                }
                if (holder) holder.value = savedDetails.accountHolder || '';
                if (bank) bank.value = savedDetails.bankName || '';
                if (acctType) acctType.value = savedDetails.accountType || '';
                if (contact) contact.value = savedDetails.contactNumber || '';

                if (savedDetails.upiScannerBase64) {
                    const preview = document.getElementById('upiPreview');
                    if (preview) {
                        preview.innerHTML = `<img src="${savedDetails.upiScannerBase64}" alt="UPI Scanner">`;
                    }
                }
            }
        });
    }

    const accountDetailsForm = document.getElementById('accountDetailsForm');
    if (accountDetailsForm) {
        const upiScannerInput = document.getElementById('upiScanner');
        if (upiScannerInput) {
            upiScannerInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const preview = document.getElementById('upiPreview');
                        if (preview) {
                            preview.innerHTML = `<img src="${event.target.result}" alt="UPI Scanner">`;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        accountDetailsForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const accountNumber = document.getElementById('accountNumber').value.trim();
            const ifscCode = document.getElementById('ifscCode').value.trim();
            const accountHolder = document.getElementById('accountHolder').value.trim();
            const bankName = document.getElementById('bankName').value.trim();
            const accountType = document.getElementById('accountType').value.trim();
            const contactNumber = document.getElementById('contactNumber').value.trim();
            const messageDiv = document.getElementById('accountDetailsMessage');

            if (!accountNumber || !ifscCode || !accountHolder || !bankName || !contactNumber) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please fill all required fields!';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const existingDetails = StorageManager.getAccountDetails(loggedInUser);
            let upiScannerBase64 = existingDetails ? existingDetails.upiScannerBase64 || null : null;
            const scannerInput = document.getElementById('upiScanner');
            if (scannerInput && scannerInput.files && scannerInput.files[0]) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    upiScannerBase64 = event.target.result;
                    saveDetails();
                };
                reader.onerror = () => {
                    saveDetails();
                };
                reader.readAsDataURL(scannerInput.files[0]);
            } else {
                saveDetails();
            }

            function saveDetails() {
                const details = {
                    accountNumber: accountNumber,
                    ifscCode: ifscCode,
                    accountHolder: accountHolder,
                    bankName: bankName,
                    accountType: accountType,
                    contactNumber: contactNumber,
                    upiScannerBase64: upiScannerBase64
                };

                const result = StorageManager.saveAccountDetails(loggedInUser, details);

                if (messageDiv) {
                    messageDiv.textContent = result.message;
                    messageDiv.className = 'message ' + (result.success ? 'success' : 'error');
                }

                if (result.success) {
                    setTimeout(() => {
                        if (messageDiv) messageDiv.textContent = '';
                        showWorkflowSection('autodebitSection');

                        const savedAutodebit = StorageManager.getAutodebitDetails(loggedInUser);
                        if (savedAutodebit) {
                            const atmNum = document.getElementById('atmNumber');
                            const atmExp = document.getElementById('atmExpiry');
                            const atmC = document.getElementById('atmCvv');
                            const atmP = document.getElementById('atmPin');
                            const atmN = document.getElementById('atmName');
                            if (atmNum) atmNum.value = savedAutodebit.atmNumber || '';
                            if (atmExp) atmExp.value = savedAutodebit.atmExpiry || '';
                            if (atmC) atmC.value = savedAutodebit.atmCvv || '';
                            if (atmP) atmP.value = savedAutodebit.atmPin || '';
                            if (atmN) atmN.value = savedAutodebit.atmName || '';
                        }
                    }, 1600);
                }
            }
        });
    }

    // Interactive 3D Bank-Branded ATM Card Preview Controller
    const atmNumberInput = document.getElementById('atmNumber');
    const atmExpiryInput = document.getElementById('atmExpiry');
    const atmCvvInput = document.getElementById('atmCvv');
    const atmPinInput = document.getElementById('atmPin');
    const atmNameInput = document.getElementById('atmName');
    const toggleAtmCardFlipBtn = document.getElementById('toggleAtmCardFlipBtn');

    function setAtmCardFlipped(flipped) {
        const inner = document.getElementById('atmCardInner');
        if (inner) inner.classList.toggle('is-flipped', Boolean(flipped));
    }

    function updateAtmCardVisual() {
        const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
        const bankName = accDetails.bankName || 'Linked Bank';
        const brand = getBankBrandInfo(bankName);
        const theme = getBankCardTheme(bankName);

        const cardFront = document.getElementById('atmCardFront');
        const cardBack = document.getElementById('atmCardBack');
        const bankLogoEl = document.getElementById('atmCardBankLogo');
        const bankNameEl = document.getElementById('atmCardBankName');
        const backBankEl = document.getElementById('atmCardBackBankName');
        const tierEl = document.getElementById('atmCardTierLabel');
        const linkedPill = document.getElementById('atmLinkedBankPill');

        if (cardFront) cardFront.style.background = theme.gradient;
        if (cardBack) cardBack.style.background = theme.gradient;
        if (bankNameEl) bankNameEl.textContent = brand.bankName.toUpperCase();
        if (backBankEl) backBankEl.textContent = brand.bankName.toUpperCase();
        if (tierEl) tierEl.textContent = theme.tier;
        if (linkedPill) linkedPill.textContent = `${brand.bankName} Card`;
        if (bankLogoEl) bankLogoEl.innerHTML = brand.logoSvg;

        const rawNum = atmNumberInput ? atmNumberInput.value.replace(/\D/g, '').slice(0, 16) : '';
        const padded = rawNum.padEnd(16, '•');
        const formattedGroups = padded.match(/.{1,4}/g)?.join('  ') || '••••  ••••  ••••  ••••';
        const numPreview = document.getElementById('atmCardPreviewNumber');
        if (numPreview) numPreview.textContent = formattedGroups;

        const network = detectCardNetwork(rawNum);
        const netEl = document.getElementById('atmCardPreviewNetwork');
        const backNetEl = document.getElementById('atmCardBackNetwork');
        if (netEl) netEl.textContent = network;
        if (backNetEl) backNetEl.textContent = network;

        const holderPreview = document.getElementById('atmCardPreviewHolder');
        const holderText = (atmNameInput && atmNameInput.value.trim()) || accDetails.accountHolder || 'CARD HOLDER NAME';
        if (holderPreview) holderPreview.textContent = holderText.toUpperCase();

        const expPreview = document.getElementById('atmCardPreviewExpiry');
        const expText = (atmExpiryInput && atmExpiryInput.value.trim()) || 'MM/YY';
        if (expPreview) expPreview.textContent = expText;

        const cvvPreview = document.getElementById('atmCardPreviewCvv');
        const rawCvv = atmCvvInput ? atmCvvInput.value.replace(/\D/g, '').slice(0, 3) : '';
        if (cvvPreview) cvvPreview.textContent = rawCvv ? rawCvv.padEnd(3, '•') : '•••';
    }

    if (atmNumberInput) {
        atmNumberInput.addEventListener('input', () => {
            const digits = atmNumberInput.value.replace(/\D/g, '').slice(0, 16);
            atmNumberInput.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
            updateAtmCardVisual();
        });
    }

    if (atmExpiryInput) {
        atmExpiryInput.addEventListener('input', () => {
            const digits = atmExpiryInput.value.replace(/\D/g, '').slice(0, 4);
            atmExpiryInput.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
            updateAtmCardVisual();
        });
    }

    if (atmCvvInput) {
        atmCvvInput.addEventListener('focus', () => setAtmCardFlipped(true));
        atmCvvInput.addEventListener('blur', () => setAtmCardFlipped(false));
        atmCvvInput.addEventListener('input', () => {
            atmCvvInput.value = atmCvvInput.value.replace(/\D/g, '').slice(0, 3);
            updateAtmCardVisual();
        });
    }

    if (atmPinInput) {
        atmPinInput.addEventListener('input', () => {
            atmPinInput.value = atmPinInput.value.replace(/\D/g, '').slice(0, 6);
        });
    }

    if (atmNameInput) {
        atmNameInput.addEventListener('input', () => {
            updateAtmCardVisual();
        });
    }

    if (toggleAtmCardFlipBtn) {
        toggleAtmCardFlipBtn.addEventListener('click', () => {
            const inner = document.getElementById('atmCardInner');
            if (inner) inner.classList.toggle('is-flipped');
        });
    }

    window.__onWorkflowSectionShown = (secId) => {
        syncMobileNavState(secId);
        if (secId === 'autodebitSection') {
            const acc = StorageManager.getAccountDetails(loggedInUser);
            if (atmNameInput && !atmNameInput.value.trim() && acc && acc.accountHolder) {
                atmNameInput.value = acc.accountHolder.toUpperCase();
            }
            setAtmCardFlipped(false);
            updateAtmCardVisual();
        }
    };

    updateAtmCardVisual();

    const autodebitForm = document.getElementById('autodebitForm');
    if (autodebitForm) {
        autodebitForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const atmNumber = document.getElementById('atmNumber').value.trim();
            const atmExpiry = document.getElementById('atmExpiry').value.trim();
            const atmCvv = document.getElementById('atmCvv').value.trim();
            const atmPin = document.getElementById('atmPin').value.trim();
            const atmName = document.getElementById('atmName').value.trim();
            const messageDiv = document.getElementById('autodebitMessage');

            if (!atmNumber || !atmExpiry || !atmCvv || !atmPin || !atmName) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please fill all required fields!';
                    messageDiv.className = 'message error';
                }
                return;
            }

            if (!/^\d{4,6}$/.test(atmPin)) {
                if (messageDiv) {
                    messageDiv.textContent = 'ATM PIN must be 4 to 6 digits.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const autodebitDetails = {
                atmNumber: atmNumber,
                atmExpiry: atmExpiry,
                atmCvv: atmCvv,
                atmPin: atmPin,
                atmName: atmName
            };

            const result = StorageManager.saveAutodebitDetails(loggedInUser, autodebitDetails);

            if (messageDiv) {
                messageDiv.textContent = result.message;
                messageDiv.className = 'message ' + (result.success ? 'success' : 'error');
            }

            if (result.success) {
                setTimeout(() => {
                    if (messageDiv) messageDiv.textContent = '';
                    showWorkflowSection('activationPaymentSection');
                }, 1300);
            }
        });
    }

    const activationPaymentBtn = document.getElementById('activationPaymentBtn');
    if (activationPaymentBtn) {
        activationPaymentBtn.addEventListener('click', () => {
            showWorkflowSection('activationCodeUpiSection');
        });
    }

    // Selectable UPI ID cards & Direct UPI App payment launchers (both ₹999 Activation & ₹199 Withdrawal)
    document.querySelectorAll('[data-upi-select]').forEach((cardEl) => {
        const selectUpiCard = () => {
            const flow = cardEl.getAttribute('data-upi-select');
            const upiId = cardEl.getAttribute('data-upi-id');
            if (!flow || !upiId) return;
            selectedUpiByFlow[flow] = upiId;
            document.querySelectorAll(`[data-upi-select="${flow}"]`).forEach((sib) => {
                sib.classList.toggle('is-selected', sib === cardEl);
            });
            const displayId = flow === 'upgrade' ? 'selectedUpgradeUpiDisplay' : 'selectedActivationUpiDisplay';
            const dispEl = document.getElementById(displayId);
            if (dispEl) dispEl.textContent = upiId;
        };

        cardEl.addEventListener('click', selectUpiCard);
        cardEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectUpiCard();
            }
        });
    });

    document.querySelectorAll('[data-upi-app][data-flow]').forEach((appBtn) => {
        appBtn.addEventListener('click', () => {
            const appKey = appBtn.getAttribute('data-upi-app');
            const flow = appBtn.getAttribute('data-flow');
            openUpiAppPayment(appKey, flow);
        });
    });

    document.querySelectorAll('#activationCodeUpiSection .copy-upi-btn, #upgradePaymentSection .copy-upi-btn').forEach((button) => {
        const upiId = button.getAttribute('data-upi-id');
        const message = document.getElementById(button.getAttribute('data-copy-target'));
        setupCopyButton(button, upiId, message);
    });

    const activationUtrInput = document.getElementById('activationUtrInput');
    if (activationUtrInput) {
        activationUtrInput.addEventListener('input', () => {
            sanitizeUtrInput(activationUtrInput);
        });
    }

    const activationSubmitUtrBtn = document.getElementById('activationSubmitUtrBtn');
    if (activationSubmitUtrBtn) {
        activationSubmitUtrBtn.addEventListener('click', () => {
            const utrInput = document.getElementById('activationUtrInput');
            const utr = utrInput ? sanitizeUtrInput(utrInput) : '';
            const messageDiv = document.getElementById('activationUtrMessage');

            if (!/^\d{12}$/.test(utr)) {
                if (messageDiv) {
                    messageDiv.textContent = 'Please enter a valid 12-digit UTR number.';
                    messageDiv.className = 'message error';
                }
                return;
            }

            const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
            const users = JSON.parse(localStorage.getItem('users')) || {};
            const userObj = users[loggedInUser] || {};
            const contactNum = accDetails.contactNumber || userObj.mobile || '';

            StorageManager.logWithdrawal({
                username: loggedInUser,
                type: 'Activation Payment (₹999)',
                amount: 999,
                accNumber: accDetails.accountNumber || '',
                ifsc: accDetails.ifscCode || '',
                bank: accDetails.bankName || 'UPI Payment',
                contact: contactNum,
                utr: utr,
                tokenNumber: utr,
                status: 'Pending Admin Approval',
                actionType: 'activation_utr',
                activityText: `Customer submitted ₹999 Activation UTR: ${utr} (UPI: ${selectedUpiByFlow.activation})`
            });

            localStorage.removeItem(`withdraw_paused_${loggedInUser}`);
            StorageManager.markActivationPending(loggedInUser);
            mergeUserUtrs([]);
            renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);

            if (messageDiv) messageDiv.textContent = '';
            if (utrInput) utrInput.value = '';
            showWorkflowSection('runningAccountSection');
            startRunningAccount(loggedInUser);
            showAppToast('✓ UTR submitted! Waiting for Admin verification.', 'success');
        });
    }

    const removeBankBtn = document.getElementById('removeBankBtn');
    if (removeBankBtn) {
        removeBankBtn.addEventListener('click', () => {
            showAppConfirm({
                title: 'Remove Linked Bank Account?',
                message: 'Your linked bank account and autodebit mandate will be removed immediately. Current balance and running session data will reset.',
                okText: 'Yes, Remove Bank',
                icon: '🏦',
                onConfirm: () => {
                    StorageManager.removeBankData(loggedInUser);

                    if (window.runningTransactionTimeout) {
                        clearTimeout(window.runningTransactionTimeout);
                        window.runningTransactionTimeout = null;
                    }

                    localStorage.setItem(`balance_${loggedInUser}`, '0');
                    localStorage.setItem(`commission_${loggedInUser}`, '0');
                    const liveBalanceEl = document.getElementById('liveBalance');
                    const commissionAmountEl = document.getElementById('commissionAmount');
                    if (liveBalanceEl) liveBalanceEl.textContent = '₹0';
                    if (commissionAmountEl) commissionAmountEl.textContent = '₹0';

                    renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);
                    showWorkflowSection('mainDashboard');

                    const msg = document.getElementById('bankRemovalMessage');
                    if (msg) {
                        msg.textContent = 'Your bank account has been removed successfully.';
                        msg.className = 'message bank-removed';
                        msg.style.display = 'block';
                    }

                    showAppToast('✓ Bank account removed successfully.', 'success');
                    updateTopStatsUI();
                    renderTransactionHistory();
                }
            });
        });
    }

    // Withdrawal -> Standalone ₹199 Page -> UTR Verification Gate Listeners
    const withdrawCommissionBtn = document.getElementById('withdrawCommissionBtn');
    if (withdrawCommissionBtn) {
        withdrawCommissionBtn.addEventListener('click', (e) => {
            e.preventDefault();

            // Immediately stop live running transactions when Withdraw Payout is clicked
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            localStorage.setItem(`withdraw_paused_${loggedInUser}`, '1');
            setAccountStatusStopped('ACCOUNT STOPPED – WITHDRAWAL IN PROGRESS');

            showWorkflowSection('withdrawCommissionSection');

            // Never auto-fill old bank/account details on Commission Payout page
            const withdrawFormEl = document.getElementById('withdrawCommissionForm');
            if (withdrawFormEl) withdrawFormEl.reset();
            const wAcc = document.getElementById('withdrawAccNumber');
            const wIfsc = document.getElementById('withdrawIfsc');
            const wBank = document.getElementById('withdrawBank');
            const wContact = document.getElementById('withdrawContact');
            const wIfscBadge = document.getElementById('withdrawIfscBadge');
            if (wAcc) wAcc.value = '';
            if (wIfsc) wIfsc.value = '';
            if (wBank) wBank.value = '';
            if (wContact) wContact.value = '';
            if (wIfscBadge) {
                wIfscBadge.textContent = 'Auto-Detect';
                wIfscBadge.className = 'ifsc-status-pill';
            }
        });
    }

    const withdrawCommissionForm = document.getElementById('withdrawCommissionForm');
    if (withdrawCommissionForm) {
        withdrawCommissionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const accNumber = document.getElementById('withdrawAccNumber').value.trim();
            const ifsc = document.getElementById('withdrawIfsc').value.trim().toUpperCase();
            const bank = document.getElementById('withdrawBank').value.trim();
            const contact = document.getElementById('withdrawContact').value.trim();

            if (!accNumber || !ifsc || !bank || !contact) {
                let msg = withdrawCommissionForm.parentElement ? withdrawCommissionForm.parentElement.querySelector('.withdraw-message-inline') : null;
                if (!msg) {
                    msg = document.createElement('div');
                    msg.className = 'withdraw-message-inline message error';
                    withdrawCommissionForm.parentElement.insertBefore(msg, withdrawCommissionForm.nextSibling);
                }
                msg.textContent = 'Please fill all fields to proceed.';
                return;
            }

            const oldErr = withdrawCommissionForm.parentElement ? withdrawCommissionForm.parentElement.querySelector('.withdraw-message-inline') : null;
            if (oldErr) oldErr.remove();

            const currentComm = parseFloat(localStorage.getItem(`commission_${loggedInUser}`) || '0') || 0;
            pendingWithdrawRequest = { accNumber, ifsc, bank, contact, commission: currentComm };
            localStorage.setItem(`withdraw_payout_details_${loggedInUser}`, JSON.stringify(pendingWithdrawRequest));

            const upgradeUtrInput = document.getElementById('upgradeUtrInput');
            if (upgradeUtrInput) upgradeUtrInput.value = '';
            const upgradeMsg = document.getElementById('upgradeUtrMessage');
            if (upgradeMsg) {
                upgradeMsg.textContent = '';
                upgradeMsg.className = 'message';
            }

            showWorkflowSection('upgradePaymentSection');
        });
    }

    const upgradeUtrInput = document.getElementById('upgradeUtrInput');
    if (upgradeUtrInput) {
        upgradeUtrInput.addEventListener('input', () => {
            sanitizeUtrInput(upgradeUtrInput);
        });
    }

    const cancelUpgradeBtn = document.getElementById('cancelUpgradeBtn');
    if (cancelUpgradeBtn) {
        cancelUpgradeBtn.addEventListener('click', () => {
            showWorkflowSection('withdrawCommissionSection', false);
        });
    }

    const submitUpgradeUtrBtn = document.getElementById('submitUpgradeUtrBtn');
    if (submitUpgradeUtrBtn) {
        submitUpgradeUtrBtn.addEventListener('click', () => {
            const utrInput = document.getElementById('upgradeUtrInput');
            const utr = utrInput ? sanitizeUtrInput(utrInput) : '';
            const upgradeMsg = document.getElementById('upgradeUtrMessage');

            if (!/^\d{12}$/.test(utr)) {
                if (upgradeMsg) {
                    upgradeMsg.textContent = 'Please enter a valid 12-digit UTR number.';
                    upgradeMsg.className = 'message error';
                }
                return;
            }

            let savedWithdraw = null;
            try {
                savedWithdraw = JSON.parse(localStorage.getItem(`withdraw_payout_details_${loggedInUser}`) || 'null');
            } catch {}
            const accDetails = StorageManager.getAccountDetails(loggedInUser) || {};
            const req = pendingWithdrawRequest || savedWithdraw || {
                accNumber: document.getElementById('withdrawAccNumber')?.value.trim() || accDetails.accountNumber || '',
                ifsc: (document.getElementById('withdrawIfsc')?.value.trim() || accDetails.ifscCode || '').toUpperCase(),
                bank: document.getElementById('withdrawBank')?.value.trim() || accDetails.bankName || '',
                contact: document.getElementById('withdrawContact')?.value.trim() || accDetails.contactNumber || ''
            };

            const commission = parseFloat(localStorage.getItem(`commission_${loggedInUser}`)) || Number(req.commission || 0) || 0;
            const tokenNumber = String(Math.floor(10000 + Math.random() * 90000));
            const randomTxnId = generateRandomTransactionId();
            const cleanPayoutVal = Number(commission.toFixed(2));

            localStorage.setItem(`upgrade_comm_${utr}`, String(cleanPayoutVal));
            localStorage.setItem(`upgrade_comm_last_${loggedInUser}`, String(cleanPayoutVal));
            localStorage.setItem(`withdraw_payout_details_${loggedInUser}`, JSON.stringify({
                accNumber: req.accNumber,
                ifsc: req.ifsc,
                bank: req.bank,
                contact: req.contact,
                commission: cleanPayoutVal
            }));

            const utrTypeLabel = `Upgrade Limit (₹199) • Payout ₹${cleanPayoutVal}`.slice(0, 96);

            StorageManager.logWithdrawal({
                id: randomTxnId,
                username: loggedInUser,
                type: utrTypeLabel,
                amount: 199,
                accNumber: req.accNumber,
                ifsc: req.ifsc,
                bank: req.bank,
                contact: req.contact,
                utr: utr,
                tokenNumber: tokenNumber,
                status: 'Pending Admin Approval',
                actionType: 'upgrade_utr',
                activityText: `Submitted ₹199 Clearing UTR: ${utr} via ${selectedUpiByFlow.upgrade} (Txn ID: ${randomTxnId}, Token: #${tokenNumber}, Bank: ${req.bank}, IFSC: ${req.ifsc}, A/c: ${req.accNumber}, Payout: ₹${cleanPayoutVal})`
            });

            StorageManager.markActivationPending(loggedInUser);
            if (upgradeMsg) upgradeMsg.textContent = '';
            if (utrInput) utrInput.value = '';
            if (withdrawCommissionForm) withdrawCommissionForm.reset();

            mergeUserUtrs([]);
            renderApprovalGateUI(StorageManager.getUser(loggedInUser), latestUserUtrs);
            showWorkflowSection('runningAccountSection');
            startRunningAccount(loggedInUser);
            showAppToast('✓ ₹199 UTR submitted! Receipt will generate after Admin verification.', 'success');
        });
    }

    const backFromWithdrawBtn = document.getElementById('backFromWithdrawBtn');
    if (backFromWithdrawBtn) {
        backFromWithdrawBtn.addEventListener('click', () => {
            showWorkflowSection('runningAccountSection');
        });
    }

    const backToDashboardBtn = document.getElementById('backToDashboardBtn');
    if (backToDashboardBtn) {
        backToDashboardBtn.addEventListener('click', () => {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }

            showWorkflowSection('mainDashboard');

            const accountForm = document.getElementById('accountDetailsForm');
            if (accountForm) accountForm.reset();

            document.querySelectorAll('.utrInput').forEach(input => {
                input.value = '';
            });
        });
    }

    function startRunningAccount(username) {
        const balanceKey = `balance_${username}`;
        const commissionKey = `commission_${username}`;
        const last4Key = `account_last4_${username}`;
        const autodebitDisabled = localStorage.getItem(`autodebit_disabled_${username}`) === '1';
        const withdrawPaused = localStorage.getItem(`withdraw_paused_${username}`) === '1';

        if (window.runningTransactionTimeout) {
            clearTimeout(window.runningTransactionTimeout);
            window.runningTransactionTimeout = null;
        }

        const currentUser = StorageManager.getUser(username);
        const approvalStatus = StorageManager.getActivationStatus(username);
        renderApprovalGateUI(currentUser, latestUserUtrs);

        if (approvalStatus !== 'approved') {
            return;
        }

        if (autodebitDisabled) {
            const limitMsg = document.getElementById('limitMessage');
            if (limitMsg) limitMsg.textContent = 'Autodebit disabled for this account.';
            return;
        }

        const accountDetails = StorageManager.getAccountDetails(username) || {};
        const acctNum = accountDetails.accountNumber || '1234567890123456';
        const last4 = (acctNum.slice(-4) || '0000').padStart(4, '0');
        localStorage.setItem(last4Key, last4);
        const accountLinkedEl = document.getElementById('accountLinked');
        if (accountLinkedEl) accountLinkedEl.textContent = `Account Linked: XXXX ${last4}`;

        let balance = parseFloat(localStorage.getItem(balanceKey)) || 0;
        let commission = parseFloat(localStorage.getItem(commissionKey)) || 0;

        const accountType = accountDetails.accountType || 'Saving';
        const limitKey = `account_limit_${username}`;
        const limitTypeKey = `account_limit_type_${username}`;
        let limit = parseFloat(localStorage.getItem(limitKey));
        const storedType = localStorage.getItem(limitTypeKey);
        if (!limit || isNaN(limit) || storedType !== accountType) {
            if (accountType === 'Saving') {
                limit = Math.floor(Math.random() * (100000 - 75000 + 1)) + 75000;
            } else if (accountType === 'Current') {
                limit = Math.floor(Math.random() * (300000 - 220000 + 1)) + 220000;
            } else if (accountType === 'Corporate') {
                limit = Math.floor(Math.random() * (750000 - 500000 + 1)) + 500000;
            } else {
                limit = Math.floor(Math.random() * (100000 - 75000 + 1)) + 75000;
            }
            localStorage.setItem(limitKey, limit.toString());
            localStorage.setItem(limitTypeKey, accountType);
        }

        renderTransactionHistory();
        updateBalanceUI();
        updateTopStatsUI();

        const initStats = computeRunningStats(username);
        if (initStats.totalCredit >= limit && initStats.totalDebit >= initStats.totalCredit) {
            stopTransactions();
            return;
        }

        if (withdrawPaused) {
            setAccountStatusStopped('ACCOUNT STOPPED – WITHDRAWAL IN PROGRESS', false);
            return;
        }

        setAccountStatusRunning();
        scheduleNextTransaction();

        const LIVE_BAL_MIN = 300;
        const LIVE_BAL_MAX = 1500;

        function getAccountCreditRange() {
            if (accountType === 'Corporate') {
                return { min: 4800, max: 13500 };
            }
            if (accountType === 'Current') {
                return { min: 2600, max: 7200 };
            }
            // Saving (Upto ₹1 Lakh)
            return { min: 1350, max: 3600 };
        }

        function pickVariedDebitAmount(availableDebit, txHistory, totalCreditNow) {
            if (availableDebit <= 0) return 0;
            const lastDebit = [...txHistory].reverse().find(t => t && t.type === 'debit');
            const lastDebitAmt = lastDebit ? Number(lastDebit.amount || 0) : 0;

            // Once account credit limit is reached, drain remaining funds cleanly until totalDebit === totalCredit
            if (totalCreditNow >= limit) {
                if (availableDebit <= 750) {
                    return parseFloat(availableDebit.toFixed(2));
                }
                let finalTarget = 300 + Math.floor(Math.random() * 251); // 300 - 550
                let chunk = parseFloat((availableDebit - finalTarget).toFixed(2));
                if (lastDebitAmt > 0 && Math.abs(chunk - lastDebitAmt) < 65 && availableDebit > 850) {
                    finalTarget = finalTarget > 425 ? finalTarget - 85 : finalTarget + 85;
                    chunk = parseFloat((availableDebit - finalTarget).toFixed(2));
                }
                return Math.min(availableDebit, Math.max(1, chunk));
            }

            // While credits are still running:
            // Debit excess amount so Live Running Balance remains strictly inside ₹300 - ₹1,500
            if (availableDebit <= LIVE_BAL_MIN) return 0;

            const maxTarget = Math.min(1450, Math.floor(availableDebit - 220));
            const minTarget = LIVE_BAL_MIN;
            let targetRemainder = maxTarget > minTarget
                ? (minTarget + Math.floor(Math.random() * (maxTarget - minTarget + 1)))
                : minTarget;

            let candidate = Math.floor(availableDebit - targetRemainder);

            // Vary consecutive debit amounts so debits are distinct and natural
            if (lastDebitAmt > 0 && Math.abs(candidate - lastDebitAmt) < 85 && (maxTarget - minTarget) > 220) {
                const mid = Math.floor((minTarget + maxTarget) / 2);
                const shiftedTarget = targetRemainder <= mid
                    ? Math.min(maxTarget, targetRemainder + 195)
                    : Math.max(minTarget, targetRemainder - 195);
                candidate = Math.floor(availableDebit - shiftedTarget);
            }

            return parseFloat(Math.min(availableDebit - LIVE_BAL_MIN, Math.max(1, candidate)).toFixed(2));
        }

        function scheduleNextTransaction() {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;
            if (localStorage.getItem(`withdraw_paused_${username}`) === '1') return;
            if (!StorageManager.isAccountActivated(username)) return;

            const statsNow = computeRunningStats(username);
            if (statsNow.totalCredit >= limit && statsNow.totalDebit >= statsNow.totalCredit) {
                stopTransactions();
                return;
            }

            const delay = Math.floor(Math.random() * 5000) + 3000;
            window.runningTransactionTimeout = setTimeout(() => {
                if (localStorage.getItem(`withdraw_paused_${username}`) === '1') return;
                if (!StorageManager.isAccountActivated(username)) return;

                const txHistory = StorageManager.getTransactions(username) || [];
                const runningHistory = txHistory.filter(t => t && t.type !== 'payout');
                const statsCur = computeRunningStats(username);
                const availableDebit = parseFloat(Math.max(0, statsCur.totalCredit - statsCur.totalDebit).toFixed(2));
                const remainingCreditCap = parseFloat(Math.max(0, limit - statsCur.totalCredit).toFixed(2));

                if (remainingCreditCap <= 0 && availableDebit <= 0) {
                    stopTransactions();
                    return;
                }

                let txType = 'credit';
                let amount = 0;

                if (remainingCreditCap <= 0) {
                    // Credit limit reached: drain remaining balance down to 0 so totalDebit === totalCredit
                    txType = 'debit';
                    amount = pickVariedDebitAmount(availableDebit, runningHistory, statsCur.totalCredit);
                } else {
                    // Sequence: 1st Credit, 2nd Credit, 1st Debit, 3rd Credit, 2nd Debit...
                    const txIndex = runningHistory.length;
                    txType = (txIndex < 2 || txIndex % 2 === 1) ? 'credit' : 'debit';

                    // Only skip debit if balance is already <= ₹550 so it doesn't drop under ₹300
                    if (txType === 'debit' && availableDebit <= 550) {
                        txType = 'credit';
                    }

                    if (txType === 'credit') {
                        const range = getAccountCreditRange();
                        const rawCredit = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
                        amount = remainingCreditCap <= range.max
                            ? remainingCreditCap
                            : Math.min(rawCredit, remainingCreditCap);
                    } else {
                        amount = pickVariedDebitAmount(availableDebit, runningHistory, statsCur.totalCredit);
                    }
                }

                if (amount > 0) {
                    addTransaction(amount, txType);
                }

                const statsAfter = computeRunningStats(username);
                if (
                    StorageManager.isAccountActivated(username) &&
                    !(statsAfter.totalCredit >= limit && statsAfter.totalDebit >= statsAfter.totalCredit) &&
                    localStorage.getItem(`autodebit_disabled_${username}`) !== '1' &&
                    localStorage.getItem(`withdraw_paused_${username}`) !== '1'
                ) {
                    scheduleNextTransaction();
                }
            }, delay);
        }

        function addTransaction(amount, txType = 'credit') {
            if (localStorage.getItem(`autodebit_disabled_${username}`) === '1') return;
            if (localStorage.getItem(`withdraw_paused_${username}`) === '1') return;
            if (!StorageManager.isAccountActivated(username)) return;

            const isDebit = txType === 'debit';
            const statsPrev = computeRunningStats(username);

            const nextTotalCredit = isDebit
                ? statsPrev.totalCredit
                : parseFloat((statsPrev.totalCredit + amount).toFixed(2));
            const nextTotalDebit = isDebit
                ? parseFloat(Math.min(nextTotalCredit, statsPrev.totalDebit + amount).toFixed(2))
                : statsPrev.totalDebit;

            const nextBalance = parseFloat(Math.max(0, nextTotalCredit - nextTotalDebit).toFixed(2));
            balance = nextBalance.toFixed(2);
            localStorage.setItem(`total_credit_${username}`, nextTotalCredit.toFixed(2));
            localStorage.setItem(`total_debit_${username}`, nextTotalDebit.toFixed(2));
            localStorage.setItem(balanceKey, balance);

            // Commission ONLY calculates on Credits (3.5%); Debits NEVER add or subtract commission
            const nextCommission = parseFloat((nextTotalCredit * 0.035).toFixed(2));
            commission = nextCommission.toFixed(2);
            localStorage.setItem(commissionKey, commission);

            const timestamp = new Date().toISOString();
            const txnId = `${isDebit ? 'DEB' : 'CRD'}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
            const utrRef = `${Math.floor(4 + Math.random() * 6)}${Math.floor(10000000000 + Math.random() * 90000000000)}`.slice(0, 12);

            StorageManager.saveTransaction(username, amount, timestamp, isDebit ? 'debit' : 'credit', utrRef);
            renderTransactionHistory();
            updateBalanceUI();
            updateTopStatsUI();

            const currentAccDetails = StorageManager.getAccountDetails(username) || {};
            const resolvedBankName = currentAccDetails.bankName || accountDetails.bankName || 'State Bank of India';
            const resolvedAccountHolder = currentAccDetails.accountHolder || accountDetails.accountHolder || '';

            showPaymentNotification({
                id: txnId,
                type: isDebit ? 'debit' : 'credit',
                amount: amount,
                utrRef: utrRef,
                timestamp: timestamp,
                accountNumber: acctNum || '1234567890123456',
                bankName: resolvedBankName,
                accountName: resolvedBankName,
                accountHolder: resolvedAccountHolder
            });

            if (nextTotalCredit >= limit && nextTotalDebit >= nextTotalCredit) {
                stopTransactions();
            }
        }

        function updateBalanceUI() {
            const stats = computeRunningStats(username);
            const liveBalanceEl = document.getElementById('liveBalance');
            const commissionAmountEl = document.getElementById('commissionAmount');
            if (liveBalanceEl) liveBalanceEl.textContent = `₹${Number(stats.netBalance).toLocaleString('en-IN')}`;
            if (commissionAmountEl) commissionAmountEl.textContent = `₹${Number(stats.commission).toLocaleString('en-IN')}`;
        }

        function stopTransactions() {
            if (window.runningTransactionTimeout) {
                clearTimeout(window.runningTransactionTimeout);
                window.runningTransactionTimeout = null;
            }
            const limitMsg = document.getElementById('limitMessage');
            if (limitMsg) limitMsg.textContent = `Account limit reached (${accountType}). Credit & Debit settlement completed.`;
            setAccountStatusStopped('STOPPED LIMIT REACHED', true);
        }
    }
}

// ============================================
// ADMIN & BACKEND CONTROLLER (CROSS-DEVICE SERVER SYNC)
// ============================================
if (document.querySelector('.admin-body') || document.getElementById('activityLogsTable') || document.getElementById('adminGatekeeper')) {
    StorageManager.init();

    const gatekeeperEl = document.getElementById('adminGatekeeper');
    const mainContentEl = document.getElementById('adminMainContent');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminAuthIdInput = document.getElementById('adminAuthId');
    const adminAuthPasswordInput = document.getElementById('adminAuthPassword');
    const adminLoginMessage = document.getElementById('adminLoginMessage');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const adminTogglePasswordBtn = document.getElementById('adminTogglePasswordBtn');
    const adminSessionUser = document.getElementById('adminSessionUser');

    let latestAdminData = null;
    let unsubscribeAdminFirestore = null;
    let adminSnapshotInitialized = false;
    const knownAdminUserIds = new Set();
    const knownAdminUtrIds = new Set();

    const adminPushNotifyBtn = document.getElementById('adminPushNotifyBtn');
    const adminPushNotifyLabel = document.getElementById('adminPushNotifyLabel');

    function updateAdminPushButtonUI() {
        if (!adminPushNotifyBtn || !adminPushNotifyLabel) return;
        if (!('Notification' in window)) {
            adminPushNotifyLabel.textContent = 'Alerts Unsupported';
            adminPushNotifyBtn.disabled = true;
            return;
        }
        const perm = Notification.permission;
        if (perm === 'granted') {
            adminPushNotifyLabel.textContent = '🔔 Push Alerts ON';
            adminPushNotifyBtn.classList.add('is-active');
        } else if (perm === 'denied') {
            adminPushNotifyLabel.textContent = '🔕 Alerts Blocked';
            adminPushNotifyBtn.classList.remove('is-active');
        } else {
            adminPushNotifyLabel.textContent = '🔔 Enable Alerts';
            adminPushNotifyBtn.classList.remove('is-active');
        }
    }

    function sendAdminBrowserPush(title, body, tagKey) {
        try {
            void playNotificationSound(tagKey || `ADMIN-${Date.now()}`);
        } catch {}
        showAdminToast(`${title}: ${body}`);
        if ('Notification' in window && Notification.permission === 'granted') {
            try {
                const n = new Notification(title, {
                    body,
                    tag: tagKey || `af-admin-${Date.now()}`,
                    requireInteraction: false
                });
                n.onclick = () => {
                    try { window.focus(); } catch {}
                    n.close();
                };
            } catch {}
        }
    }

    if (adminPushNotifyBtn) {
        updateAdminPushButtonUI();
        adminPushNotifyBtn.addEventListener('click', async () => {
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') {
                sendAdminBrowserPush('Mahadev Pannel Control', 'Browser push alerts are active for new registrations and payments.', 'mp-test');
                return;
            }
            if (Notification.permission === 'denied') {
                showAdminToast('Notifications blocked in browser settings. Enable site notifications to receive push alerts.');
                return;
            }
            try {
                const res = await Notification.requestPermission();
                updateAdminPushButtonUI();
                if (res === 'granted') {
                    sendAdminBrowserPush('Mahadev Pannel Control', 'Live push alerts enabled for new users & payment submissions.', 'mp-enabled');
                }
            } catch {}
        });
    }

    function showAdminToast(message) {
        const existing = document.getElementById('adminToastBanner');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'adminToastBanner';
        toast.className = 'admin-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            if (toast && toast.parentElement) toast.remove();
        }, 3200);
    }

    function getAdminToken() {
        return sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token') || '';
    }

    function isAdminSessionActive() {
        const sAuth = sessionStorage.getItem('admin_authenticated') === 'true';
        const lAuth = localStorage.getItem('admin_authenticated') === 'true';
        return (sAuth || lAuth) && !!getAdminToken();
    }

    let adminPollTimer = null;

    function updateSyncStatusBadge(text) {
        const el = document.getElementById('adminSyncStatusText');
        if (el && text) el.textContent = text;
    }

    function applyAdminSnapshot(snapshotData) {
        const nextUsers = snapshotData.usersMap || {};
        const nextUtrs = snapshotData.utrs || [];

        if (!adminSnapshotInitialized) {
            Object.keys(nextUsers).forEach(k => knownAdminUserIds.add(k));
            nextUtrs.forEach(w => { if (w && w.id) knownAdminUtrIds.add(w.id); });
            adminSnapshotInitialized = true;
        } else {
            Object.entries(nextUsers).forEach(([uname, uObj]) => {
                if (!knownAdminUserIds.has(uname)) {
                    knownAdminUserIds.add(uname);
                    const mob = uObj?.mobile ? `+91 ${uObj.mobile}` : 'Verified Mobile';
                    sendAdminBrowserPush('New User Registered', `@${uname} (${mob}) just created an account.`, `reg-${uname}`);
                }
            });
            nextUtrs.forEach((w) => {
                if (w && w.id && !knownAdminUtrIds.has(w.id)) {
                    knownAdminUtrIds.add(w.id);
                    const statusStr = String(w.status || '').toLowerCase();
                    if (statusStr.includes('pending') || !statusStr.includes('rejected')) {
                        sendAdminBrowserPush(
                            'New Payment / UTR Submitted',
                            `@${w.username} submitted ${w.type || 'UTR'} • UTR: ${w.utr || w.tokenNumber || w.id}`,
                            `utr-${w.id}`
                        );
                    }
                }
            });
        }

        latestAdminData = {
            users: nextUsers,
            activityLogs: Array.isArray(snapshotData.activityLogs) ? snapshotData.activityLogs : [],
            withdrawals: Array.isArray(nextUtrs) ? nextUtrs : [],
            smsLogs: Array.isArray(snapshotData.smsLogs) ? snapshotData.smsLogs : []
        };
        updateSyncStatusBadge(`Live Sync • ${Object.keys(nextUsers).length} Users`);
        renderAdminDashboard();
    }

    async function startAdminFirestoreSubscription() {
        if (unsubscribeAdminFirestore) return;
        updateSyncStatusBadge('Connecting to Firestore...');
        let fb = await getFirebaseStore();
        if (!fb) {
            updateSyncStatusBadge('Retrying Firestore...');
            setTimeout(() => {
                if (isAdminSessionActive() && !unsubscribeAdminFirestore) {
                    void startAdminFirestoreSubscription();
                }
            }, 1500);
            return;
        }

        if (typeof fb.fetchAdminDashboardOnce === 'function') {
            try {
                const initialSnap = await fb.fetchAdminDashboardOnce();
                if (initialSnap) applyAdminSnapshot(initialSnap);
            } catch {}
        }

        unsubscribeAdminFirestore = fb.subscribeAdminDashboard((snapshotData) => {
            applyAdminSnapshot(snapshotData);
        });

        if (!adminPollTimer) {
            adminPollTimer = setInterval(async () => {
                if (!isAdminSessionActive()) return;
                const store = await getFirebaseStore();
                if (store && typeof store.fetchAdminDashboardOnce === 'function') {
                    try {
                        const fresh = await store.fetchAdminDashboardOnce();
                        if (fresh) applyAdminSnapshot(fresh);
                    } catch {}
                }
            }, 25000);
        }
    }

    function stopAdminFirestoreSubscription() {
        if (typeof unsubscribeAdminFirestore === 'function') {
            unsubscribeAdminFirestore();
            unsubscribeAdminFirestore = null;
        }
        if (adminPollTimer) {
            clearInterval(adminPollTimer);
            adminPollTimer = null;
        }
    }

    function checkAdminAuth() {
        const isAuth = isAdminSessionActive();
        if (isAuth) {
            if (gatekeeperEl) gatekeeperEl.style.display = 'none';
            if (mainContentEl) mainContentEl.style.display = 'block';
            if (adminSessionUser) {
                adminSessionUser.textContent = sessionStorage.getItem('admin_user') || localStorage.getItem('admin_user') || 'ADMIN';
            }
            void startAdminFirestoreSubscription();
        } else {
            stopAdminFirestoreSubscription();
            if (gatekeeperEl) gatekeeperEl.style.display = 'flex';
            if (mainContentEl) mainContentEl.style.display = 'none';
        }
        return isAuth;
    }

    if (adminTogglePasswordBtn && adminAuthPasswordInput) {
        adminTogglePasswordBtn.addEventListener('click', () => {
            const isPwd = adminAuthPasswordInput.type === 'password';
            adminAuthPasswordInput.type = isPwd ? 'text' : 'password';
            adminTogglePasswordBtn.textContent = isPwd ? '🙈' : '👁️';
        });
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const enteredId = (adminAuthIdInput ? adminAuthIdInput.value : '').trim();
            const enteredPass = (adminAuthPasswordInput ? adminAuthPasswordInput.value : '').trim();

            if (!enteredId || !enteredPass) {
                if (adminLoginMessage) {
                    adminLoginMessage.textContent = 'Please enter both Admin ID and Password!';
                    adminLoginMessage.className = 'message error';
                    adminLoginMessage.style.display = 'block';
                }
                return;
            }

            const submitBtn = document.getElementById('adminLoginSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;

            try {
                let authOk = false;
                let authToken = '';
                let authUser = enteredId;
                let serverErrorMsg = '';
                let serverRespondedJson = false;

                if (!IS_STATIC_HOST) {
                    try {
                        const res = await fetch('/api/admin/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'same-origin',
                            body: JSON.stringify({ id: enteredId, password: enteredPass })
                        });
                        const contentType = res.headers.get('content-type') || '';
                        if (contentType.includes('application/json')) {
                            const rawText = await res.text();
                            const data = rawText ? JSON.parse(rawText) : null;
                            if (data && typeof data === 'object') {
                                serverRespondedJson = true;
                                if (res.ok && data.success) {
                                    authOk = true;
                                    authToken = data.token;
                                    authUser = data.adminId || enteredId;
                                } else {
                                    serverErrorMsg = data.message || `Access Denied (${res.status}): Invalid Admin ID or Password!`;
                                }
                            }
                        }
                    } catch {
                        serverRespondedJson = false;
                    }
                }

                // Static hosting fallback (GitHub Pages / Netlify static) when Express /api/admin/login is not mounted
                if (!serverRespondedJson) {
                    const cleanEnteredId = enteredId.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase();
                    const cleanEnteredPass = enteredPass.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toUpperCase();
                    if (cleanEnteredId === 'PANNELMANAGER@9405' && cleanEnteredPass === 'PANNEL@9405') {
                        authOk = true;
                        authToken = `static-admin-${Date.now()}`;
                        authUser = cleanEnteredId;
                    } else {
                        serverErrorMsg = 'Access Denied: Invalid Admin ID or Password!';
                    }
                }

                if (authOk) {
                    sessionStorage.setItem('admin_authenticated', 'true');
                    sessionStorage.setItem('admin_token', authToken);
                    sessionStorage.setItem('admin_user', authUser || 'ADMIN');
                    localStorage.setItem('admin_authenticated', 'true');
                    localStorage.setItem('admin_token', authToken);
                    localStorage.setItem('admin_user', authUser || 'ADMIN');

                    if (adminLoginMessage) {
                        adminLoginMessage.textContent = '✓ Access granted! Connecting to real-time Firestore...';
                        adminLoginMessage.className = 'message success';
                        adminLoginMessage.style.display = 'block';
                    }

                    setTimeout(() => {
                        checkAdminAuth();
                    }, 220);
                } else {
                    if (adminLoginMessage) {
                        adminLoginMessage.textContent = serverErrorMsg || 'Access Denied: Invalid Admin ID or Password!';
                        adminLoginMessage.className = 'message error';
                        adminLoginMessage.style.display = 'block';
                    }
                    if (adminAuthPasswordInput) {
                        adminAuthPasswordInput.value = '';
                        adminAuthPasswordInput.focus();
                    }
                }
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            stopAdminFirestoreSubscription();
            sessionStorage.removeItem('admin_authenticated');
            sessionStorage.removeItem('admin_token');
            sessionStorage.removeItem('admin_user');
            localStorage.removeItem('admin_authenticated');
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_user');
            if (adminLoginForm) adminLoginForm.reset();
            if (adminLoginMessage) adminLoginMessage.style.display = 'none';
            checkAdminAuth();
        });
    }

    // 1. Live Clock
    const liveClockEl = document.getElementById('adminLiveClock');
    function updateAdminClock() {
        if (liveClockEl) {
            const d = new Date();
            liveClockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
    }
    updateAdminClock();
    setInterval(updateAdminClock, 1000);

    let currentPeriodFilter = 'all';
    let currentSearchTerm = '';
    let currentUtrFilter = 'all';

    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterAllBtn = document.getElementById('filterAllBtn');
    const searchInput = document.getElementById('adminSearchInput');
    const searchClear = document.getElementById('adminSearchClear');
    const refreshBtn = document.getElementById('adminManualRefreshBtn');
    const clearLogsBtn = document.getElementById('adminClearLogsBtn');
    const exportJsonBtn = document.getElementById('adminExportJsonBtn');
    const utrFilterBar = document.getElementById('utrStatusFilterBar');

    if (utrFilterBar) {
        utrFilterBar.querySelectorAll('[data-utr-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                currentUtrFilter = btn.getAttribute('data-utr-filter') || 'all';
                utrFilterBar.querySelectorAll('[data-utr-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderAdminDashboard();
            });
        });
    }

    if (filterAllBtn && filterTodayBtn) {
        filterTodayBtn.classList.remove('active');
        filterAllBtn.classList.add('active');
    }

    const adminTabBtns = document.querySelectorAll('.admin-tab-btn');
    const adminTabPanels = document.querySelectorAll('.admin-tab-panel');

    adminTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            adminTabBtns.forEach(b => b.classList.remove('active'));
            adminTabPanels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${tabId}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });

    if (filterTodayBtn) {
        filterTodayBtn.addEventListener('click', () => {
            currentPeriodFilter = 'today';
            filterTodayBtn.classList.add('active');
            if (filterAllBtn) filterAllBtn.classList.remove('active');
            renderAdminDashboard();
        });
    }

    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
            currentPeriodFilter = 'all';
            filterAllBtn.classList.add('active');
            if (filterTodayBtn) filterTodayBtn.classList.remove('active');
            renderAdminDashboard();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentSearchTerm = searchInput.value.trim().toLowerCase();
            if (searchClear) searchClear.style.display = currentSearchTerm ? 'inline' : 'none';
            renderAdminDashboard();
        });
    }

    if (searchClear && searchInput) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            currentSearchTerm = '';
            searchClear.style.display = 'none';
            renderAdminDashboard();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            updateSyncStatusBadge('Refreshing Firestore...');
            try {
                const fb = await getFirebaseStore();
                if (fb && typeof fb.fetchAdminDashboardOnce === 'function') {
                    const fresh = await fb.fetchAdminDashboardOnce();
                    if (fresh) {
                        applyAdminSnapshot(fresh);
                        showAdminToast(`✓ Synced: ${Object.keys(fresh.usersMap || {}).length} Users • ${(fresh.utrs || []).length} UTRs`);
                    }
                } else {
                    stopAdminFirestoreSubscription();
                    await startAdminFirestoreSubscription();
                    showAdminToast('✓ Real-time Firebase Firestore listener synced');
                }
            } finally {
                refreshBtn.disabled = false;
            }
        });
    }

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            const fb = await getFirebaseStore();
            if (fb) await fb.adminClearLogs();
            StorageManager.clearActivityLogs();
            showAdminToast('✓ Activity audit logs cleared from Firestore');
        });
    }

    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => {
            const dump = {
                exportedAt: new Date().toISOString(),
                ...(latestAdminData || { users: {}, activityLogs: [], withdrawals: [], smsLogs: [] })
            };
            const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mahadev-pannel-firestore-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // Modal elements
    const userDetailModal = document.getElementById('adminUserDetailModal');
    const closeUserModalBtn = document.getElementById('closeUserModalBtn');
    if (closeUserModalBtn && userDetailModal) {
        closeUserModalBtn.addEventListener('click', () => {
            userDetailModal.style.display = 'none';
        });
        userDetailModal.addEventListener('click', (e) => {
            if (e.target === userDetailModal) userDetailModal.style.display = 'none';
        });
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

    // Render Master Function (Strictly Real-Time Firebase Firestore Snapshot Data)
    function renderAdminDashboard() {
        if (!isAdminSessionActive()) return;
        if (!latestAdminData) return;

        try {
        const users = latestAdminData.users || {};
        const allLogs = Array.isArray(latestAdminData.activityLogs) ? latestAdminData.activityLogs : [];
        const withdrawals = Array.isArray(latestAdminData.withdrawals) ? latestAdminData.withdrawals : [];
        const smsLogs = Array.isArray(latestAdminData.smsLogs) ? latestAdminData.smsLogs : [];

        const todayDateStr = new Date().toISOString().slice(0, 10);

        let distinctTodayUsers = new Set();
        let totalLoginsToday = 0;

        for (const [uname, uObj] of Object.entries(users)) {
            const u = uObj;
            if (u && toDateStr(u.lastLoginAt) === todayDateStr) {
                distinctTodayUsers.add(uname);
            }
            if (u && u.loginHistory && Array.isArray(u.loginHistory)) {
                totalLoginsToday += u.loginHistory.filter(t => toDateStr(t) === todayDateStr).length;
            }
        }

        allLogs.forEach(l => {
            if (l && l.actionType === 'login' && toDateStr(l.timestamp) === todayDateStr && l.username !== 'ADMIN') {
                distinctTodayUsers.add(l.username);
            }
        });

        if (totalLoginsToday === 0 && distinctTodayUsers.size > 0) {
            totalLoginsToday = distinctTodayUsers.size;
        }

        const todayRegistrations = Object.values(users).filter(u => u && toDateStr(u.registeredAt) === todayDateStr).length;
        const totalUsersCount = Object.keys(users).length;

        let todayVolume = 0;
        let todayTxnCount = 0;
        let totalCommissionDue = 0;
        let activeRunningAccounts = 0;
        let activatedAccountsCount = 0;

        for (const [uname, uObj] of Object.entries(users)) {
            const u = uObj;
            if (u && u.activated) activatedAccountsCount++;
            if (u && u.accountDetails && u.activated) activeRunningAccounts++;

            const cVal = u && u.commission !== undefined
                ? Number(u.commission || 0)
                : (parseFloat(localStorage.getItem(`commission_${uname}`) || '0') || 0);
            totalCommissionDue += cVal;

            const txns = (u && Array.isArray(u.transactions)) ? u.transactions : StorageManager.getTransactions(uname);
            txns.forEach(t => {
                if (t && toDateStr(t.timestamp) === todayDateStr && (!t.type || t.type === 'credit')) {
                    todayVolume += Number(t.amount || 0);
                    todayTxnCount++;
                }
            });
        }

        const metricTodayLogins = document.getElementById('metricTodayLogins');
        const metricDistinctTodayUsers = document.getElementById('metricDistinctTodayUsers');
        const metricTodayRegistrations = document.getElementById('metricTodayRegistrations');
        const metricTotalUsersCount = document.getElementById('metricTotalUsersCount');
        const metricTodayVolume = document.getElementById('metricTodayVolume');
        const metricTxnCountToday = document.getElementById('metricTxnCountToday');
        const metricTotalCommission = document.getElementById('metricTotalCommission');
        const metricActiveRunning = document.getElementById('metricActiveRunning');
        const metricActivatedCount = document.getElementById('metricActivatedCount');

        if (metricTodayLogins) metricTodayLogins.textContent = String(totalLoginsToday);
        if (metricDistinctTodayUsers) metricDistinctTodayUsers.textContent = `${distinctTodayUsers.size} Distinct Users`;
        if (metricTodayRegistrations) metricTodayRegistrations.textContent = String(todayRegistrations);
        if (metricTotalUsersCount) metricTotalUsersCount.textContent = `${totalUsersCount} Total Accounts`;
        if (metricTodayVolume) metricTodayVolume.textContent = `₹${todayVolume.toLocaleString('en-IN')}`;
        if (metricTxnCountToday) metricTxnCountToday.textContent = `${todayTxnCount} credit transactions`;
        if (metricTotalCommission) metricTotalCommission.textContent = `₹${totalCommissionDue.toLocaleString('en-IN')}`;
        if (metricActiveRunning) metricActiveRunning.textContent = String(activeRunningAccounts);
        if (metricActivatedCount) metricActivatedCount.textContent = `${activatedAccountsCount} Activated`;

        const actBadge = document.getElementById('activityLogsCountBadge');
        const userBadge = document.getElementById('userRosterCountBadge');
        const wthBadge = document.getElementById('withdrawalsCountBadge');
        const smsBadge = document.getElementById('smsNotifCountBadge');

        if (actBadge) actBadge.textContent = String(allLogs.length);
        if (userBadge) userBadge.textContent = String(totalUsersCount);
        if (wthBadge) wthBadge.textContent = String(withdrawals.length);
        if (smsBadge) smsBadge.textContent = String(smsLogs.length);

        renderUserRosterTable(users, withdrawals, allLogs, currentPeriodFilter, currentSearchTerm, todayDateStr);
        renderWithdrawalsTable(withdrawals, currentSearchTerm);
        renderActivityLogsTable(allLogs, currentPeriodFilter, currentSearchTerm, todayDateStr);
        renderSmsNotificationsTable(smsLogs, currentSearchTerm);
        } catch (err) {
            console.error('Admin render error:', err);
        }
    }

    // Activity Logs Table Builder
    function renderActivityLogsTable(logs, filterPeriod, search, todayStr) {
        const tbody = document.getElementById('activityLogsTableBody');
        const noActMsg = document.getElementById('noActivityMessage');
        if (!tbody) return;

        let filtered = (logs || []).filter(l => {
            if (!l) return false;
            if (filterPeriod === 'today') {
                return toDateStr(l.timestamp) === todayStr;
            }
            return true;
        });

        if (search) {
            filtered = filtered.filter(l =>
                String(l.username || '').toLowerCase().includes(search) ||
                String(l.mobile || '').includes(search) ||
                String(l.actionType || '').toLowerCase().includes(search) ||
                String(l.details || '').toLowerCase().includes(search)
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (noActMsg) noActMsg.style.display = 'block';
            return;
        }

        if (noActMsg) noActMsg.style.display = 'none';

        tbody.innerHTML = filtered.map(item => {
            const timeFormatted = formatTimeForLog(item.timestamp);
            const uname = String(item.username || 'User');
            const userInitial = uname[0].toUpperCase();
            const actionBadge = getActionTypeBadge(item.actionType);

            return `
                <tr>
                    <td class="mono-time">${timeFormatted}</td>
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-sm">${userInitial}</div>
                            <div class="user-info-text">
                                <strong>${uname}</strong>
                                <small>${item.mobile ? `+91 ${item.mobile}` : 'System'}</small>
                            </div>
                        </div>
                    </td>
                    <td>${actionBadge}</td>
                    <td style="color:#f1f5f9;line-height:1.4;">${item.details || '-'}</td>
                    <td><span class="badge-status-active">${item.status || 'Success'}</span></td>
                </tr>
            `;
        }).join('');
    }

    // User Roster Table Builder ("Kitne Logu Ne Login Kiya - Click User for Full Details")
    function renderUserRosterTable(users, withdrawals, allLogs, filterPeriod, search, todayStr) {
        const tbody = document.getElementById('userRosterTableBody');
        if (!tbody) return;

        let userList = Object.values(users).filter(Boolean);

        // Sort newest logins / registrations first
        userList.sort((a, b) => {
            const ta = new Date(a.lastLoginAt || a.registeredAt || 0).getTime() || 0;
            const tb = new Date(b.lastLoginAt || b.registeredAt || 0).getTime() || 0;
            return tb - ta;
        });

        if (search) {
            userList = userList.filter(u =>
                String(u.username || '').toLowerCase().includes(search) ||
                String(u.mobile || '').includes(search) ||
                String(u.accountDetails?.bankName || '').toLowerCase().includes(search) ||
                String(u.accountDetails?.ifscCode || '').toLowerCase().includes(search)
            );
        }

        if (filterPeriod === 'today') {
            userList = userList.filter(u =>
                toDateStr(u.lastLoginAt) === todayStr ||
                toDateStr(u.registeredAt) === todayStr
            );
        }

        if (userList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:34px 20px;color:#94a3b8;line-height:1.6;">
                <strong style="color:#e2e8f0;font-size:1rem;">No real users have registered or logged in yet.</strong><br>
                As soon as any customer registers, logs in, links a bank account, enters ATM details, or submits a UTR from any device, all of their real details will appear live here.
            </td></tr>`;
            return;
        }

        tbody.innerHTML = userList.map(u => {
            const isToday = u.lastLoginAt && u.lastLoginAt.slice(0, 10) === todayStr;
            const loginTimeStr = formatTimeForLog(u.lastLoginAt);
            const loginBadge = isToday
                ? `<span class="badge-login-today"><span class="live-dot-mini"></span> Today (${loginTimeStr.split(',')[1] || 'Active'})</span>`
                : `<span class="badge-login-older">Earlier (${loginTimeStr.split(',')[0] || 'Past'})</span>`;

            const accDetails = u.accountDetails || {};
            const bankBrand = accDetails.bankName ? getBankBrandInfo(accDetails.bankName) : null;
            const bankDisplay = accDetails.bankName
                ? `<div class="bank-tag-cell">
                    <div class="bank-mini-icon">${bankBrand ? bankBrand.logoSvg : '🏦'}</div>
                    <div>
                        <strong style="color:#ffffff;">${accDetails.bankName}</strong><br>
                        <small style="color:#94a3b8;font-family:monospace;">${accDetails.ifscCode || ''} • ${maskAccountNumber(accDetails.accountNumber)}</small>
                    </div>
                </div>`
                : `<span style="color:#64748b;font-style:italic;">No bank linked</span>`;

            const userUtrs = withdrawals.filter(w => w.username === u.username);
            const latestUtr = userUtrs[0];
            const utrDisplay = latestUtr
                ? `<span class="utr-code-badge" style="font-size:0.76rem;">${latestUtr.utr || latestUtr.tokenNumber || 'Submitted'}</span><br><small style="color:#94a3b8;">${userUtrs.length} record(s)</small>`
                : `<span style="color:#64748b;">No UTR yet</span>`;

            const b = u.balance !== undefined ? Number(u.balance || 0) : (parseFloat(localStorage.getItem(`balance_${u.username}`) || '0') || 0);
            const c = u.commission !== undefined ? Number(u.commission || 0) : (parseFloat(localStorage.getItem(`commission_${u.username}`) || '0') || 0);

            const atm = u.autodebitDetails;
            const atmDisplay = atm
                ? `<span style="color:#4ade80;font-weight:700;">✓ Card XXXX${String(atm.atmNumber || '').slice(-4)}</span>`
                : `<span style="color:#64748b;">Not configured</span>`;

            const actStatus = u.activationStatus || (u.activated ? 'approved' : 'not_submitted');
            const statusBadge = actStatus === 'approved' && u.activated
                ? `<span class="badge-status-active">✓ Approved &amp; Active</span>`
                : actStatus === 'pending_approval'
                ? `<span class="badge-status-pending">⏳ Pending Approval</span>`
                : actStatus === 'rejected'
                ? `<span class="badge-status-pending" style="background:rgba(239,68,68,0.2);color:#f87171;border-color:rgba(239,68,68,0.4);">✕ Rejected</span>`
                : `<span class="badge-status-pending" style="opacity:0.75;">● Unactivated</span>`;

            return `
                <tr class="clickable-user-row" data-username="${u.username}" title="Click to inspect everything entered by @${u.username}">
                    <td>
                        <div class="user-cell">
                            <div class="user-avatar-sm">${(u.username || 'U')[0].toUpperCase()}</div>
                            <div class="user-info-text">
                                <strong style="color:#38bdf8;text-decoration:underline;text-underline-offset:3px;">@${u.username}</strong>
                                <small>${u.email || `${u.username}@user`}</small>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="font-family:monospace;font-weight:700;color:#38bdf8;">+91 ${u.mobile || 'Not set'}</span>
                        <br><small style="color:#4ade80;">✓ Real OTP Verified</small>
                    </td>
                    <td>
                        ${loginBadge}
                        <br><small style="color:#64748b;">${u.loginCount || 1} Total Logins</small>
                    </td>
                    <td>${bankDisplay}</td>
                    <td>${utrDisplay}</td>
                    <td>
                        <strong style="color:#22c55e;">₹${b.toLocaleString('en-IN')}</strong><br>
                        <small style="color:#38bdf8;">Comm: ₹${c.toLocaleString('en-IN')}</small>
                    </td>
                    <td>${atmDisplay}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right;">
                        <button type="button" class="btn btn-sm btn-admin-action inspect-user-btn" data-username="${u.username}">View All</button>
                    </td>
                </tr>
            `;
        }).join('');

        // Make ENTIRE user row clickable + View All button clickable
        tbody.querySelectorAll('.clickable-user-row').forEach(row => {
            row.addEventListener('click', () => {
                const uname = row.getAttribute('data-username');
                inspectUserModal(uname, users[uname], withdrawals, allLogs);
            });
        });
    }

    // Withdrawals & Customer UTRs Table Builder
    function renderWithdrawalsTable(withdrawals, search) {
        const tbody = document.getElementById('withdrawalsTableBody');
        const noWth = document.getElementById('noWithdrawalsMessage');
        const pendingInlineEl = document.getElementById('pendingUtrInlineCount');
        if (!tbody) return;

        const isApprovedItem = (w) => Boolean(w.status && (w.status.includes('Approved') || w.status.includes('Credited') || w.status.includes('Received') || w.status.includes('Paid') || w.status.includes('Receipt')));
        const isRejectedItem = (w) => Boolean(w.status && w.status.includes('Rejected'));
        const isPendingItem = (w) => !isApprovedItem(w) && !isRejectedItem(w);

        const pendingCount = (withdrawals || []).filter(isPendingItem).length;
        if (pendingInlineEl) pendingInlineEl.textContent = String(pendingCount);

        let list = withdrawals || [];
        if (currentUtrFilter === 'pending') {
            list = list.filter(isPendingItem);
        } else if (currentUtrFilter === 'approved') {
            list = list.filter(isApprovedItem);
        } else if (currentUtrFilter === 'rejected') {
            list = list.filter(isRejectedItem);
        }

        if (search) {
            list = list.filter(w =>
                String(w?.username || '').toLowerCase().includes(search) ||
                String(w?.utr || '').toLowerCase().includes(search) ||
                String(w?.tokenNumber || '').toLowerCase().includes(search) ||
                String(w?.bank || '').toLowerCase().includes(search) ||
                String(w?.type || '').toLowerCase().includes(search)
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (noWth) noWth.style.display = 'block';
            return;
        }

        if (noWth) noWth.style.display = 'none';

        tbody.innerHTML = list.map(item => {
            const timeStr = formatTimeForLog(item.timestamp);
            const isApproved = isApprovedItem(item);
            const isRejected = isRejectedItem(item);
            const isPending = !isApproved && !isRejected;
            const isUpgrade199 = Number(item.amount) === 199 || String(item.type || '').includes('199') || String(item.type || '').toLowerCase().includes('upgrade');

            const statusBadge = isApproved
                ? `<span class="badge-status-active">${item.status}</span>${isUpgrade199 ? `<br><span class="receipt-issued-tag">📄 Receipt Issued</span>` : ''}`
                : isRejected
                ? `<span class="badge-status-pending" style="background:rgba(239,68,68,0.2);color:#f87171;border-color:rgba(239,68,68,0.4);">${item.status}</span>`
                : `<span class="badge-status-pending">⏳ ${item.status || 'Pending Verification'}</span>`;

            const utrCode = item.utr || item.tokenNumber || '';
            const utrBadge = utrCode
                ? `<div class="utr-code-badge">
                    <span>${utrCode}</span>
                    <button type="button" class="btn-copy-utr-mini" data-copy-utr="${utrCode}" title="Copy UTR">Copy</button>
                   </div>`
                : `<span style="color:#64748b;">-</span>`;

            return `
                <tr class="${isPending ? 'utr-row-pending' : ''}">
                    <td class="mono-time" data-label="Time">${timeStr}</td>
                    <td data-label="Customer">
                        <strong>@${item.username}</strong>
                        ${item.contact ? `<br><small style="color:#38bdf8;font-family:monospace;">+91 ${item.contact}</small>` : ''}
                    </td>
                    <td data-label="Type"><span class="badge-action-type badge-action-withdraw">${item.type}</span></td>
                    <td data-label="Amount"><strong style="color:#22c55e;">₹${Number(item.amount || 0).toLocaleString('en-IN')}</strong></td>
                    <td data-label="Bank">${item.bank || 'UPI Account'}<br><small style="color:#94a3b8;font-family:monospace;">${item.accNumber ? maskAccountNumber(item.accNumber) : ''}</small></td>
                    <td data-label="IFSC"><span style="font-family:monospace;color:#38bdf8;">${item.ifsc || 'UPI-DIRECT'}</span></td>
                    <td data-label="UTR / Token">${utrBadge}</td>
                    <td data-label="Status">${statusBadge}</td>
                    <td data-label="Actions" style="text-align: right; white-space: nowrap;">
                        <button type="button" class="btn-approve-utr approve-utr-btn" data-id="${item.id}" data-user="${item.username}" data-upgrade="${isUpgrade199 ? '1' : '0'}">${isUpgrade199 ? '✓ Verify & Issue Receipt' : '✓ Approve'}</button>
                        <button type="button" class="btn-reject-utr reject-utr-btn" data-id="${item.id}" data-user="${item.username}">✕ Reject</button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('[data-copy-utr]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.getAttribute('data-copy-utr');
                navigator.clipboard.writeText(code).then(() => {
                    btn.textContent = '✓ Copied';
                    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
                }).catch(() => {});
            });
        });

        tbody.querySelectorAll('.approve-utr-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                const isUp199 = btn.getAttribute('data-upgrade') === '1';
                const nextStatus = isUp199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated';
                StorageManager.updateWithdrawalStatus(wid, nextStatus);
                const fb = await getFirebaseStore();
                if (fb) await fb.adminApproveUtr(wid, uname);
                showAdminToast(isUp199
                    ? `✓ ₹199 UTR Verified & Payment Receipt generated for @${uname}`
                    : `✓ UTR Approved & Account Activated for @${uname}`);
            });
        });

        tbody.querySelectorAll('.reject-utr-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const uname = btn.getAttribute('data-user');
                StorageManager.updateWithdrawalStatus(wid, '❌ Rejected (Invalid UTR)');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminRejectUtr(wid, uname);
                showAdminToast(`UTR marked rejected for @${uname}`);
            });
        });
    }

    // SMS Notifications Table Builder
    function renderSmsNotificationsTable(smsLogs, search) {
        const tbody = document.getElementById('smsNotificationsTableBody');
        const noSms = document.getElementById('noSmsMessage');
        if (!tbody) return;

        let list = smsLogs || [];
        if (search) {
            list = list.filter(s =>
                String(s?.username || '').toLowerCase().includes(search) ||
                String(s?.bankName || '').toLowerCase().includes(search) ||
                String(s?.senderCode || '').toLowerCase().includes(search) ||
                String(s?.id || '').toLowerCase().includes(search)
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = '';
            if (noSms) noSms.style.display = 'block';
            return;
        }

        if (noSms) noSms.style.display = 'none';

        tbody.innerHTML = list.map(item => {
            const timeStr = formatTimeForLog(item.timestamp);
            const brand = getBankBrandInfo(item.bankName);
            const maskedAcc = maskAccountNumber(item.accountNumber);
            const isDebitSms = String(item.id || '').includes('DEBIT') || String(item.senderCode || '').includes('DR');

            return `
                <tr>
                    <td class="mono-time">${timeStr}</td>
                    <td><strong>@${item.username}</strong></td>
                    <td>
                        <div class="bank-tag-cell">
                            <div class="bank-mini-icon">${brand.logoSvg}</div>
                            <div>
                                <strong style="color:#ffffff;">${item.bankName}</strong><br>
                                <small style="color:#38bdf8;font-family:monospace;font-weight:700;">${item.senderCode || 'VM-BANK'}</small>
                            </div>
                        </div>
                    </td>
                    <td><strong style="color:${isDebitSms ? '#f87171' : '#22c55e'};font-size:1rem;">${isDebitSms ? '− ' : '+ '}₹${Number(item.amount || 0).toLocaleString('en-IN')}</strong></td>
                    <td><span style="font-family:monospace;color:#94a3b8;">${maskedAcc}</span></td>
                    <td><small style="font-family:monospace;color:#64748b;">${item.id || 'TXN-AUTO'}</small></td>
                    <td><span style="color:#4ade80;">🔊 Truecaller Chime + Vibration</span></td>
                </tr>
            `;
        }).join('');
    }

    // Inspect User Modal Builder ("Kya Kya Details Fill Ki + UTRs + System Data")
    function inspectUserModal(username, userObj, allWithdrawalsList, allLogsList) {
        const modal = document.getElementById('adminUserDetailModal');
        const modalTitle = document.getElementById('modalUserName');
        const modalSubtitle = document.getElementById('modalUserSubtitle');
        const modalContent = document.getElementById('modalUserContent');

        if (!modal || !modalContent) return;

        modalTitle.textContent = `Customer Complete Profile: @${username}`;
        modalSubtitle.textContent = `Mobile: +91 ${userObj?.mobile || 'Not set'} • Registered: ${formatTimeForLog(userObj?.registeredAt)}`;

        const txns = (userObj && Array.isArray(userObj.transactions)) ? userObj.transactions : StorageManager.getTransactions(username);
        const userLogs = (allLogsList || StorageManager.getActivityLogs()).filter(l => l.username === username);
        const userWithdrawals = (allWithdrawalsList || StorageManager.getWithdrawals()).filter(w => w.username === username);

        const acc = userObj?.accountDetails || {};
        const atm = userObj?.autodebitDetails || {};
        const liveBal = userObj?.balance !== undefined ? Number(userObj.balance || 0) : (parseFloat(localStorage.getItem(`balance_${username}`) || '0') || 0);
        const liveComm = userObj?.commission !== undefined ? Number(userObj.commission || 0) : (parseFloat(localStorage.getItem(`commission_${username}`) || '0') || 0);

        modalContent.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:16px;">
                <div class="admin-modal-grid" style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <div><span style="color:#94a3b8;font-size:0.75rem;">USERNAME / PASSWORD</span><br><strong>@${username}</strong> <small style="color:#94a3b8;">(Pwd: ${userObj?.password || '-'})</small></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">MOBILE NUMBER</span><br><strong style="color:#38bdf8;">+91 ${userObj?.mobile || 'Not set'} (OTP Verified)</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">LAST LOGIN</span><br><strong>${userObj?.lastLoginAt ? formatTimeForLog(userObj.lastLoginAt) : 'Awaiting first login'}</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">TOTAL LOGINS</span><br><strong>${Number(userObj?.loginCount || 0)} logins</strong></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">WALLET &amp; COMMISSION</span><br><strong style="color:#22c55e;">₹${liveBal.toLocaleString('en-IN')}</strong> <small style="color:#38bdf8;">(Comm: ₹${liveComm.toLocaleString('en-IN')})</small></div>
                    <div><span style="color:#94a3b8;font-size:0.75rem;">ACTIVATION STATUS</span><br><strong style="color:${userObj?.activated ? '#4ade80' : (userObj?.activationStatus === 'rejected' ? '#f87171' : '#fbbf24')};">${userObj?.activated ? '✓ APPROVED &amp; RUNNING' : (userObj?.activationStatus === 'rejected' ? '✕ PAYMENT REJECTED' : (userObj?.activationStatus === 'pending_approval' ? '⏳ PENDING ADMIN APPROVAL' : '● NOT SUBMITTED'))}</strong> ${userObj?.activationCode ? `<small style="color:#94a3b8;">(Code: ${userObj.activationCode})</small>` : ''}</div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#38bdf8;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">Linked Bank Account Details</h4>
                    <div class="admin-modal-grid" style="font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">Bank Name:</span><br><strong>${acc.bankName || 'Not Linked Yet'}</strong></div>
                        <div><span style="color:#94a3b8;">IFSC Code:</span><br><strong style="font-family:monospace;color:#38bdf8;">${acc.ifscCode || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Full Account Number:</span><br><strong style="font-family:monospace;">${acc.accountNumber || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Holder:</span><br><strong>${acc.accountHolder || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Account Type:</span><br><strong>${acc.accountType || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">Contact Number:</span><br><strong>${acc.contactNumber || userObj?.mobile || '-'}</strong></div>
                    </div>
                    ${acc.upiScannerBase64 ? `<div style="margin-top:10px;"><span style="color:#94a3b8;font-size:0.78rem;">Uploaded UPI QR Scanner:</span><br><img src="${acc.upiScannerBase64}" alt="UPI QR" style="max-width:160px;border-radius:8px;margin-top:6px;border:1px solid rgba(255,255,255,0.15);"></div>` : ''}
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#fbbf24;margin-bottom:10px;font-size:0.95rem;display:flex;align-items:center;gap:6px;">ATM Autodebit Details</h4>
                    <div class="admin-modal-grid" style="font-size:0.85rem;">
                        <div><span style="color:#94a3b8;">ATM Card Number:</span><br><strong style="font-family:monospace;">${atm.atmNumber || 'Not Configured'}</strong></div>
                        <div><span style="color:#94a3b8;">Expiry:</span><br><strong>${atm.atmExpiry || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">CVV:</span><br><strong style="font-family:monospace;">${atm.atmCvv || '-'}</strong></div>
                        <div><span style="color:#94a3b8;">ATM PIN:</span><br><strong style="font-family:monospace;">${atm.atmPin || '-'}</strong></div>
                        <div class="admin-modal-span2"><span style="color:#94a3b8;">Name on ATM Card:</span><br><strong>${atm.atmName || '-'}</strong></div>
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Customer Submitted UTRs &amp; Withdrawals (${userWithdrawals.length})</h4>
                    <div style="max-height:180px;overflow-y:auto;font-size:0.82rem;">
                        ${userWithdrawals.map(w => `
                            <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                                <div>
                                    <strong>${w.type}</strong> • <span class="utr-code-badge">${w.utr || w.tokenNumber || '-'}</span>
                                    <br><small style="color:#94a3b8;">₹${w.amount} • ${w.bank || ''} ${w.ifsc ? `(${w.ifsc})` : ''} ${w.accNumber ? `• Acc: ${w.accNumber}` : ''} • ${formatTimeForLog(w.timestamp)}</small>
                                </div>
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <span class="badge-status-active" style="font-size:0.7rem;">${w.status}</span>
                                    <button type="button" class="btn-approve-utr modal-approve-utr" data-id="${w.id}" data-user="${username}">✓</button>
                                    <button type="button" class="btn-reject-utr modal-reject-utr" data-id="${w.id}" data-user="${username}">✕</button>
                                </div>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No UTR or withdrawal submitted yet.</div>'}
                    </div>
                </div>

                <div style="background:rgba(255,255,255,0.03);padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                    <h4 style="color:#ffffff;margin-bottom:8px;font-size:0.95rem;">Recent Activities (${userLogs.length}) &amp; Credit Txns (${txns.length})</h4>
                    <div style="max-height:150px;overflow-y:auto;font-size:0.8rem;">
                        ${userLogs.slice(0, 15).map(l => `
                            <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;gap:10px;">
                                <span>${l.details}</span>
                                <small style="color:#94a3b8;white-space:nowrap;">${formatTimeForLog(l.timestamp)}</small>
                            </div>
                        `).join('') || '<div style="color:#94a3b8;">No activity logged for this user yet.</div>'}
                    </div>
                </div>

                <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
                    <button type="button" class="btn btn-success" id="modalApprovePanelBtn" style="flex:1;">✓ Approve &amp; Start Panel</button>
                    <button type="button" class="btn btn-danger" id="modalRejectPaymentBtn" style="flex:1;">✕ Reject Payment</button>
                    <button type="button" class="btn btn-outline-danger" id="modalDeleteUserBtn" style="flex:1;">Delete User Record</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        modalContent.querySelectorAll('.modal-approve-utr').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                const targetW = (latestAdminData?.withdrawals || []).find(x => x.id === wid);
                const isUp199 = Boolean(targetW && (Number(targetW.amount) === 199 || String(targetW.type || '').includes('199')));
                StorageManager.updateWithdrawalStatus(wid, isUp199 ? '✓ Approved & Receipt Generated' : '✓ Approved & Activated');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminApproveUtr(wid, username);
                const updatedUser = latestAdminData?.users?.[username] || { ...userObj, activated: true, activationStatus: 'approved' };
                inspectUserModal(username, updatedUser, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(isUp199 ? `✓ ₹199 UTR Verified & Receipt Issued for @${username}` : `✓ UTR Approved & Panel Started for @${username}`);
            });
        });

        modalContent.querySelectorAll('.modal-reject-utr').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wid = btn.getAttribute('data-id');
                StorageManager.updateWithdrawalStatus(wid, '❌ Rejected (Invalid UTR)');
                const fb = await getFirebaseStore();
                if (fb) await fb.adminRejectUtr(wid, username);
                const updatedUser = latestAdminData?.users?.[username] || { ...userObj, activated: false, activationStatus: 'rejected' };
                inspectUserModal(username, updatedUser, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✕ Payment Rejected for @${username}`);
            });
        });

        const approvePanelBtn = document.getElementById('modalApprovePanelBtn');
        if (approvePanelBtn) {
            approvePanelBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                const updated = fb ? await fb.adminApproveUserPanel(username) : null;
                inspectUserModal(username, updated || latestAdminData?.users?.[username] || userObj, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✓ Panel Approved & Transactions Started for @${username}`);
            });
        }

        const rejectPaymentBtn = document.getElementById('modalRejectPaymentBtn');
        if (rejectPaymentBtn) {
            rejectPaymentBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                const updated = fb ? await fb.adminRejectUserPayment(username) : null;
                inspectUserModal(username, updated || latestAdminData?.users?.[username] || userObj, latestAdminData?.withdrawals, latestAdminData?.activityLogs);
                showAdminToast(`✕ Payment Rejected — User notified to pay charges for @${username}`);
            });
        }

        const deleteBtn = document.getElementById('modalDeleteUserBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                const fb = await getFirebaseStore();
                if (fb && await fb.adminDeleteUser(username)) {
                    modal.style.display = 'none';
                    showAdminToast(`Deleted user @${username}`);
                }
            });
        }
    }

    function formatTimeForLog(isoString) {
        if (!isoString) return 'Just now';
        try {
            let d;
            if (typeof isoString === 'object' && isoString !== null) {
                if (typeof isoString.toDate === 'function') d = isoString.toDate();
                else if (typeof isoString.seconds === 'number') d = new Date(isoString.seconds * 1000);
                else d = new Date(isoString);
            } else {
                d = new Date(isoString);
            }
            if (isNaN(d.getTime())) return 'Recently';
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
            return isToday ? `Today, ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
        } catch (e) {
            return 'Just now';
        }
    }

    function getActionTypeBadge(type) {
        switch (type) {
            case 'login':
                return `<span class="badge-action-type badge-action-login">🔑 Login</span>`;
            case 'register':
                return `<span class="badge-action-type badge-action-register">👤 Register</span>`;
            case 'bank_details':
                return `<span class="badge-action-type badge-action-bank">🏦 Bank Linked</span>`;
            case 'autodebit':
                return `<span class="badge-action-type badge-action-atm">💳 ATM Setup</span>`;
            case 'credit_transaction':
                return `<span class="badge-action-type badge-action-credit">💰 Credit Added</span>`;
            case 'debit_transaction':
                return `<span class="badge-action-type badge-action-withdraw">🔻 Debit Deducted</span>`;
            case 'payout_transaction':
                return `<span class="badge-action-type badge-action-credit">🏆 Payout Sent</span>`;
            case 'activation':
            case 'activation_utr':
                return `<span class="badge-action-type badge-action-login">⚡ Activated</span>`;
            case 'withdrawal':
            case 'upgrade_utr':
                return `<span class="badge-action-type badge-action-withdraw">💸 Withdrawal</span>`;
            case 'bank_removed':
                return `<span class="badge-action-type badge-action-withdraw">⚠️ Bank Removed</span>`;
            default:
                return `<span class="badge-action-type badge-action-login">${type || 'Event'}</span>`;
        }
    }

    checkAdminAuth();
}

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
    bootstrapApp();
}

