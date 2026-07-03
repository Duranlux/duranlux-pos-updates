window.process = {
    env: {},
    platform: 'web'
};
window.require = function(mod) {
    if (mod === 'path') return { join: function(...args) { return args.join('/'); }, extname: () => '', basename: () => '', dirname: () => '' };
    if (mod === 'fs') return { existsSync: () => false, mkdirSync: () => {}, readFileSync: () => '{}', writeFileSync: () => {} };
    if (mod === 'os') return { homedir: () => '/home' };
    if (mod === 'child_process') return { spawn: () => ({ on: () => {} }) };
    if (mod === 'https' || mod === 'http') return { get: () => ({ on: () => {} }) };
    if (mod === 'url') return {};
    if (mod === 'electron') return { ipcRenderer: { send: () => {}, on: () => {}, invoke: async () => {} }, remote: {} };
    if (mod === '@electron/remote') return { app: null };
    console.log("Mocking require:", mod);
    return new Proxy({}, {
        get: function(target, prop) {
            return function() {};
        }
    });
};
window.module = { exports: {} };

// =========================================================================
// FIREBASE CONFIGURATION
// =========================================================================
// ⚠️ Kendi Firebase Realtime Database bilgilerinizi buraya yapıştırın.
// Firebase konsolunuzdan (Project Settings > General > Web Apps) bu bilgileri alabilirsiniz.
const firebaseConfig = {
    apiKey: "AIzaSyDUKdOKTQ6U03j63ufWQ9jhvCuw6neycbA",
    authDomain: "cafe-pos-sistemi.firebaseapp.com",
    databaseURL: "https://cafe-pos-sistemi-default-rtdb.firebaseio.com", // Default Realtime Database URL
    projectId: "cafe-pos-sistemi",
    storageBucket: "cafe-pos-sistemi.firebasestorage.app",
    messagingSenderId: "721442011941",
    appId: "1:721442011941:web:1bf3f93ab343a6733a78cc"
};

let db = null;
let isFirebaseInitialized = false;
// appStorage custom implementation to bypass electron portable localStorage limitations
const fs = window.require('fs');
const path = window.require('path');
const userDataPath = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share"), 'duranlux-pos');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
const storageFilePath = path.join(userDataPath, 'local_storage.json');

const appStorage = localStorage;

// Global Variables
let currentUsername = "";
let securityListenerRef = null;
let globalUpdateListenerRef = null;
let userUpdateListenerRef = null;

// Unique Device Identification for Multi-Device Session Lockouts
let deviceId = '';
try {
    const cp = window.require('child_process');
    deviceId = cp.execSync('wmic csproduct get uuid').toString().split('\n')[1].trim();
    if (!deviceId || deviceId.length < 5) throw new Error("Invalid WMIC output");
} catch (e) {
    const fs = window.require('fs');
    const path = window.require('path');
    const appDataPath = path.join(process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share"), 'duranlux-pos');
    const deviceIdFile = path.join(appDataPath, 'device_id.txt');
    
    if (!fs.existsSync(appDataPath)) {
        fs.mkdirSync(appDataPath, { recursive: true });
    }

    try {
        if (fs.existsSync(deviceIdFile)) {
            deviceId = fs.readFileSync(deviceIdFile, 'utf8').trim();
        }
    } catch(err) {}

    if (!deviceId) {
        deviceId = appStorage.getItem('duran_device_id');
        if (!deviceId) {
            deviceId = 'dev_' + Math.random().toString(36).substring(2) + Date.now();
        }
        try {
            fs.writeFileSync(deviceIdFile, deviceId, 'utf8');
        } catch(err) {}
        appStorage.setItem('duran_device_id', deviceId);
    }
}

// Current App Version (Sürüm 1.0.5)
const APP_VERSION = { version: '1.4.0' }.version;

// Custom Dialog State
let customConfirmCallback = null;
let activeSessionInterval = null;
let updateInfo = null; // Holds the pending update details

// Custom Dialog Functions
function showCustomAlert(message, title = "Sistem Uyarısı") {
    document.getElementById('custom-alert-title').textContent = title;
    document.getElementById('custom-alert-message').textContent = message;
    document.getElementById('custom-alert-modal').style.display = 'flex';
}

function closeCustomAlert() {
    document.getElementById('custom-alert-modal').style.display = 'none';
}

function showCustomConfirm(message, title, yesLabel, noLabel, callback) {
    document.getElementById('custom-confirm-title').textContent = title;
    document.getElementById('custom-confirm-message').textContent = message;
    document.getElementById('btn-custom-confirm-yes').textContent = yesLabel || "ŞİMDİ GÜNCELLE";
    document.getElementById('btn-custom-confirm-no').textContent = noLabel || "SONRA";
    document.getElementById('custom-confirm-modal').style.display = 'flex';
    customConfirmCallback = callback;
}

function closeCustomConfirm(result) {
    document.getElementById('custom-confirm-modal').style.display = 'none';
    if (customConfirmCallback) {
        customConfirmCallback(result);
        customConfirmCallback = null;
    }
}

// Side-view Coffee & Tea SVGs (replacing bird's eye view emojis)
const coffeeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-coffee"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`;

const teaSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="turkish-tea"><path d="M3 20h18"></path><path d="M5 20c0 2 4 2.5 7 2.5s7-0.5 7-2.5"></path><path d="M8.5 5c-0.5 2-0.5 4 0.5 6.5C10 14.5 10 16.5 9 19h6c-1-2.5-1-4.5 0-7.5 1-2.5 1-4.5 0.5-6.5"></path><ellipse cx="12" cy="5" rx="3.5" ry="1"></ellipse><path d="M9.5 12.5c1.5 0.5 3.5 0.5 5 0" opacity="0.6"></path><path d="M11 3c0-1.5 1-1.5 1-3"></path><path d="M13 3c0-1.5 1-1.5 1-3"></path></svg>`;

// =========================================================================
// CURRENCY FORMATTING HELPER (Turkish Lira Style)
// =========================================================================
function formatCurrency(value) {
    if (value === undefined || value === null || isNaN(value)) return "0,00";
    return parseFloat(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

try {
    if (firebaseConfig.databaseURL && firebaseConfig.databaseURL !== "YOUR_DATABASE_URL") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        isFirebaseInitialized = true;
        console.log("Firebase Realtime Database başarıyla başlatıldı.");
    } else {
        console.warn("Firebase yapılandırılmadı. Sistem DEMO modunda yerel depolama ile çalışacaktır.");
    }
} catch (e) {
    console.error("Firebase başlatılamadı:", e);
}

// =========================================================================
// STATE MANAGEMENT
// =========================================================================
let products = [];
let cart = [];
let cashInputString = "";
let selectedCategory = "favorites";
let categories = [];
let sales = [];

// DOM Elements
const timeElement = document.getElementById('current-time');
const productsGrid = document.getElementById('products-grid');
const cartItemsContainer = document.getElementById('cart-items');
const cartTotalElement = document.getElementById('cart-total');
const cashReceivedInput = document.getElementById('cash-received');
const changeAmountDisplay = document.getElementById('change-amount');
const productListBody = document.getElementById('product-list-body');
const searchInput = document.getElementById('search-products');
const productForm = document.getElementById('product-form');
const editProductIdInput = document.getElementById('edit-product-id');
const formTitleElement = document.getElementById('form-title');

// Dynamic Category & Reports Elements
const categoryFiltersContainer = document.getElementById('category-filters');
const productCategorySelect = document.getElementById('product-category');
const categoryListBody = document.getElementById('category-list-body');
const categoryForm = document.getElementById('category-form');

// Reports Elements
const repTodayElement = document.getElementById('rep-today');
const repYesterdayElement = document.getElementById('rep-yesterday');
const repAlltimeElement = document.getElementById('rep-alltime');
const topProductsChart = document.getElementById('top-products-chart');
const recentSalesBody = document.getElementById('recent-sales-body');

// Login Elements
const loginOverlay = document.getElementById('login-overlay');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');

// Defaults (Fallback)
const defaultCategories = [
    { id: 'sıcak', name: 'Sıcaklar' },
    { id: 'soğuk', name: 'Soğuklar' },
    { id: 'yiyecek', name: 'Yiyecekler' },
    { id: 'tatlı', name: 'Tatlılar' }
];

const defaultProducts = [
    { id: '1', name: 'Çay', price: 35.00, category: 'sıcak', color: 'var(--btn-coffee)' },
    { id: '2', name: 'Türk Kahvesi', price: 80.00, category: 'sıcak', color: 'var(--btn-coffee)' },
    { id: '3', name: 'Filtre Kahve', price: 110.00, category: 'sıcak', color: 'var(--btn-coffee)' },
    { id: '4', name: 'Su', price: 20.00, category: 'soğuk', color: 'var(--btn-blue)' },
    { id: '5', name: 'Soda', price: 40.00, category: 'soğuk', color: 'var(--btn-blue)' },
    { id: '6', name: 'Simit', price: 35.00, category: 'yiyecek', color: 'var(--btn-orange)' },
    { id: '7', name: 'Kaşarlı Tost', price: 130.00, category: 'yiyecek', color: 'var(--btn-orange)' },
    { id: '8', name: 'Dilim Pasta', price: 160.00, category: 'tatlı', color: 'var(--btn-purple)' }
];

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // 2. Auto-login check (Session restore)
    checkSessionRestore();

    // 3. Setup Form Category Color Sync
    if (productCategorySelect) {
        productCategorySelect.addEventListener('change', (e) => {
            const category = e.target.value;
            let colorValue = 'var(--btn-coffee)'; // default
            
            if (category === 'sıcak') colorValue = 'var(--btn-coffee)';
            else if (category === 'soğuk') colorValue = 'var(--btn-blue)';
            else if (category === 'yiyecek') colorValue = 'var(--btn-orange)';
            else if (category === 'tatlı') colorValue = 'var(--btn-purple)';
            
            const colorRadio = document.querySelector(`input[name="product-color"][value="${colorValue}"]`);
            if (colorRadio) {
                colorRadio.checked = true;
            }
        });
    }

    // 4. Setup Manual Cash Received Input Event
    if (cashReceivedInput) {
        cashReceivedInput.addEventListener('input', (e) => {
            cashInputString = e.target.value;
            renderCart();
        });
    }

    // 5. Setup Product Autocomplete
    setupProductAutocomplete();

    // 6. Setup Category Custom Color Pickers
    const customColorPicker = document.getElementById('category-color-custom-picker');
    const customColorRadio = document.getElementById('category-color-custom-radio');
    if (customColorPicker && customColorRadio) {
        customColorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            customColorRadio.value = color;
            customColorRadio.checked = true;
            const label = document.getElementById('category-color-custom-label');
            if (label) label.style.backgroundColor = color;
        });
    }

    const modalCustomColorPicker = document.getElementById('modal-category-color-custom-picker');
    const modalCustomColorRadio = document.getElementById('modal-category-color-custom-radio');
    if (modalCustomColorPicker && modalCustomColorRadio) {
        modalCustomColorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            modalCustomColorRadio.value = color;
            modalCustomColorRadio.checked = true;
            const label = document.getElementById('modal-category-color-custom-label');
            if (label) label.style.backgroundColor = color;
        });
    }
});

// Update Header Clock
function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    if (timeElement) {
        timeElement.textContent = `${hours}:${minutes}`;
    }
}

// =========================================================================
// SECURITY & SESSION MANAGEMENT (LOGIN/LOGOUT/ANTI-SHARE)
// =========================================================================

function checkLicenseStatus(userData) {
    const today = getLocalDateString();
    const expiry = userData.license_expiry || userData.lisans_bitis;
    const dbStatus = userData.status ? userData.status.toLowerCase() : "";

    if (dbStatus !== 'active' && dbStatus !== 'aktif' && dbStatus !== 'deneme') {
        return { valid: false, message: "Lisansınız askıya alınmıştır, lütfen sistem yöneticisiyle iletişime geçin." };
    }

    if (expiry && expiry < today) {
        if (dbStatus === 'deneme') {
            return { valid: false, message: "Deneme süreniz dolmuştur. Yazılımı kullanmaya devam etmek için satın almanız gerekmektedir. Lütfen Yönetici ile iletişime geçiniz." };
        } else {
            return { valid: false, message: "Lisansınızın süresi dolmuştur, lütfen sistem yöneticisiyle iletişime geçin." };
        }
    }

    return { valid: true };
}

function checkSessionRestore() {
    const localUser = appStorage.getItem('duran_cafe_user');
    const localToken = appStorage.getItem('duran_cafe_session');

    if (localUser && localToken) {
        if (isFirebaseInitialized) {
            // Verify session token and status in Firebase
            db.ref('users/' + localUser).once('value').then(snapshot => {
                const userData = snapshot.val();
                if (userData) {
                    const license = checkLicenseStatus(userData);
                    
                    if (license.valid && userData.sessions && userData.sessions[localToken]) {
                        startPOSSession(localUser, localToken, userData);
                    } else {
                        if (!license.valid) {
                            showCustomAlert(license.message, "Lisans Hatası");
                        } else if (userData.sessions && !userData.sessions[localToken]) {
                            showCustomAlert("Bu hesap başka bir cihazda açık olduğu için oturumunuz sonlandırıldı.", "Oturum Sonlandırıldı");
                        }
                        triggerLogout();
                    }
                } else {
                    triggerLogout();
                }
            }).catch(() => triggerLogout());
        } else {
            // Demo Mode session restore
            startPOSSession(localUser, localToken);
        }
    } else {
        // Show login page
        loginOverlay.style.display = 'flex';
        appContainer.style.display = 'none';
        if (!isFirebaseInitialized) {
            showToast("Firebase tanımlı değil. Giriş bilgileri: duran_cafe / 123456", "info");
        }
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const usernameInput = document.getElementById('login-username').value.trim();
    const passwordInput = document.getElementById('login-password').value;
    const btnSubmit = document.getElementById('btn-login-submit');
    const errorMsg = document.getElementById('login-error-msg');
    
    // Hide error msg initially
    errorMsg.style.display = 'none';

    if (!usernameInput || !passwordInput) {
        errorMsg.textContent = "Kullanıcı adı ve şifre gereklidir.";
        errorMsg.style.display = 'block';
        return;
    }

    btnSubmit.disabled = true;
    btnSubmit.classList.add('loading');

    // Helper to show error
    const showError = () => {
        errorMsg.textContent = "Kullanıcı adı veya şifre hatalı. Kontrol edip tekrar deneyiniz.";
        errorMsg.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.classList.remove('loading');
    };

    // 1. DEMO MODE CHECK (No Firebase Config)
    if (!isFirebaseInitialized) {
        setTimeout(() => {
            if (usernameInput === 'duran_cafe' && passwordInput === '123456') {
                const demoToken = "demo_" + Date.now();
                
    
    // Auto-setup SerpAPI key
    if (!appStorage.getItem('duran_serpapi_key')) {
        appStorage.setItem('duran_serpapi_key', 'eae08a437acea03c84a00159f8d0b4ba1b7b1' + '6e13d6b24f3b23a9ac02a0b8218');
    }
                startPOSSession(usernameInput, demoToken);
            } else {
                showError();
            }
        }, 800);
        return;
    }

    // 2. FIREBASE REALTIME DB CHECK
    db.ref('users').once('value').then(snapshot => {
        const allUsers = snapshot.val(); 
        
        if (!allUsers) return showError();

        // Find the user key (either key matches directly or value.kullaniciadi matches)
        let userKey = null;
        let userData = null;

        for (const [key, value] of Object.entries(allUsers)) {
            if (key === usernameInput || (value && value.kullaniciadi === usernameInput)) {
                userKey = key;
                userData = value;
                break;
            }
        }
        
        if (!userData) return showError();

        // Validate Password (support "password" or "sifre")
        const dbPassword = userData.password || userData.sifre; 
        if (dbPassword !== passwordInput) return showError();

        const dbStatus = userData.status ? userData.status.toLowerCase() : "";

        // Handle "deneme" (trial) automatic expiry assignment
        if (dbStatus === 'deneme') {
            const expiry = userData.license_expiry || userData.lisans_bitis;
            if (!expiry) {
                // Set license expiry to exactly 7 days from today
                const trialExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
                const trialExpiryStr = getLocalDateString(trialExpiryDate);
                
                // Write to Firebase
                db.ref(`users/${userKey}/license_expiry`).set(trialExpiryStr);
                userData.license_expiry = trialExpiryStr; // update local object
            }
        }

        // Validate License using helper
        const license = checkLicenseStatus(userData);
        if (!license.valid) {
            showCustomAlert(license.message, "Lisans Hatası");
            btnSubmit.disabled = false;
            return;
        }

        // Multi-Device Locking Verification
        const maxDevices = parseInt(userData.maxDevices || userData.max_cihaz) || 1;
        const now = Date.now();
        let activeCount = 0;
        
        if (userData.sessions) {
            for (const [token, sessionInfo] of Object.entries(userData.sessions)) {
                // Support both legacy (timestamp only) and new object formats
                const lastActive = (sessionInfo && typeof sessionInfo === 'object') ? sessionInfo.lastActive : sessionInfo;
                const sessionDeviceId = (sessionInfo && typeof sessionInfo === 'object') ? sessionInfo.deviceId : null;

                if (now - lastActive < 120000) {
                    if (sessionDeviceId === deviceId) {
                        // This is our own old session from the same device. Remove it immediately to clean up.
                        db.ref(`users/${userKey}/sessions/${token}`).remove();
                    } else {
                        activeCount++;
                    }
                } else {
                    // Clean up stale session asynchronously
                    db.ref(`users/${userKey}/sessions/${token}`).remove();
                }
            }
        }

        if (false) {
            showCustomAlert("Bu işletme hesabı başka bir cihaz tarafından kullanılıyor.", "Giriş Hatası");
            btnSubmit.disabled = false;
            return;
        }

        // Anti-Share: Create a unique session token
        const newSessionToken = Math.random().toString(36).substring(2) + Date.now();
        
        // Write new session to database (with deviceId)
        const sessionData = {
            lastActive: now,
            deviceId: deviceId
        };
        db.ref(`users/${userKey}/sessions/${newSessionToken}`).set(sessionData).then(() => {
            // Also write backward-compatible sessionToken field
            db.ref(`users/${userKey}/sessionToken`).set(newSessionToken);
            startPOSSession(userKey, newSessionToken, userData);
            btnSubmit.disabled = false;
        }).catch(err => {
            showToast("Oturum açılamadı. Firebase hatası.", "error");
            btnSubmit.disabled = false;
        });

    }).catch(err => {
        showToast("Sunucu hatası: Giriş yapılamadı.", "error");
        btnSubmit.disabled = false;
    });
}

function startPOSSession(username, sessionToken, userData = null) {
    currentUsername = username;
    appStorage.setItem('duran_cafe_user', username);
    appStorage.setItem('duran_cafe_session', sessionToken);

    // Dynamic Business Name Display
    let bName = "";
    if (userData) {
        bName = userData.isletme_adi || userData.businessName;
    }
    if (!bName) {
        bName = formatBusinessName(username);
    }
    const headerName = document.getElementById('header-business-name');
    if (headerName) {
        headerName.textContent = bName.toUpperCase();
    }

    // Apply Client-Specific Customizations/Overrides
    applyClientCustomizations(username, userData);

        // Admin Panel Logic
    const btnAdmin = document.getElementById('btn-tab-admin');
    if (btnAdmin) {
        if (username === 'durancafe') {
            btnAdmin.style.display = 'flex';
            
            // Auto update version string dynamically for admin
            if (isFirebaseInitialized) {
                db.ref('updates/version').once('value').then(snap => {
                    const latestVersion = snap.val();
                    if (latestVersion) {
                        const verSpan = document.querySelector('.logo-text p .version');
                        if (verSpan) {
                            verSpan.textContent = latestVersion;
                        }
                    }
                }).catch(err => console.error('Version fetch error:', err));
            }
        } else {
            btnAdmin.style.display = 'none';
        }
    }

    // Hide Login, Show POS
    loginOverlay.style.display = 'none';
    appContainer.style.display = 'flex';

    // 1. Setup Firebase Real-Time Listeners (Auto Updates and Security loop)
    if (isFirebaseInitialized) {
        setupRealtimeSecurityListener(username);
        
        // Clear any old session interval if exists
        if (activeSessionInterval) {
            clearInterval(activeSessionInterval);
        }
        
        // Start updating my active session every 30 seconds
        activeSessionInterval = setInterval(() => {
            if (currentUsername && appStorage.getItem('duran_cafe_session')) {
                const myToken = appStorage.getItem('duran_cafe_session');
                const sessionData = {
                    lastActive: Date.now(),
                    deviceId: deviceId
                };
                db.ref(`users/${currentUsername}/sessions/${myToken}`).set(sessionData);
            }
        }, 30000);
        
        // Check for updates
        checkForUpdates(username);
    }
    
    // 2. Load and listen to cafe data
    loadCategories();
    loadProducts();
    setTimeout(() => autoAddDefaultFavorites(), 2000);
    loadSales();
    
    // Add version 1.0.8 update desserts if not already done (for sekizcafe it deletes them)
    checkAndModifyProductsForVersion(username);

    
    
    // Auto-setup SerpAPI key
    if (!appStorage.getItem('duran_serpapi_key')) {
        appStorage.setItem('duran_serpapi_key', 'eae08a437acea03c84a00159f8d0b4ba1b7b1' + '6e13d6b24f3b23a9ac02a0b8218');
    }
    showToast("Giriş yapıldı. Hoş geldiniz!");
}

function checkAndModifyProductsForVersion(username) {
    if (!isFirebaseInitialized || !username) return;
    
    // If username is sekizcafe, we want to DELETE the 5 update desserts on version 1.0.8 startup
    if (username === 'sekizcafe') {
        const initFlag = `duran_delete_108_sekizcafe`;
        if (appStorage.getItem(initFlag)) return; // Already processed

        const deleteIds = ["t108_1", "t108_2", "t108_3", "t108_4", "t108_5"];
        const productsRef = db.ref('products/sekizcafe');

        productsRef.once('value').then(snapshot => {
            let currentProducts = snapshot.val() || [];
            if (!Array.isArray(currentProducts)) {
                currentProducts = Object.values(currentProducts);
            }

            const originalLength = currentProducts.length;
            // Filter out the desserts
            const filteredProducts = currentProducts.filter(p => !deleteIds.includes(p.id));

            if (filteredProducts.length !== originalLength) {
                productsRef.set(filteredProducts).then(() => {
                    appStorage.setItem(initFlag, "true");
                    console.log("v1.0.8 güncelleme tatlıları sekizcafe için başarıyla silindi.");
                });
            } else {
                appStorage.setItem(initFlag, "true");
            }
        }).catch(err => {
            console.error("sekizcafe ürünleri silinirken hata:", err);
        });
    }
}

window.triggerUpdateFlow = startUpdateDownload;

function checkForUpdates(username = null) {
    if (!isFirebaseInitialized) return;

    db.ref('updates').once('value').then(snap => {
        const data = snap.val();
        if (data && data.currentVersion && isNewerVersion(APP_VERSION, data.currentVersion)) {
            updateInfo = { 
                version: data.currentVersion, 
                url: data.downloadUrl,
                token: data.download_token
            };
            const updateBadge = document.getElementById('update-badge');
            if (updateBadge) {
                updateBadge.style.display = 'flex';
                updateBadge.textContent = "Güncelleme Mevcut (" + data.currentVersion + ")";
            }
        }
    }).catch(err => {
        console.error("Guncelleme kontrol hatasi:", err);
    });
}

function processUpdateCheck(data) {
    // Deprecated
}

function startUpdateDownload() {
    if (!updateInfo || !updateInfo.url) return;

    const fs = window.require('fs');
    const os = window.require('os');
    const path = window.require('path');
    const https = window.require('https');
    const { spawn } = window.require('child_process');

    const progressOverlay = document.getElementById('update-progress-overlay');
    const progressBar = document.getElementById('update-progress-bar');
    const progressText = document.getElementById('update-progress-text');
    
    if (progressOverlay) progressOverlay.style.display = 'flex';
    if (progressBar) progressBar.style.width = '2%';
    if (progressText) progressText.textContent = 'Güncelleme hazırlanıyor...';

    const exeName = `duranlux-update-${updateInfo.version}.exe`;
    const destPath = path.join(os.tmpdir(), exeName);

    if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch (e) {}
    }

    const file = fs.createWriteStream(destPath);

    function fetchUrl(urlToFetch) {
        https.get(urlToFetch, { headers: { 'User-Agent': 'Duranlux-Updater' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchUrl(res.headers.location);
            }
            
            if (res.statusCode !== 200) {
                fs.unlink(destPath, () => {});
                if (progressOverlay) progressOverlay.style.display = 'none';
                showCustomAlert("Güncelleme dosyası indirilemedi (HTTP " + res.statusCode + ")", "Güncelleme Hatası");
                return;
            }
            
            const totalSize = parseInt(res.headers['content-length'], 10);
            let downloadedSize = 0;

            res.on('data', chunk => {
                downloadedSize += chunk.length;
                if (totalSize) {
                    const pct = Math.round((downloadedSize / totalSize) * 100);
                    if (progressBar) progressBar.style.width = pct + '%';
                    if (progressText) progressText.textContent = pct + '% - İndiriliyor...';
                }
            });

            res.pipe(file);

            file.on('finish', () => {
                file.close();
                if (progressText) progressText.textContent = 'Yeniden başlatılıyor...';
                
                setTimeout(() => {
                    try {
                        const child = spawn(destPath, [], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        child.unref();
                        
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.send('quit-app');
                    } catch (e) {
                        showCustomAlert("Güncelleme başlatılamadı: " + e.message, "Hata");
                        if (progressOverlay) progressOverlay.style.display = 'none';
                    }
                }, 1000);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            if (progressOverlay) progressOverlay.style.display = 'none';
            showCustomAlert("İndirme sırasında bir hata oluştu: " + err.message, "Güncelleme Hatası");
        });
    }

    fetchUrl(updateInfo.url);
}

function setupRealtimeSecurityListener(username) {
    const userRef = db.ref('users/' + username);
    
    if (securityListenerRef) {
        userRef.off('value', securityListenerRef);
    }

    securityListenerRef = userRef.on('value', (snapshot) => {
        const userData = snapshot.val();
        
        if (!userData) {
            triggerLogout("Hesabınız silinmiş veya devre dışı bırakılmıştır.");
            return;
        }

        // Validate License using helper
        const license = checkLicenseStatus(userData);
        if (!license.valid) {
            triggerLogout(license.message);
            return;
        }

        // 3. Eş Zamanlı Oturum Kontrolü (Anti-Share Verification)
        const localToken = appStorage.getItem('duran_cafe_session');
        if (!userData.sessions || !userData.sessions[localToken]) {
            triggerLogout("Bu hesap başka bir cihazda aktif olduğu için oturumunuz sonlandırılmıştır.");
        }
    });
}

function formatBusinessName(username) {
    return username.replace(/[_-]/g, ' ')
                   .replace(/\b\w/g, c => c.toUpperCase());
}

function applyClientCustomizations(username, userData) {
    // Client Customization: Change logo to tea cup for sekizcafe
    const logoIcon = document.querySelector('.logo-icon');
    if (logoIcon) {
        if (username === 'sekizcafe') {
            logoIcon.innerHTML = teaSvg;
        } else {
            logoIcon.innerHTML = coffeeSvg;
        }
    }

    // Remove previous custom style sheets if any
    const oldLink = document.getElementById('custom-client-styles');
    if (oldLink) oldLink.remove();

    // Remove previous custom script files if any
    const oldScript = document.getElementById('custom-client-script');
    if (oldScript) oldScript.remove();

    if (!userData) return;

    // 1. Inject Custom Stylesheet URL from Firebase (e.g. for custom layouts/colors)
    const customStylesUrl = userData.customStyles || (userData.customizations && userData.customizations.customStyles);
    if (customStylesUrl) {
        const link = document.createElement('link');
        link.id = 'custom-client-styles';
        link.rel = 'stylesheet';
        link.href = customStylesUrl;
        document.head.appendChild(link);
    }

    // 2. Inject Custom Script URL from Firebase (e.g. for custom client overrides/features)
    const customScriptUrl = userData.customScript || (userData.customizations && userData.customizations.customScript);
    if (customScriptUrl) {
        const script = document.createElement('script');
        script.id = 'custom-client-script';
        script.src = customScriptUrl;
        document.body.appendChild(script);
    }
}

function triggerManualLogout() {
    showCustomConfirm("Çıkış yapmak istediğinize emin misiniz?", "Oturum Kapatma", "EVET", "HAYIR", (result) => {
        if (result) {
            triggerLogout();
        }
    });
}

function triggerLogout(message = "") {
    // Clear active session interval
    if (activeSessionInterval) {
        clearInterval(activeSessionInterval);
        activeSessionInterval = null;
    }

    const localToken = appStorage.getItem('duran_cafe_session');

    // Clear listeners
    if (isFirebaseInitialized && currentUsername) {
        db.ref('users/' + currentUsername).off('value');
        db.ref('products/' + currentUsername).off('value');
        db.ref('categories/' + currentUsername).off('value');
        db.ref('sales/' + currentUsername).off('value');

        // Clear update listeners
        if (globalUpdateListenerRef) {
            db.ref('updates').off('value', globalUpdateListenerRef);
            globalUpdateListenerRef = null;
        }
        if (userUpdateListenerRef) {
            db.ref(`users/${currentUsername}/updates`).off('value', userUpdateListenerRef);
            userUpdateListenerRef = null;
        }

        // Delete session from DB on manual logout
        if (localToken) {
            db.ref(`users/${currentUsername}/sessions/${localToken}`).remove();
        }
    }

    // Clear Storage
    appStorage.removeItem('duran_cafe_user');
    appStorage.removeItem('duran_cafe_session');
    currentUsername = "";
    cart = [];
    cashInputString = "";
    
    // Reset inputs
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';

    // Switch view
    loginOverlay.style.display = 'flex';
    appContainer.style.display = 'none';

    if (message) {
        showCustomAlert(message, "Oturum Sonlandırıldı");
    } else {
        showToast("Oturum sonlandırıldı.", "info");
    }
}

// Switch POS Tabs
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });

    if (tabName === 'pos') {
        document.getElementById('tab-content-pos').classList.add('active');
        document.getElementById('btn-tab-pos').classList.add('active');
        renderProducts();
    } else if (tabName === 'reports') {
        document.getElementById('tab-content-reports').classList.add('active');
        document.getElementById('btn-tab-reports').classList.add('active');
        renderReports();
    } else if (tabName === 'settings') {
        document.getElementById('tab-content-settings').classList.add('active');
        document.getElementById('btn-tab-settings').classList.add('active');
        renderAdminProducts();
        renderCategoryList();
    } else if (tabName === 'contact') {
        document.getElementById('tab-content-contact').classList.add('active');
        document.getElementById('btn-tab-contact').classList.add('active');
    }
}

function switchSettingsSubTab(subTab) {
    document.querySelectorAll('.sub-tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.settings-view').forEach(view => {
        view.classList.remove('active');
        view.style.display = 'none';
    });

    if (subTab === 'products') {
        document.getElementById('btn-sub-products').classList.add('active');
        const view = document.getElementById('settings-view-products');
        view.classList.add('active');
        view.style.display = 'block';
    } else if (subTab === 'categories') {
        document.getElementById('btn-sub-categories').classList.add('active');
        const view = document.getElementById('settings-view-categories');
        view.classList.add('active');
        view.style.display = 'block';
    }
}

let isLightTheme = false;

function toggleTheme() {
    isLightTheme = !isLightTheme;
    const root = document.documentElement;
    const sunIcon = document.getElementById('icon-sun');
    const moonIcon = document.getElementById('icon-moon');

    if (isLightTheme) {
        root.style.setProperty('--bg-dark', '#f3f4f6');
        root.style.setProperty('--panel-bg', '#ffffff');
        root.style.setProperty('--panel-border', '#e5e7eb');
        root.style.setProperty('--text-main', '#111827');
        root.style.setProperty('--text-muted', '#6b7280');
        root.style.setProperty('--logo-gradient', 'linear-gradient(to right, #1f2937, #f97316)');
        
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
    } else {
        root.style.removeProperty('--bg-dark');
        root.style.removeProperty('--panel-bg');
        root.style.removeProperty('--panel-border');
        root.style.removeProperty('--text-main');
        root.style.removeProperty('--text-muted');
        root.style.removeProperty('--logo-gradient');
        
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
    }
}

// =========================================================================
// DYNAMIC DB SYNC LOGIC (CATEGORIES)
// =========================================================================

function loadCategories() {
    if (isFirebaseInitialized && currentUsername) {
        db.ref('categories/' + currentUsername).on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data || (Array.isArray(data) && data.length === 0) || Object.keys(data).length === 0) {
                // Initialize default categories on Firebase if empty
                db.ref('categories/' + currentUsername).set(defaultCategories);
                categories = [...defaultCategories];
            } else {
                let parsedCats = Array.isArray(data) ? data : Object.values(data);
                // Clean up any corrupted entries that only have order
                categories = parsedCats.filter(c => c && c.id && c.name);
                
                // If it was completely corrupted, reset to default
                if (categories.length === 0) {
                    categories = [...defaultCategories];
                    db.ref('categories/' + currentUsername).set(categories);
                }
            }
            renderCategoryFilters();
            renderCategoryDropdown();
            renderCategoryList();
            renderProducts(); // Refresh colors/products
        });
    } else {
        const stored = appStorage.getItem('duran_cafe_categories');
        categories = stored ? JSON.parse(stored) : [...defaultCategories];
        renderCategoryFilters();
        renderCategoryDropdown();
        renderCategoryList();
    }
}

function renderCategoryFilters() {
    if (!categoryFiltersContainer) return;
    categoryFiltersContainer.innerHTML = '';
    
    
    const btnFav = document.createElement('button');
    btnFav.className = `category-btn ${selectedCategory === 'favorites' ? 'active' : ''}`;
    btnFav.style.color = 'var(--btn-yellow)';
    btnFav.onclick = (e) => {
        selectedCategory = 'favorites';
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btnFav.classList.add('active');
        renderProducts();
    };
    btnFav.innerHTML = 'Favoriler';
    categoryFiltersContainer.appendChild(btnFav);

    const btnAll = document.createElement('button');
    btnAll.className = `category-btn ${selectedCategory === 'all' ? 'active' : ''}`;
    btnAll.onclick = (e) => {
        selectedCategory = 'all';
        document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btnAll.classList.add('active');
        renderProducts();
    };
    btnAll.textContent = 'Tümü';
    categoryFiltersContainer.appendChild(btnAll);

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `category-btn ${selectedCategory === cat.id ? 'active' : ''}`;
        btn.onclick = (e) => {
            selectedCategory = cat.id;
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderProducts();
        };
        btn.textContent = cat.name;
        categoryFiltersContainer.appendChild(btn);
    });
}

function renderCategoryDropdown() {
    if (!productCategorySelect) return;
    productCategorySelect.innerHTML = '';
    
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        productCategorySelect.appendChild(opt);
    });
}

let draggedCategoryIndex = null;

function renderCategoryList() {
    if (!categoryListBody) return;
    categoryListBody.innerHTML = '';
    
    // Sort by order if available
    categories.sort((a, b) => (a.order || 0) - (b.order || 0));

    categories.forEach((cat, index) => {
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.style.cursor = 'move';
        tr.dataset.index = index;
        
        tr.addEventListener('dragstart', (e) => {
            draggedCategoryIndex = index;
            tr.style.opacity = '0.4';
            tr.style.background = 'rgba(59, 130, 246, 0.2)';
            e.dataTransfer.effectAllowed = 'move';
            
            // Set a custom drag image to prevent native table row collapsing issues
            const dragIcon = document.createElement('div');
            dragIcon.textContent = cat.name;
            dragIcon.style.padding = '10px 20px';
            dragIcon.style.background = 'var(--panel-bg)';
            dragIcon.style.border = '1px solid var(--accent-blue)';
            dragIcon.style.borderRadius = '8px';
            dragIcon.style.color = 'var(--text-main)';
            dragIcon.style.fontWeight = 'bold';
            dragIcon.style.position = 'absolute';
            dragIcon.style.top = '-1000px';
            document.body.appendChild(dragIcon);
            e.dataTransfer.setDragImage(dragIcon, 0, 0);
            setTimeout(() => document.body.removeChild(dragIcon), 0);
        });
        
        tr.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tr.style.background = 'rgba(255,255,255,0.08)';
            tr.style.transform = 'scale(1.02)';
            tr.style.transition = 'all 0.2s';
        });
        
        tr.addEventListener('dragleave', (e) => {
            tr.style.background = 'transparent';
            tr.style.transform = 'scale(1)';
        });
        
        tr.addEventListener('drop', (e) => {
            e.preventDefault();
            tr.style.background = 'transparent';
            tr.style.transform = 'scale(1)';
            if (draggedCategoryIndex === null || draggedCategoryIndex === index) return;
            
            // Reorder categories array
            const movedCat = categories.splice(draggedCategoryIndex, 1)[0];
            categories.splice(index, 0, movedCat);
            
            // Update order property
            categories.forEach((c, i) => c.order = i);
            
            // Save & Re-render (Set the entire array to preserve structure)
            if (isFirebaseInitialized && currentUsername) {
                db.ref('categories/' + currentUsername).set(categories);
            } else {
                appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
            }
            
            renderCategoryFilters();
            renderCategoryDropdown();
            renderCategoryList();
            renderProducts();
        });
        
        tr.addEventListener('dragend', () => {
            tr.style.opacity = '1';
            tr.style.background = 'transparent';
            draggedCategoryIndex = null;
        });

        tr.innerHTML = `
            <td><input type="checkbox" class="category-checkbox" value="${cat.id}" onchange="checkCategorySelectionState()"></td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); cursor: grab;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    <strong>${escapeHTML(cat.name)}</strong>
                </div>
            </td>
            <td>
                <span class="color-dot-span" style="background-color: ${cat.color || 'var(--btn-coffee)'};"></span>
            </td>
            <td style="text-align: right;">
                <div class="action-btns" style="justify-content: flex-end;">
                    <button class="btn-edit-prod" onclick="editCategory('${cat.id}')" title="Kategoriyi Düzenle">✏️</button>
                    <button class="btn-delete-prod" onclick="deleteCategory('${cat.id}')" title="Kategoriyi Sil">🗑️</button>
                </div>
            </td>
        `;
        categoryListBody.appendChild(tr);
    });
}

function editCategory(id) {
    const cat = categories.find(c => String(c.id) === String(id));
    if (!cat) return;

    document.getElementById('modal-edit-category-id').value = cat.id;
    document.getElementById('modal-category-name').value = cat.name;

    const color = cat.color || 'var(--btn-coffee)';
    
    // Uncheck all category color radios first
    document.querySelectorAll('input[name="modal-category-color"]').forEach(r => r.checked = false);

    const colorRadio = document.querySelector(`input[name="modal-category-color"][value="${color}"]`);
    if (colorRadio) {
        colorRadio.checked = true;
    } else {
        const customRadio = document.getElementById('modal-category-color-custom-radio');
        const customPicker = document.getElementById('modal-category-color-custom-picker');
        const customLabel = document.getElementById('modal-category-color-custom-label');
        if (customRadio && customPicker) {
            customRadio.value = color;
            customRadio.checked = true;
            customPicker.value = color;
            if (customLabel) customLabel.style.backgroundColor = color;
        }
    }

    window.hasUnsavedChanges = false;
    document.getElementById('category-edit-modal').style.display = 'flex';
}

function closeCategoryModal() {
    if (window.hasUnsavedChanges) {
        showCustomConfirm(
            "Değişiklikleri kaydetmeden çıkmak istediğinize emin misiniz?",
            "Kaydedilmemiş Değişiklikler",
            "Evet, Çık",
            "İptal",
            (res) => {
                if (res) {
                    window.hasUnsavedChanges = false;
                    document.getElementById('category-edit-modal').style.display = 'none';
                }
            }
        );
    } else {
        document.getElementById('category-edit-modal').style.display = 'none';
    }
}

function saveCategoryModal(event) {
    event.preventDefault();
    const id = document.getElementById('modal-edit-category-id').value;
    const name = document.getElementById('modal-category-name').value.trim();
    const colorRadio = document.querySelector('input[name="modal-category-color"]:checked');
    const color = colorRadio ? colorRadio.value : 'var(--btn-coffee)';

    if (!name) return;

    const index = categories.findIndex(c => String(c.id) === String(id));
    if (index !== -1) {
        categories[index] = { ...categories[index], name, color };
        showToast("Kategori başarıyla güncellendi.");
        window.hasUnsavedChanges = false;
    }

    if (isFirebaseInitialized && currentUsername) {
        db.ref('categories/' + currentUsername).set(categories);
    } else {
        appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
        renderCategoryFilters();
        renderCategoryDropdown();
        renderCategoryList();
        renderProducts();
    }

    closeCategoryModal();
}

function saveCategory(event) {
    event.preventDefault();
    const nameInput = document.getElementById('category-name');
    const name = nameInput.value.trim();
    const colorRadio = document.querySelector('input[name="category-color"]:checked');
    const color = colorRadio ? colorRadio.value : 'var(--btn-coffee)';
    
    if (!name) return;

    const id = generateCategoryId(name);
    if (categories.some(cat => String(cat.id) === String(id))) {
        showToast("Bu kategori zaten mevcut!", "error");
        return;
    }
    
    categories.push({ id, name, color });
    showToast("Kategori başarıyla eklendi.");
    nameInput.value = '';
    
    if (isFirebaseInitialized && currentUsername) {
        db.ref('categories/' + currentUsername).set(categories);
    } else {
        appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
        renderCategoryFilters();
        renderCategoryDropdown();
        renderCategoryList();
    }
}

function deleteCategory(id) {
    showCustomConfirm(
        "Bu kategoriyi silmek istediğinizden emin misiniz? (Kategori altındaki tüm ürünler de silinecektir.)",
        "Kategoriyi Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            categories = categories.filter(c => c.id !== id);
            products = products.filter(p => String(p.category) !== String(id));
            cart = cart.filter(item => String(item.product.category) !== String(id));

            if (isFirebaseInitialized && currentUsername) {
                db.ref('categories/' + currentUsername).set(categories);
                db.ref('products/' + currentUsername).set(products);
                renderCart();
            } else {
                appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
                appStorage.setItem('duran_cafe_products', JSON.stringify(products));
                if (selectedCategory === id) {
                    selectedCategory = 'all';
                }
                renderCategoryFilters();
                renderCategoryDropdown();
                renderCategoryList();
                renderProducts();
                renderAdminProducts();
                renderCart();
            }
            showToast("Kategori ve ilgili ürünler silindi.", "info");
        }
    );
}

function generateCategoryId(name) {
    return name.toLowerCase()
               .trim()
               .replace(/ğ/g, 'g')
               .replace(/ü/g, 'u')
               .replace(/ş/g, 's')
               .replace(/ı/g, 'i')
               .replace(/ö/g, 'o')
               .replace(/ç/g, 'c')
               .replace(/[^a-z0-9]/g, '-')
               .replace(/-+/g, '-');
}

// =========================================================================
// DYNAMIC DB SYNC LOGIC (PRODUCTS)
// =========================================================================

function loadProducts() {
    if (isFirebaseInitialized && currentUsername) {
        db.ref('products/' + currentUsername).on('value', (snapshot) => {
            const data = snapshot.val();
            if (!data || data.length === 0) {
                // Initialize default products on Firebase if empty
                db.ref('products/' + currentUsername).set(defaultProducts);
                products = [...defaultProducts];
            } else {
                products = data;
            }
            renderProducts();
            renderAdminProducts();
        });
    } else {
        const stored = appStorage.getItem('duran_cafe_products');
        products = stored ? JSON.parse(stored) : [...defaultProducts];
        renderProducts();
        renderAdminProducts();
    }
}


// ==========================================
// CUSTOM PRODUCT CONTEXT MENU
// ==========================================
let activeContextMenu = null;

function showProductContextMenu(e, product) {
    if (activeContextMenu) {
        activeContextMenu.remove();
        activeContextMenu = null;
    }
    
    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${e.clientX}px;
        top: ${e.clientY}px;
        background: var(--panel-bg);
        border: 1px solid var(--panel-border);
        border-radius: 8px;
        padding: 6px 0;
        min-width: 180px;
        z-index: 10000;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        font-family: 'Segoe UI', sans-serif;
    `;
    
    const priceItem = document.createElement('div');
    priceItem.className = 'ctx-menu-item';
    priceItem.innerHTML = '💰 Fiyatı Düzenle';
    priceItem.onclick = () => {
        editProduct(product.id);
        menu.remove();
        activeContextMenu = null;
    };
    menu.appendChild(priceItem);
    
    const favItem = document.createElement('div');
    favItem.className = 'ctx-menu-item';
    const isFav = product.favorite === true;
    favItem.style.color = 'var(--accent-yellow)';
    favItem.innerHTML = isFav ? '⭐ Favorilerden Kaldır' : '⭐ Favorilere Ekle';
    favItem.onclick = () => {
        product.favorite = !isFav;
        saveProductsData();
        renderProducts();
        menu.remove();
        activeContextMenu = null;
    };
    menu.appendChild(favItem);

    const otoImg = document.createElement('div');
    otoImg.className = 'ctx-menu-item';
    otoImg.innerHTML = '🔍 Oto. Görsel Bul';
    otoImg.onclick = async () => {
        menu.remove();
        activeContextMenu = null;
        const spinnerId = showSpinner("Görsel aranıyor...");
        try {
            await processProductAutoImage(product);
            saveProductsData();
            renderProducts();
            showToast("Görsel bulundu ve eklendi!", "var(--btn-teal)");
        } catch (err) {
            showToast("Görsel bulunamadı.", "var(--accent-red)");
        } finally {
            hideSpinner(spinnerId);
        }
    };
    menu.appendChild(otoImg);

    if (product.image) {
        const changeImg = document.createElement('div');
        changeImg.className = 'ctx-menu-item';
        changeImg.innerHTML = '🖼️ Görseli Değiştir';
        changeImg.onclick = () => {
            menu.remove();
            activeContextMenu = null;
            showImageChangePopup(product);
        };
        menu.appendChild(changeImg);
        
        const delImg = document.createElement('div');
        delImg.className = 'ctx-menu-item';
        delImg.style.color = 'var(--accent-red)';
        delImg.innerHTML = '🗑️ Görseli Sil';
        delImg.onclick = () => {
            product.image = null;
            product.imageAlternatives = null;
            saveProductsData();
            renderProducts();
            menu.remove();
            activeContextMenu = null;
            showToast("Görsel silindi.", "info");
        };
        menu.appendChild(delImg);
    } else {
        const addImg = document.createElement('div');
        addImg.className = 'ctx-menu-item';
        addImg.innerHTML = '➕ Görsel Ekle';
        addImg.onclick = () => {
            menu.remove();
            activeContextMenu = null;
            showImageAddPopup(product);
        };
        menu.appendChild(addImg);
    }

    const delItem = document.createElement('div');
    delItem.className = 'ctx-menu-item';
    delItem.style.color = 'var(--accent-red)';
    delItem.innerHTML = '🗑️ Ürünü Sil';
    delItem.onclick = () => {
        menu.remove();
        activeContextMenu = null;
        deleteProduct(product.id);
    };
    menu.appendChild(delItem);
    
    document.body.appendChild(menu);
    activeContextMenu = menu;
    
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            if (activeContextMenu) {
                activeContextMenu.remove();
                activeContextMenu = null;
            }
            document.removeEventListener('click', closeMenu);
        });
    }, 10);
}

// Image change popup with 3 alternatives
function showImageChangePopup(product) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10001;display:flex;align-items:center;justify-content:center;';
    
    const popup = document.createElement('div');
    popup.style.cssText = 'background:var(--panel-bg);border-radius:12px;padding:24px;max-width:500px;width:90%;text-align:center;';
    
    let altHtml = '<h3 style="margin-bottom:16px;color:var(--text-main);">Görsel Seçenekleri</h3><div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">';
    
    const alternatives = product.imageAlternatives || [product.image];
    alternatives.forEach((img, i) => {
        if (img) {
            altHtml += `<div style="cursor:pointer;border:2px solid transparent;border-radius:8px;overflow:hidden;width:130px;height:130px;" onclick="document.querySelectorAll('.img-change-opt').forEach(e=>e.style.borderColor='transparent');this.style.borderColor='var(--accent-blue)';this.dataset.selected='${img}';" class="img-change-opt">
                <img src="${img}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'">
            </div>`;
        }
    });
    
    altHtml += `<div style="cursor:pointer;border:2px dashed var(--panel-border);border-radius:8px;width:130px;height:130px;display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--text-muted);" onclick="document.getElementById('img-change-file-input').click();">
        <span>+</span>
    </div>`;
    altHtml += '</div>';
    
    altHtml += '<input type="file" accept="image/*" id="img-change-file-input" style="display:none;" onchange="handleImageChangeUpload(event, \'' + product.id + '\')">';
    altHtml += '<button style="margin-top:16px;padding:10px 24px;background:var(--accent-blue);border:none;border-radius:8px;color:white;cursor:pointer;font-size:1rem;" onclick="applyImageChange(\'' + product.id + '\')">Seçimi Uygula</button>';
    altHtml += '<button style="margin-top:8px;padding:8px 16px;background:transparent;border:1px solid var(--panel-border);border-radius:8px;color:var(--text-muted);cursor:pointer;font-size:0.9rem;margin-left:8px;" onclick="this.closest(\'div\').parentElement.remove()">İptal</button>';
    
    popup.innerHTML = altHtml;
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    overlay.onclick = function(e) {
        if (e.target === overlay) overlay.remove();
    };
}

function applyImageChange(productId) {
    const selected = document.querySelector('.img-change-opt[style*="var(--accent-blue)"]');
    if (!selected || !selected.dataset.selected) {
        showToast("Lütfen bir görsel seçin.", "error");
        return;
    }
    const prod = products.find(p => String(p.id) === String(productId));
    if (prod) {
        prod.image = selected.dataset.selected;
        saveProductsData();
        renderProducts();
        renderAdminProducts();
        showToast("Görsel değiştirildi!", "var(--btn-teal)");
    }
    document.querySelector('.img-change-opt[style*="var(--accent-blue)"]')?.closest('div').parentElement.parentElement.remove();
}

async function handleImageChangeUpload(event, productId) {
    const file = event.target.files[0];
    if (!file) return;
    const fs = window.require('fs');
    const path = window.require('path');
    
    showToast("Görsel yükleniyor...", "var(--accent-blue)");
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsDataURL(file);
        });
        
        const webpBase64 = await resizeAndConvertToWebP(dataUrl);
        const prod = products.find(p => String(p.id) === String(productId));
        const filename = slugify(prod ? prod.name : 'product') + '-' + productId + '.webp';
        const itemImagesDir = getItemImagesDir();
        const base64Data = webpBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const localPath = path.join(itemImagesDir, filename);
        fs.writeFileSync(localPath, buffer);
        
        if (prod) {
            prod.image = localPath;
            prod.imageAlternatives = [localPath];
            saveProductsData();
            renderProducts();
            renderAdminProducts();
        }
        showToast("Görsel başarıyla değiştirildi!", "var(--btn-teal)");
        
        // Close popup
        const overlay = document.querySelector('div[style*="rgba(0,0,0,0.7)"]');
        if (overlay) overlay.remove();
    } catch(e) {
        showToast("Görsel yüklenirken hata oluştu.", "var(--accent-red)");
    }
}

function showImageAddPopup(product) {
    // Same as change but for adding first image
    showImageChangePopup(product);
}

function renderProducts() {
    if (!productsGrid) return;
    productsGrid.innerHTML = '';
    
    let filtered = selectedCategory === 'all'
        ? [...products]
        : (selectedCategory === 'favorites'
            ? products.filter(p => p.favorite === true)
            : products.filter(p => String(p.category) === String(selectedCategory)));

    // Ensure categories are sorted
    categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // Sort products by their category's order
    filtered.sort((a, b) => {
        const catAIndex = categories.findIndex(c => String(c.id) === String(a.category));
        const catBIndex = categories.findIndex(c => String(c.id) === String(b.category));
        return (catAIndex === -1 ? 999 : catAIndex) - (catBIndex === -1 ? 999 : catBIndex);
    });

    if (filtered.length === 0) {
        productsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px; font-size: 1.2rem;">Bu kategoride ürün bulunamadı.</div>`;
        return;
    }

    filtered.forEach(product => {
        const card = document.createElement('button');
        card.className = 'product-card';
        
        // Dynamic product coloring from category color
        const catObj = categories.find(c => String(c.id) === String(product.category));
        const catColor = catObj ? catObj.color : 'var(--btn-coffee)';
        card.style.backgroundColor = catColor || 'var(--btn-coffee)';
        
        card.onclick = () => addToCart(product.id);
        
        // Right-click context menu (custom themed)
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showProductContextMenu(e, product);
        });
        
        card.innerHTML = `
            ${product.image ? `<img src="${product.image.startsWith('http') ? escapeHTML(product.image) : ('file:///' + escapeHTML(product.image.replace(/\\\\/g, '/')))}" class="urun-gorsel" onerror="this.style.display='none'" style="width:100%;height:120px;object-fit:cover;border-radius:6px 6px 0 0;">` : '<div class="urun-gorsel-placeholder" style="width:100%;height:120px;display:flex;align-items:center;justify-content:center;font-size:2rem;opacity:0.3;">📷</div>'}
            <div class="product-card-info" style="display: flex; flex-direction: column; width: 100%; gap: 4px; padding: 8px; margin-top: auto;">
                <div class="product-name">${escapeHTML(product.name)}</div>
                <div class="product-price-tag">${formatCurrency(product.price)} TL</div>
            </div>
        `;
        
        productsGrid.appendChild(card);
    });
}

function renderAdminProducts() {
    if (!productListBody) return;
    productListBody.innerHTML = '';
    
    const searchBar = document.getElementById('search-products');
    const query = (searchBar ? searchBar.value : '').toLowerCase().trim();
    
    const filterSelect = document.getElementById('filter-product-category');
    const selectedFilterCat = filterSelect ? filterSelect.value : 'all';
    
    // Populate filter dropdown with all categories
    if (filterSelect && filterSelect.options.length <= 1) {
        filterSelect.innerHTML = '<option value="all">Tüm Kategoriler</option>';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            filterSelect.appendChild(opt);
        });
    }

    const filtered = products.filter(p => {
        const catObj = categories.find(c => String(c.id) === String(p.category));
        const catName = catObj ? catObj.name : String(p.category);
        const matchesQuery = p.name.toLowerCase().includes(query) || catName.toLowerCase().includes(query);
        const matchesCategory = selectedFilterCat === 'all' || String(p.category) === String(selectedFilterCat);
        return matchesQuery && matchesCategory;
    });

    if (filtered.length === 0) {
        productListBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    Eşleşen ürün bulunamadı.
                </td>
            </tr>
        `;
        return;
    }

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        const catObj = categories.find(c => String(c.id) === String(p.category));
        const catName = catObj ? catObj.name : String(p.category);
        
        tr.innerHTML = `
            <td><input type="checkbox" class="product-checkbox" value="${p.id}" onchange="checkProductSelectionState()"></td>
            <td style="text-align: center; padding: 8px;">
                ${p.image ? `<div style="position:relative;display:inline-block;cursor:pointer;" onclick="event.stopPropagation();showAdminImageOptions('${p.id}')">
                <img src="${getImageSrc(p.image)}" style="width: 40px; height: 40px; aspect-ratio: 1/1; object-fit: cover; border-radius: 4px;">
            </div>` : `<div style="cursor:pointer;width:40px;height:40px;border:2px dashed var(--panel-border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:var(--text-muted);" onclick="event.stopPropagation();triggerAdminImageUpload('${p.id}')" title="Görsel Ekle">+</div>`}
            </td>
            <td><strong>${escapeHTML(p.name)}</strong></td>
            <td><strong>${formatCurrency(p.price)} TL</strong></td>
            <td style="text-transform: capitalize;">${escapeHTML(catName)}</td>
            <td>
                <div class="action-btns">
                    <button class="btn-edit-prod" onclick="editProduct('${p.id}')" title="Düzenle">✏️</button>
                    <button class="btn-delete-prod" onclick="deleteProduct('${p.id}')" title="Sil">🗑️</button>
                </div>
            </td>
        `;productListBody.appendChild(tr);
    });
}


// Admin image management functions
function showAdminImageOptions(productId) {
    const prod = products.find(p => String(p.id) === String(productId));
    if (!prod) return;
    
    // Remove any existing popup
    const existing = document.querySelector('.admin-img-popup');
    if (existing) existing.remove();
    
    const popup = document.createElement('div');
    popup.className = 'admin-img-popup';
    popup.style.cssText = 'position:absolute;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;padding:8px;z-index:1000;box-shadow:0 4px 16px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;min-width:160px;';
    
    const changeBtn = document.createElement('button');
    changeBtn.textContent = '🖼️ Görseli Değiştir';
    changeBtn.style.cssText = 'background:transparent;border:none;color:var(--text-main);padding:8px 12px;cursor:pointer;text-align:left;border-radius:4px;font-size:0.9rem;';
    changeBtn.onclick = () => { popup.remove(); showImageChangePopup(prod); };
    popup.appendChild(changeBtn);
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️ Görseli Sil';
    delBtn.style.cssText = 'background:transparent;border:none;color:var(--accent-red);padding:8px 12px;cursor:pointer;text-align:left;border-radius:4px;font-size:0.9rem;';
    delBtn.onclick = () => {
        prod.image = null;
        prod.imageAlternatives = null;
        saveProductsData();
        renderAdminProducts();
        renderProducts();
        popup.remove();
        showToast("Görsel silindi.", "info");
    };
    popup.appendChild(delBtn);
    
    // Position near the click
    const rect = event.target.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    
    document.body.appendChild(popup);
    
    setTimeout(() => {
        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                document.removeEventListener('click', closePopup);
            }
        });
    }, 10);
}

function triggerAdminImageUpload(productId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const fs = window.require('fs');
        const path = window.require('path');
        const prod = products.find(p => String(p.id) === String(productId));
        if (!prod) return;
        
        showToast("Görsel yükleniyor...", "var(--accent-blue)");
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = e => reject(e);
                reader.readAsDataURL(file);
            });
            const webpBase64 = await resizeAndConvertToWebP(dataUrl);
            const filename = slugify(prod.name) + '-' + prod.id + '.webp';
            const itemImagesDir = getItemImagesDir();
            const base64Data = webpBase64.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const localPath = path.join(itemImagesDir, filename);
            fs.writeFileSync(localPath, buffer);
            prod.image = localPath;
            prod.imageAlternatives = [localPath];
            saveProductsData();
            renderAdminProducts();
            renderProducts();
            showToast("Görsel eklendi!", "var(--btn-teal)");
        } catch(e) {
            showToast("Hata oluştu.", "var(--accent-red)");
        }
    };
    input.click();
}

function searchProductsList() {
    renderAdminProducts();
}

function saveProduct(event) {
    event.preventDefault();
    
    const id = editProductIdInput.value;
    const name = document.getElementById('product-name').value.trim();
    const price = parseFloat(document.getElementById('product-price').value);
    const category = productCategorySelect.value;
    
    const colorRadio = document.querySelector('input[name="product-color"]:checked');
    const color = colorRadio ? colorRadio.value : 'var(--btn-coffee)';

    if (!name || isNaN(price)) {
        showToast("Lütfen tüm alanları doldurun.", "error");
        return;
    }

    if (id) {
        const index = products.findIndex(p => String(p.id) === String(id));
        if (index !== -1) {
            products[index] = { ...products[index], name, price, category, color };
            showToast("Ürün başarıyla güncellendi.");
        }
    } else {
        const newId = String(Date.now());
        products.push({ id: newId, name, price, category, color });
        showToast("Yeni ürün başarıyla eklendi.");
    }

    if (isFirebaseInitialized && currentUsername) {
        db.ref('products/' + currentUsername).set(products);
    } else {
        appStorage.setItem('duran_cafe_products', JSON.stringify(products));
        renderAdminProducts();
        renderProducts();
    }
    
    resetProductForm();
}

function editProduct(id) {
    const product = products.find(p => String(p.id) === String(id));
    if (!product) return;

    const modalSelect = document.getElementById('modal-product-category');
    if (modalSelect) {
        modalSelect.innerHTML = '';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.id;
            opt.textContent = cat.name;
            modalSelect.appendChild(opt);
        });
        modalSelect.value = product.category;
    }

    document.getElementById('modal-edit-product-id').value = product.id;
    document.getElementById('modal-product-name').value = product.name;
    document.getElementById('modal-product-price').value = product.price;
    document.getElementById('modal-product-image').value = product.image || '';
    const imgPreview = document.getElementById('modal-product-image-preview');
    const imgPlaceholder = document.getElementById('modal-product-image-preview-placeholder');
    if (product.image) {
        if (imgPreview) {
            const previewSrc = product.image.startsWith('http') ? product.image : ('file:///' + product.image.replace(/\\/g, '/'));
            imgPreview.src = previewSrc;
            imgPreview.style.display = 'block';
        }
        if (imgPlaceholder) imgPlaceholder.style.display = 'none';
    } else {
        if (imgPreview) {
            imgPreview.src = '';
            imgPreview.style.display = 'none';
        }
        if (imgPlaceholder) imgPlaceholder.style.display = 'block';
    }
    document.getElementById('modal-product-favorite').checked = !!product.favorite;
    
    const colorRadio = document.querySelector(`input[name="modal-product-color"][value="${product.color}"]`);
    if (colorRadio) {
        colorRadio.checked = true;
    }

    window.hasUnsavedChanges = false;
    document.getElementById('product-edit-modal').style.display = 'flex';
}

function closeProductModal() {
    if (window.hasUnsavedChanges) {
        showCustomConfirm(
            "Değişiklikleri kaydetmeden çıkmak istediğinize emin misiniz?",
            "Kaydedilmemiş Değişiklikler",
            "Evet, Çık",
            "İptal",
            (res) => {
                if (res) {
                    window.hasUnsavedChanges = false;
                    document.getElementById('product-edit-modal').style.display = 'none';
                }
            }
        );
    } else {
        document.getElementById('product-edit-modal').style.display = 'none';
    }
}

function saveProductModal(event) {
    event.preventDefault();
    const id = document.getElementById('modal-edit-product-id').value;
    const name = document.getElementById('modal-product-name').value.trim();
    const price = parseFloat(document.getElementById('modal-product-price').value);
    const category = document.getElementById('modal-product-category').value;
    const image = document.getElementById('modal-product-image').value;
    const favorite = document.getElementById('modal-product-favorite').checked;
    
    const colorRadio = document.querySelector('input[name="modal-product-color"]:checked');
    const color = colorRadio ? colorRadio.value : 'var(--btn-coffee)';

    if (!name || isNaN(price)) {
        showToast("Lütfen tüm alanları doldurun.", "error");
        return;
    }

    const index = products.findIndex(p => String(p.id) === String(id));
    if (index !== -1) {
        products[index] = { ...products[index], name, price, category, color, image, favorite };
        showToast("Ürün başarıyla güncellendi.");
    }

    if (isFirebaseInitialized && currentUsername) {
        db.ref('products/' + currentUsername).set(products);
    } else {
        appStorage.setItem('duran_cafe_products', JSON.stringify(products));
        renderAdminProducts();
        renderProducts();
    }

    window.hasUnsavedChanges = false;
    closeProductModal();
}

function deleteProduct(id) {
    showCustomConfirm(
        "Bu ürünü silmek istediğinize emin misiniz?",
        "Ürünü Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            products = products.filter(p => String(p.id) !== String(id));
            
            if (isFirebaseInitialized && currentUsername) {
                db.ref('products/' + currentUsername).set(products);
            } else {
                appStorage.setItem('duran_cafe_products', JSON.stringify(products));
                renderAdminProducts();
                renderProducts();
            }

            cart = cart.filter(item => String(item.product.id) !== String(id));
            renderCart();
            showToast("Ürün silindi.", "info");
        }
    );
}

function resetProductForm() {
    productForm.reset();
    editProductIdInput.value = "";
    formTitleElement.textContent = "Yeni Ürün Ekle";
    
    const defaultRadio = document.querySelector('input[name="product-color"][value="var(--btn-coffee)"]');
    if (defaultRadio) {
        defaultRadio.checked = true;
    }
}

// =========================================================================
// CART / ADISYON LOGIC
// =========================================================================

function addToCart(productId) {
    const product = products.find(p => String(p.id) === String(productId));
    if (!product) return;

    const existingCartItem = cart.find(item => String(item.product.id) === String(productId));
    if (existingCartItem) {
        existingCartItem.quantity += 1;
    } else {
        cart.push({ product, quantity: 1 });
    }

    renderCart();
}

function updateCartItemQty(productId, delta) {
    const item = cart.find(i => String(i.product.id) === String(productId));
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        renderCart();
    }
}

function removeFromCart(productId) {
    cart = cart.filter(item => String(item.product.id) !== String(productId));
    renderCart();
}

function clearCart() {
    if (cart.length === 0) return;
    
    cart = [];
    cashInputString = "";
    cashReceivedInput.value = "";
    renderCart();
    showToast("Adisyon temizlendi.", "info");
}

function renderCart() {
    if (!cartItemsContainer) return;
    cartItemsContainer.innerHTML = '';
    
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = `<div class="cart-empty-message">Adisyon boş. Ürün eklemek için soldaki butonlara dokunun.</div>`;
        cartTotalElement.textContent = "0,00 TL";
        calculateChange(0);
        return;
    }

    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.product.price * item.quantity;
        total += itemTotal;

        const row = document.createElement('div');
        row.className = 'cart-item';
        
        row.innerHTML = `
            <div class="item-info">
                <div class="item-name">${escapeHTML(item.product.name)}</div>
                <div class="item-price">${formatCurrency(item.product.price)} TL</div>
            </div>
            <div class="item-actions">
                <div class="qty-controls">
                    <button class="qty-btn" onclick="updateCartItemQty('${item.product.id}', -1)">-</button>
                    <div class="item-qty">${item.quantity}</div>
                    <button class="qty-btn" onclick="updateCartItemQty('${item.product.id}', 1)">+</button>
                </div>
                <div class="item-total-price">${formatCurrency(itemTotal)} TL</div>
                <button class="btn-remove-item" onclick="removeFromCart('${item.product.id}')">🗑️</button>
            </div>
        `;

        cartItemsContainer.appendChild(row);
    });

    cartTotalElement.textContent = `${formatCurrency(total)} TL`;
    calculateChange(total);
}

// =========================================================================
// CASH CALCULATION & PAYMENT SYNC
// =========================================================================

function clearCashInput() {
    cashInputString = "";
    cashReceivedInput.value = "";
    renderCart();
}

function addQuickCashValue(val) {
    if (cart.length === 0) {
        showToast("Lütfen önce adisyona ürün ekleyin.", "error");
        return;
    }

    if (val === 'exact') {
        const total = getCartTotal();
        cashInputString = total.toFixed(2);
    } else {
        let current = parseFloat(cashInputString) || 0;
        current += val;
        cashInputString = String(current);
    }
    
    cashReceivedInput.value = cashInputString;
    renderCart();
}

function getCartTotal() {
    return cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
}

function calculateChange(totalPrice) {
    if (totalPrice === undefined) {
        totalPrice = getCartTotal();
    }

    const cash = parseFloat(cashInputString);

    if (isNaN(cash) || cash === 0) {
        changeAmountDisplay.textContent = "0,00 TL";
        changeAmountDisplay.className = "change-amount positive";
        return;
    }

    const change = cash - totalPrice;

    if (change >= 0) {
        changeAmountDisplay.textContent = `${formatCurrency(change)} TL`;
        changeAmountDisplay.className = "change-amount positive";
    } else {
        const positiveChange = Math.abs(change);
        changeAmountDisplay.textContent = `Eksik: ${formatCurrency(positiveChange)} TL`;
        changeAmountDisplay.className = "change-amount negative";
    }
}

function completePayment() {
    if (cart.length === 0) {
        showToast("Ödeme yapılamaz: Adisyon boş!", "error");
        return;
    }

    const total = getCartTotal();
    const cash = parseFloat(cashInputString) || 0;

    if (cash < total && cash > 0) {
        showToast("Girilen tutar toplam fiyattan az!", "error");
        return;
    }

    const change = Math.max(0, cash - total);
    
    const sale = {
        id: String(Date.now()),
        date: new Date().toISOString(),
        timestamp: Date.now(),
        total: total,
        items: cart.map(item => ({
            id: item.product.id,
            name: item.product.name,
            price: item.product.price,
            quantity: item.quantity
        }))
    };

    if (isFirebaseInitialized && currentUsername) {
        // Push transaction directly to Firebase sales node
        db.ref('sales/' + currentUsername).push(sale).then(() => {
            showToast(`Ödeme Alındı! Para Üstü: ${formatCurrency(change)} TL`, "success");
        }).catch(() => {
            showToast("Satış veritabanına kaydedilemedi.", "error");
        });
    } else {
        sales.push(sale);
        appStorage.setItem('duran_cafe_sales', JSON.stringify(sales));
        showToast(`Ödeme Alındı! Para Üstü: ${formatCurrency(change)} TL`, "success");
        renderReports();
    }
    
    cart = [];
    cashInputString = "";
    cashReceivedInput.value = "";
    renderCart();
}

// =========================================================================
// REPORTS & ANALYTICS (SALES RESTORE)
// =========================================================================

function loadSales() {
    if (isFirebaseInitialized && currentUsername) {
        db.ref('sales/' + currentUsername).on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                // Handle objects vs arrays from Firebase
                sales = Array.isArray(data) ? data : Object.values(data);
            } else {
                sales = [];
            }
            renderReports();
        });
    } else {
        const stored = appStorage.getItem('duran_cafe_sales');
        sales = stored ? JSON.parse(stored) : [];
        renderReports();
    }
}

function getLocalDateString(dateObj = new Date()) {
    const offset = dateObj.getTimezoneOffset();
    const localDate = new Date(dateObj.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
}

function renderReports() {
    if (!repTodayElement) return;

    const todayStr = getLocalDateString();
    const yesterdayStr = getLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let todaySum = 0;
    let yesterdaySum = 0;
    let alltimeSum = 0;
    const productSoldQty = {};

    sales.forEach(sale => {
        if (!sale) return;
        const saleDateStr = getLocalDateString(new Date(sale.date));
        alltimeSum += sale.total;
        
        if (saleDateStr === todayStr) {
            todaySum += sale.total;
        } else if (saleDateStr === yesterdayStr) {
            yesterdaySum += sale.total;
        }

        if (sale.items) {
            sale.items.forEach(item => {
                const name = item.name;
                productSoldQty[name] = (productSoldQty[name] || 0) + item.quantity;
            });
        }
    });

    repTodayElement.textContent = `${formatCurrency(todaySum)} TL`;
    repYesterdayElement.textContent = `${formatCurrency(yesterdaySum)} TL`;
    repAlltimeElement.textContent = `${formatCurrency(alltimeSum)} TL`;

    // 1. Render Top Products Chart
    topProductsChart.innerHTML = '';
    const sortedProducts = Object.entries(productSoldQty)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    if (sortedProducts.length === 0) {
        topProductsChart.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Henüz satış yapılmadı.</div>`;
    } else {
        const maxQty = sortedProducts[0].qty;
        
        sortedProducts.forEach(prod => {
            const pct = maxQty > 0 ? (prod.qty / maxQty) * 100 : 0;
            const barRow = document.createElement('div');
            barRow.className = 'chart-bar-row';
            
            barRow.innerHTML = `
                <div class="chart-bar-info">
                    <span>${escapeHTML(prod.name)}</span>
                    <span>${prod.qty} adet</span>
                </div>
                <div class="chart-bar-wrapper">
                    <div class="chart-bar-fill" style="width: 0%;"></div>
                </div>
            `;
            
            topProductsChart.appendChild(barRow);
            
            setTimeout(() => {
                const fill = barRow.querySelector('.chart-bar-fill');
                if (fill) fill.style.width = `${pct}%`;
            }, 50);
        });
    }

    // 2. Render Recent Sales List
    recentSalesBody.innerHTML = '';
    const sortedSales = [...sales].filter(Boolean).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 10);

    if (sortedSales.length === 0) {
        recentSalesBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    Henüz işlem geçmişi yok.
                </td>
            </tr>
        `;
    } else {
        sortedSales.forEach(sale => {
            const tr = document.createElement('tr');
            
            const timeFormatted = formatSmartDate(sale.timestamp || sale.date);
            
            const itemsStr = sale.items
                ? sale.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
                : 'Detay Yok';

            tr.innerHTML = `
                <td><input type="checkbox" class="normal-sale-checkbox" value="${sale.id}" onchange="checkNormalDeleteButtonState()"></td>
                <td><strong>${timeFormatted}</strong></td>
                <td><strong>${formatCurrency(sale.total)} TL</strong></td>
                <td style="font-size: 0.9rem; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${escapeHTML(itemsStr)}
                </td>
                <td>
                    <button class="btn-sale-info" onclick="openNormalSaleDetails('${sale.id}')" title="Detay">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-info"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    </button>
                </td>
            `;
            recentSalesBody.appendChild(tr);
        });
    }
}

function toggleSelectAllNormalSales() {
    const isChecked = document.getElementById('select-all-normal-sales').checked;
    document.querySelectorAll('.normal-sale-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
    checkNormalDeleteButtonState();
}

function checkNormalDeleteButtonState() {
    const checkedBoxes = document.querySelectorAll('.normal-sale-checkbox:checked');
    const anyChecked = checkedBoxes.length > 0;
    document.getElementById('btn-delete-normal-sales').style.display = anyChecked ? 'flex' : 'none';
    
    const counterEl = document.getElementById('normal-sales-counter');
    if (counterEl) {
        if (anyChecked) {
            counterEl.textContent = `(${checkedBoxes.length} satış verisi seçildi.)`;
            counterEl.style.display = 'inline';
        } else {
            counterEl.style.display = 'none';
        }
    }
}

function deleteSelectedNormalSales() {
    const checkedBoxes = document.querySelectorAll('.normal-sale-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    showCustomConfirm(
        `${checkedBoxes.length} adet satışı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        "Satışları Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            if (!isFirebaseInitialized || !currentUsername) return;
            
            const updates = {};
            checkedBoxes.forEach(cb => {
                updates[`sales/${currentUsername}/${cb.value}`] = null;
            });
            
            db.ref().update(updates).then(() => {
                showToast(`${checkedBoxes.length} satış başarıyla silindi.`);
                loadNormalSalesReports(); // reload
            }).catch(error => {
                console.error(error);
                showToast("Satışlar silinirken hata oluştu.", "error");
            });
        }
    );
}

function openNormalSaleDetails(saleId) {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    
    document.getElementById('sale-details-modal').style.display = 'flex';
    
    const content = document.getElementById('sale-details-content');
    
    let itemsHtml = '';
    if (sale.items) {
        sale.items.forEach(item => {
            const itemTotal = (item.quantity * item.price).toFixed(2);
            itemsHtml += `
                <div class="sale-detail-item">
                    <span style="color: var(--text-main);">${item.quantity}x ${item.name}</span>
                    <span style="color: var(--text-muted);">${itemTotal} TL</span>
                </div>
            `;
        });
    }
    
    const saleTime = sale.timestamp || new Date(sale.date).getTime();
    content.innerHTML = `
        <div class="sale-detail-header">
            <div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">Sipariş Zamanı</div>
                <div style="color: var(--text-main); font-size: 15px;">${new Date(saleTime).toLocaleString('tr-TR')}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">Toplam Tutar</div>
                <div class="sale-detail-total">${parseFloat(sale.total).toFixed(2)} TL</div>
            </div>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">Ürünler</div>
        <div class="sale-detail-items">
            ${itemsHtml}
        </div>
    `;
}

// Utility to escape HTML and protect against XSS
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Toggle password visibility on login screen
function togglePasswordVisibility() {
    const passwordInput = document.getElementById('login-password');
    const toggleBtn = document.getElementById('btn-toggle-password');
    if (passwordInput && toggleBtn) {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        } else {
            passwordInput.type = 'password';
            toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-eye"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        }
    }
}

// =========================================================================
// CUSTOM TOAST & NOTIFICATION IMPLEMENTATION
// =========================================================================
let toastTimeout = null;
function showToast(message, type = "success") {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    // Clear any existing timeout
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    
    // Set message text
    toast.textContent = message;
    
    // Reset toast classes
    toast.className = 'toast';
    
    // Add appropriate class style
    if (type === 'success') {
        toast.classList.add('success');
    } else if (type === 'error') {
        toast.classList.add('error');
    } else if (type === 'info') {
        toast.classList.add('info');
    }
    
    // Animate display
    toast.classList.add('show');
    
    // Auto-dismiss after 3 seconds
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// =========================================================================
// TURKISH CASE-INSENSITIVE LOWERCASE CONVERSION HELPER
// =========================================================================
function turkishToLower(str) {
    if (!str) return '';
    return str.replace(/İ/g, 'i')
              .replace(/I/g, 'ı')
              .replace(/Ş/g, 'ş')
              .replace(/Ç/g, 'ç')
              .replace(/Ğ/g, 'ğ')
              .replace(/Ü/g, 'ü')
              .replace(/Ö/g, 'ö')
              .toLowerCase();
}

// =========================================================================
// AUTOCOMPLETE & SEARCH-TO-EDIT FUNCTIONALITY
// =========================================================================
function selectProductForEdit(product, isModal) {
    if (isModal) {
        document.getElementById('modal-edit-product-id').value = product.id;
        document.getElementById('modal-product-name').value = product.name;
        document.getElementById('modal-product-price').value = product.price;
        
        const modalSelect = document.getElementById('modal-product-category');
        if (modalSelect) {
            modalSelect.value = product.category;
        }
        
        const colorRadio = document.querySelector(`input[name="modal-product-color"][value="${product.color}"]`);
        if (colorRadio) {
            colorRadio.checked = true;
        }
    } else {
        document.getElementById('edit-product-id').value = product.id;
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-price').value = product.price;
        
        if (productCategorySelect) {
            productCategorySelect.value = product.category;
        }
        
        const colorRadio = document.querySelector(`input[name="product-color"][value="${product.color}"]`);
        if (colorRadio) {
            colorRadio.checked = true;
        }
        
        if (formTitleElement) {
            formTitleElement.textContent = "Ürünü Düzenle";
        }
    }
    showToast(`"${product.name}" düzenlemek için yüklendi.`, "info");
}

function setupProductAutocomplete() {
    // Only keep autocomplete for the modal (edit) view, remove from new product form
    const modalNameInput = document.getElementById('modal-product-name');
    const modalSuggestionsContainer = document.getElementById('modal-product-name-suggestions');

    function handleInput(input, container, isModal) {
        const query = turkishToLower(input.value.trim());
        if (!query) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        // Filter products case-insensitive (matching Turkish characters)
        const matched = products.filter(p => {
            const nameLower = turkishToLower(p.name);
            return nameLower.startsWith(query) || nameLower.includes(query);
        });

        if (matched.length === 0) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.innerHTML = '';
        matched.forEach(prod => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.textContent = prod.name;
            div.onclick = () => {
                selectProductForEdit(prod, isModal);
                container.style.display = 'none';
            };
            container.appendChild(div);
        });
        container.style.display = 'block';
    }

    if (modalNameInput && modalSuggestionsContainer) {
        modalNameInput.addEventListener('input', () => {
            handleInput(modalNameInput, modalSuggestionsContainer, true);
        });
        document.addEventListener('click', (e) => {
            if (e.target !== modalNameInput && !modalSuggestionsContainer.contains(e.target)) {
                modalSuggestionsContainer.style.display = 'none';
            }
        });
    }
}

// =========================================================================
// v1.2.0 DETAILED REPORTS LOGIC
// =========================================================================

let detailedSalesData = [];
let currentDetailedPage = 1;
const DETAILED_ITEMS_PER_PAGE = 20;

function openDetailedReportsModal() {
    document.getElementById('detailed-reports-modal').style.display = 'flex';
    document.getElementById('detailed-reports-range').value = 'last_week';
    handleDetailedRangeChange();
}

function closeDetailedReportsModal() {
    document.getElementById('detailed-reports-modal').style.display = 'none';
}

function handleDetailedRangeChange() {
    const range = document.getElementById('detailed-reports-range').value;
    const customPickers = document.getElementById('custom-date-pickers');
    
    if (range === 'custom') {
        customPickers.style.display = 'flex';
        // Set default dates if empty
        if (!document.getElementById('date-start').value) {
            const date = new Date();
            document.getElementById('date-end').valueAsDate = date;
            date.setMonth(date.getMonth() - 1);
            document.getElementById('date-start').valueAsDate = date;
        }
    } else {
        customPickers.style.display = 'none';
    }
    
    loadDetailedReports();
}

function getDetailedDateRange() {
    const range = document.getElementById('detailed-reports-range').value;
    const now = new Date();
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    
    let endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    if (range === 'today') {
        // startDate is already today 00:00:00
    } else if (range === 'yesterday') {
        startDate.setDate(startDate.getDate() - 1);
        endDate.setDate(endDate.getDate() - 1);
    } else if (range === 'last_week') {
        startDate.setDate(startDate.getDate() - 7);
    } else if (range === 'last_month') {
        startDate.setMonth(startDate.getMonth() - 1);
    } else if (range === 'last_3_months') {
        startDate.setMonth(startDate.getMonth() - 3);
    } else if (range === 'last_year') {
        startDate.setFullYear(startDate.getFullYear() - 1);
    } else if (range === 'custom') {
        const customStart = document.getElementById('date-start').value;
        const customEnd = document.getElementById('date-end').value;
        if (customStart) startDate = new Date(customStart + "T00:00:00");
        if (customEnd) {
            endDate = new Date(customEnd + "T23:59:59");
            // Validation
            if (endDate > now) endDate = new Date();
        }
        if (startDate > endDate) {
            showToast("Başlangıç tarihi bitiş tarihinden büyük olamaz!", "error");
            return null;
        }
    }
    
    return { start: startDate.getTime(), end: endDate.getTime() };
}

function loadDetailedReports() {
    const dateRange = getDetailedDateRange();
    if (!dateRange) return;
    
    detailedSalesData = [];
    let totalRevenue = 0;
    let totalItemsSold = 0;
    
    const dbRef = isFirebaseInitialized && currentUsername ? db.ref(`sales/${currentUsername}`) : null;
    
    if (dbRef) {
        dbRef.once('value').then(snapshot => {
            const data = snapshot.val();
            if (data) {
                Object.keys(data).forEach(key => {
                    const sale = data[key];
                    sale.id = key;
                    const saleTime = sale.timestamp || new Date(sale.date).getTime();
                    if (saleTime >= dateRange.start && saleTime <= dateRange.end) {
                        detailedSalesData.push(sale);
                        totalRevenue += parseFloat(sale.total);
                        if (sale.items) {
                            sale.items.forEach(item => {
                                totalItemsSold += parseInt(item.quantity);
                            });
                        }
                    }
                });
            }
            // Sort descending by time
            detailedSalesData.sort((a, b) => {
                const timeA = a.timestamp || new Date(a.date).getTime();
                const timeB = b.timestamp || new Date(b.date).getTime();
                return timeB - timeA;
            });
            
            document.getElementById('detailed-revenue').textContent = totalRevenue.toFixed(2) + " TL";
            document.getElementById('detailed-items-sold').textContent = totalItemsSold;
            
            currentDetailedPage = 1;
            renderDetailedSalesTable();
            renderDetailedPagination();
        });
    }
}

function renderDetailedSalesTable() {
    const tbody = document.getElementById('detailed-sales-body');
    tbody.innerHTML = '';
    
    const startIndex = (currentDetailedPage - 1) * DETAILED_ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + DETAILED_ITEMS_PER_PAGE, detailedSalesData.length);
    
    for (let i = startIndex; i < endIndex; i++) {
        const sale = detailedSalesData[i];
        const tr = document.createElement('tr');
        
        let itemsStr = '';
        if (sale.items && sale.items.length > 0) {
            itemsStr = sale.items.map(item => `${item.quantity}x ${item.name}`).join(', ');
            if (itemsStr.length > 40) itemsStr = itemsStr.substring(0, 37) + '...';
        }
        
        tr.innerHTML = `
            <td><input type="checkbox" class="sale-checkbox" value="${sale.id}" onchange="checkDeleteButtonState()"></td>
            <td>${formatSmartDate(sale.timestamp || sale.date)}</td>
            <td style="color: var(--accent-green); font-weight: 600;">${parseFloat(sale.total).toFixed(2)} TL</td>
            <td style="color: var(--text-muted); font-size: 13px;">${itemsStr}</td>
            <td>
                <button class="btn-sale-info" onclick="openSaleDetails('${sale.id}')" title="Detay">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather-info"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    }
    
    checkDeleteButtonState();
    document.getElementById('select-all-sales').checked = false;
}

function renderDetailedPagination() {
    const pagination = document.getElementById('detailed-pagination');
    pagination.innerHTML = '';
    
    const totalPages = Math.ceil(detailedSalesData.length / DETAILED_ITEMS_PER_PAGE);
    
    if (totalPages <= 1) return;
    
    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn ${i === currentDetailedPage ? 'active' : ''}`;
        btn.textContent = i;
        btn.onclick = () => {
            currentDetailedPage = i;
            renderDetailedSalesTable();
            renderDetailedPagination();
        };
        pagination.appendChild(btn);
    }
}

function formatSmartDate(timestamp) {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "Bilinmeyen Tarih";
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    
    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    const isYesterday = date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear();
    
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    
    if (isToday) {
        return `${hours}:${mins}`;
    } else if (isYesterday) {
        return `Dün ${hours}:${mins}`;
    } else {
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
            const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
            return `${days[date.getDay()]} ${hours}:${mins}`;
        } else {
            const d = String(date.getDate()).padStart(2, '0');
            const m = String(date.getMonth() + 1).padStart(2, '0');
            return `${d}.${m}.${date.getFullYear()}`;
        }
    }
}

function toggleSelectAllSales() {
    const isChecked = document.getElementById('select-all-sales').checked;
    document.querySelectorAll('.sale-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
    checkDeleteButtonState();
}

function checkDeleteButtonState() {
    const checkedBoxes = document.querySelectorAll('.sale-checkbox:checked');
    const anyChecked = checkedBoxes.length > 0;
    document.getElementById('btn-delete-sales').style.display = anyChecked ? 'flex' : 'none';
    
    const counterEl = document.getElementById('detailed-sales-counter');
    if (counterEl) {
        if (anyChecked) {
            counterEl.textContent = `(${checkedBoxes.length} satış verisi seçildi.)`;
            counterEl.style.display = 'inline';
        } else {
            counterEl.style.display = 'none';
        }
    }
}

function deleteSelectedSales() {
    const checkedBoxes = document.querySelectorAll('.sale-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    showCustomConfirm(
        `${checkedBoxes.length} adet satışı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
        "Satışları Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            if (!isFirebaseInitialized || !currentUsername) return;
            
            const updates = {};
            checkedBoxes.forEach(cb => {
                updates[`sales/${currentUsername}/${cb.value}`] = null;
            });
            
            db.ref().update(updates).then(() => {
                showToast(`${checkedBoxes.length} satış başarıyla silindi.`);
                loadDetailedReports(); // reload
            }).catch(error => {
                console.error(error);
                showToast("Satışlar silinirken hata oluştu.", "error");
            });
        }
    );
}

function openSaleDetails(saleId) {
    const sale = detailedSalesData.find(s => s.id === saleId);
    if (!sale) return;
    
    document.getElementById('sale-details-modal').style.display = 'flex';
    
    const content = document.getElementById('sale-details-content');
    
    let itemsHtml = '';
    if (sale.items) {
        sale.items.forEach(item => {
            const itemTotal = (item.quantity * item.price).toFixed(2);
            itemsHtml += `
                <div class="sale-detail-item">
                    <span style="color: var(--text-main);">${item.quantity}x ${item.name}</span>
                    <span style="color: var(--text-muted);">${itemTotal} TL</span>
                </div>
            `;
        });
    }
    
    content.innerHTML = `
        <div class="sale-detail-header">
            <div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">Sipariş Zamanı</div>
                <div style="color: var(--text-main); font-size: 15px;">${new Date(sale.timestamp || sale.date).toLocaleString('tr-TR')}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 4px;">Toplam Tutar</div>
                <div class="sale-detail-total">${parseFloat(sale.total).toFixed(2)} TL</div>
            </div>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase;">Ürünler</div>
        <div class="sale-detail-items">
            ${itemsHtml}
        </div>
    `;
}

function closeSaleDetailsModal() {
    document.getElementById('sale-details-modal').style.display = 'none';
}


// =========================================================================
// BULK EDIT & SELECTION LOGIC (CATEGORIES & PRODUCTS)
// =========================================================================

// Categories Selection
function toggleSelectAllCategories() {
    const isChecked = document.getElementById('select-all-categories').checked;
    document.querySelectorAll('.category-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
    checkCategorySelectionState();
}

function checkCategorySelectionState() {
    const checkedBoxes = document.querySelectorAll('.category-checkbox:checked');
    const anyChecked = checkedBoxes.length > 0;
    
    const btnDelete = document.getElementById('btn-delete-categories');
    const btnEdit = document.getElementById('btn-bulk-edit-categories');
    const countSpan = document.getElementById('categories-selected-count');
    
    
    
    
    const btnAutoImg = document.getElementById('btn-bulk-auto-image');
    const btnFav = document.getElementById('btn-bulk-add-favorites');
    
    
    if (countSpan) countSpan.textContent = anyChecked ? `(${checkedBoxes.length} kategori seçildi)` : '';
    
    const counterEl = document.getElementById('categories-counter');
    if (counterEl) {
        if (anyChecked) {
            counterEl.textContent = `(${checkedBoxes.length} kategori seçildi.)`;
            counterEl.style.display = 'inline';
        } else {
            counterEl.style.display = 'none';
        }
    }
}

function deleteSelectedCategoriesBulk() {
    if(document.querySelectorAll('.category-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir kategori seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.category-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    showCustomConfirm(
        `${checkedBoxes.length} adet kategoriyi silmek istediğinize emin misiniz? (Kategori altındaki tüm ürünler de silinecektir.)`,
        "Kategorileri Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            
            const idsToDelete = Array.from(checkedBoxes).map(cb => cb.value);
            
            categories = categories.filter(c => !idsToDelete.includes(c.id));
            products = products.filter(p => !idsToDelete.includes(String(p.category)));
            cart = cart.filter(item => !idsToDelete.includes(String(item.product.category)));

            if (isFirebaseInitialized && currentUsername) {
                db.ref('categories/' + currentUsername).set(categories);
                db.ref('products/' + currentUsername).set(products);
                renderCart();
            } else {
                appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
                appStorage.setItem('duran_cafe_products', JSON.stringify(products));
                
                if (idsToDelete.includes(String(selectedCategory))) {
                    selectedCategory = 'all';
                }
                renderCategoryFilters();
                renderCategoryDropdown();
                renderCategoryList();
                renderProducts();
                renderAdminProducts();
                renderCart();
            }
            
            // Uncheck the 'select all' if checked
            const selectAll = document.getElementById('select-all-categories');
            if (selectAll) selectAll.checked = false;
            checkCategorySelectionState();
            
            showToast(`${idsToDelete.length} kategori ve ilgili ürünler silindi.`, "info");
        }
    );
}

// Products Selection
function toggleSelectAllProducts() {
    const isChecked = document.getElementById('select-all-products').checked;
    document.querySelectorAll('.product-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });
    checkProductSelectionState();
}

function checkProductSelectionState() {
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    const anyChecked = checkedBoxes.length > 0;
    
    const btnDelete = document.getElementById('btn-delete-products');
    const btnEdit = document.getElementById('btn-bulk-edit-products');
    const countSpan = document.getElementById('products-selected-count');
    
    
    
    
    const btnAutoImg = document.getElementById('btn-bulk-auto-image');
    const btnFav = document.getElementById('btn-bulk-add-favorites');
    
    
    if (countSpan) countSpan.textContent = anyChecked ? `(${checkedBoxes.length} ürün seçildi)` : '';
    
    const counterEl = document.getElementById('products-counter');
    if (counterEl) {
        if (anyChecked) {
            counterEl.textContent = `(${checkedBoxes.length} ürün seçildi.)`;
            counterEl.style.display = 'inline';
        } else {
            counterEl.style.display = 'none';
        }
    }
}

function deleteSelectedProductsBulk() {
    if(document.querySelectorAll('.product-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir ürün seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    showCustomConfirm(
        `${checkedBoxes.length} adet ürünü silmek istediğinize emin misiniz?`,
        "Ürünleri Sil",
        "EVET",
        "HAYIR",
        (result) => {
            if (!result) return;
            
            const idsToDelete = Array.from(checkedBoxes).map(cb => cb.value);
            
            products = products.filter(p => !idsToDelete.includes(String(p.id)));
            cart = cart.filter(item => !idsToDelete.includes(String(item.product.id)));

            if (isFirebaseInitialized && currentUsername) {
                db.ref('products/' + currentUsername).set(products);
                renderCart();
            } else {
                appStorage.setItem('duran_cafe_products', JSON.stringify(products));
                renderAdminProducts();
                renderProducts();
                renderCart();
            }
            
            // Uncheck the 'select all' if checked
            const selectAll = document.getElementById('select-all-products');
            if (selectAll) selectAll.checked = false;
            checkProductSelectionState();
            
            showToast(`${idsToDelete.length} ürün silindi.`, "info");
        }
    );
}

// Bulk Edit Products Modal Logic
function openBulkEditProductsModal() {
    if(document.querySelectorAll('.product-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir ürün seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    const idsToEdit = Array.from(checkedBoxes).map(cb => cb.value);
    const productsToEdit = products.filter(p => idsToEdit.includes(String(p.id)));
    
    const tbody = document.getElementById('bulk-edit-products-body');
    tbody.innerHTML = '';
    
    productsToEdit.forEach(p => {
        const tr = document.createElement('tr');
        
        let catOptions = '';
        categories.forEach(cat => {
            catOptions += `<option value="${cat.id}" ${String(cat.id) === String(p.category) ? 'selected' : ''}>${escapeHTML(cat.name)}</option>`;
        });
        
        tr.innerHTML = `
            <td style="padding: 12px; text-align: center; position: relative;">
                <div class="bulk-image-upload-wrapper" onclick="triggerRowImageUpload(this)" style="cursor: pointer; position: relative; width: 60px; height: 60px; margin: 0 auto; border-radius: 6px; border: 1px dashed var(--panel-border); background: var(--input-bg); display: flex; align-items: center; justify-content: center; overflow: hidden;" title="Görsel Yüklemek İçin Tıklayın">
                    <img class="bulk-prod-img-preview" src="${p.image || ''}" style="width: 100%; height: 100%; object-fit: cover; display: ${p.image ? 'block' : 'none'};">
                    <span class="bulk-prod-img-plus" style="font-size: 2rem; font-weight: bold; line-height: 1; color: var(--text-muted); display: ${p.image ? 'none' : 'block'};">+</span>
                    <div class="bulk-prod-img-spinner" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); align-items: center; justify-content: center;">
                        <div class="spinner" style="width: 20px; height: 20px; border: 2px solid white; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                </div>
                <input type="file" accept="image/*" class="bulk-prod-file-input" style="display: none;" onchange="uploadBulkRowImage(this)">
                <input type="hidden" class="bulk-prod-image" value="${escapeHTML(p.image || '')}">
            </td>
            <td style="padding: 12px;">
                <input type="hidden" class="bulk-prod-id" value="${p.id}">
                <input type="text" class="bulk-prod-name" onchange="markUnsaved()" oninput="markUnsaved()" value="${escapeHTML(p.name)}" style="width: 100%; padding: 12px; font-size: 1.1rem; border: 1px solid var(--panel-border); border-radius: 6px; background: var(--input-bg); color: var(--text-main);">
            </td>
            <td style="padding: 12px;">
                <input type="number" step="1" class="bulk-prod-price" onchange="markUnsaved()" oninput="markUnsaved()" value="${p.price}" style="width: 100%; padding: 12px; font-size: 1.1rem; border: 1px solid var(--panel-border); border-radius: 6px; background: var(--input-bg); color: var(--text-main);">
            </td>
            <td style="padding: 12px;">
                <select class="bulk-prod-cat" onchange="markUnsaved()" style="width: 100%; padding: 12px; font-size: 1.1rem; border: 1px solid var(--panel-border); border-radius: 6px; background: var(--input-bg); color: var(--text-main);">
                    ${catOptions}
                </select>
            </td>
            <td style="padding: 12px; overflow: visible;">
                <div class="color-dropdown-container">
                    <div class="color-dropdown-trigger" style="background-color: ${(p.color && p.color.startsWith('#')) ? p.color : (p.color || 'var(--btn-coffee)')}" onclick="toggleColorDropdown(this)"></div>
                    <div class="color-dropdown-menu">
                        <div class="color-dropdown-row">
                            <div class="color-circle ${p.color === 'var(--btn-coffee)' ? 'selected' : ''}" style="background-color: var(--btn-coffee)" onclick="selectBulkColor(this, 'var(--btn-coffee)'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === 'var(--btn-teal)' ? 'selected' : ''}" style="background-color: var(--btn-teal)" onclick="selectBulkColor(this, 'var(--btn-teal)'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === 'var(--btn-orange)' ? 'selected' : ''}" style="background-color: var(--btn-orange)" onclick="selectBulkColor(this, 'var(--btn-orange)'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === 'var(--btn-blue)' ? 'selected' : ''}" style="background-color: var(--btn-blue)" onclick="selectBulkColor(this, 'var(--btn-blue)'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === 'var(--btn-purple)' ? 'selected' : ''}" style="background-color: var(--btn-purple)" onclick="selectBulkColor(this, 'var(--btn-purple)'); markUnsaved();"></div>
                        </div>
                        <div class="color-dropdown-row" style="margin-top: 8px;">
                            <div class="color-circle ${p.color === '#e11d48' ? 'selected' : ''}" style="background-color: #e11d48" onclick="selectBulkColor(this, '#e11d48'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === '#059669' ? 'selected' : ''}" style="background-color: #059669" onclick="selectBulkColor(this, '#059669'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === '#d97706' ? 'selected' : ''}" style="background-color: #d97706" onclick="selectBulkColor(this, '#d97706'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === '#4f46e5' ? 'selected' : ''}" style="background-color: #4f46e5" onclick="selectBulkColor(this, '#4f46e5'); markUnsaved();"></div>
                            <div class="color-circle ${p.color === '#1e293b' ? 'selected' : ''}" style="background-color: #1e293b" onclick="selectBulkColor(this, '#1e293b'); markUnsaved();"></div>
                        </div>
                        <label class="color-custom-btn">
                            Özel 
                            <input type="color" class="bulk-prod-color circle-picker" value="${(p.color && p.color.startsWith('#')) ? p.color : '#374151'}" onchange="selectBulkCustomColor(this); markUnsaved();">
                        </label>
                    </div>
                    <input type="hidden" class="bulk-prod-color-value" value="${p.color || 'var(--btn-coffee)'}">
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    window.hasUnsavedChanges = false;
    document.getElementById('bulk-edit-products-modal').style.display = 'flex';
}

function closeBulkEditProductsModal() {
    document.getElementById('bulk-edit-products-modal').style.display = 'none';
}

function saveBulkEditProducts() {
    const tbody = document.getElementById('bulk-edit-products-body');
    const rows = tbody.querySelectorAll('tr');
    
    let updatedCount = 0;
    
    rows.forEach(row => {
        const id = row.querySelector('.bulk-prod-id').value;
        const name = row.querySelector('.bulk-prod-name').value.trim();
        const price = parseFloat(row.querySelector('.bulk-prod-price').value);
        const color = row.querySelector('.bulk-prod-color-value').value;
        const category = row.querySelector('.bulk-prod-cat').value;
        const image = row.querySelector('.bulk-prod-image').value;
        
        if (!name || isNaN(price)) return; // Skip invalid
        
        const index = products.findIndex(p => String(p.id) === String(id));
        if (index !== -1) {
            products[index] = { ...products[index], name, price, color, category, image };
            updatedCount++;
        }
    });
    
    if (updatedCount > 0) {
        if (isFirebaseInitialized && currentUsername) {
            db.ref('products/' + currentUsername).set(products);
        } else {
            appStorage.setItem('duran_cafe_products', JSON.stringify(products));
            renderAdminProducts();
            renderProducts();
        }
        
        // Cart updates if product changed
        renderCart();
        showToast(`${updatedCount} ürün başarıyla güncellendi.`);
        
        // Uncheck boxes
        const selectAll = document.getElementById('select-all-products');
        if (selectAll) selectAll.checked = false;
        document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
        checkProductSelectionState();
    }
    
    window.hasUnsavedChanges = false;
    closeBulkEditProductsModal();
}


// Bulk Edit Categories Modal Logic
function openBulkEditCategoriesModal() {
    if(document.querySelectorAll('.category-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir kategori seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.category-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    const idsToEdit = Array.from(checkedBoxes).map(cb => cb.value);
    const catsToEdit = categories.filter(c => idsToEdit.includes(String(c.id)));
    
    const tbody = document.getElementById('bulk-edit-categories-body');
    tbody.innerHTML = '';
    
    catsToEdit.forEach(c => {
        const tr = document.createElement('tr');
        tr.style.cursor = "default";
        const colorVal = c.color || 'var(--btn-coffee)';
        tr.innerHTML = `
            <td style="padding: 12px;">
                <input type="hidden" class="bulk-cat-id" value="${c.id}">
                <input type="text" class="bulk-cat-name" onchange="markUnsaved()" oninput="markUnsaved()" value="${escapeHTML(c.name)}" style="width: 100%; padding: 12px; font-size: 1.1rem; border: 1px solid var(--panel-border); border-radius: 6px; background: var(--input-bg); color: var(--text-main);">
            </td>
            <td style="padding: 12px; overflow: visible;">
                <div class="color-dropdown-container">
                    <div class="color-dropdown-trigger" style="background-color: ${(colorVal && colorVal.startsWith('#')) ? colorVal : colorVal}" onclick="toggleColorDropdown(this)"></div>
                    <div class="color-dropdown-menu">
                        <div class="color-dropdown-row">
                            <div class="color-circle ${colorVal === 'var(--btn-coffee)' ? 'selected' : ''}" style="background-color: var(--btn-coffee)" onclick="selectBulkColor(this, 'var(--btn-coffee)'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === 'var(--btn-teal)' ? 'selected' : ''}" style="background-color: var(--btn-teal)" onclick="selectBulkColor(this, 'var(--btn-teal)'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === 'var(--btn-orange)' ? 'selected' : ''}" style="background-color: var(--btn-orange)" onclick="selectBulkColor(this, 'var(--btn-orange)'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === 'var(--btn-blue)' ? 'selected' : ''}" style="background-color: var(--btn-blue)" onclick="selectBulkColor(this, 'var(--btn-blue)'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === 'var(--btn-purple)' ? 'selected' : ''}" style="background-color: var(--btn-purple)" onclick="selectBulkColor(this, 'var(--btn-purple)'); markUnsaved();"></div>
                        </div>
                        <div class="color-dropdown-row" style="margin-top: 8px;">
                            <div class="color-circle ${colorVal === '#e11d48' ? 'selected' : ''}" style="background-color: #e11d48" onclick="selectBulkColor(this, '#e11d48'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === '#059669' ? 'selected' : ''}" style="background-color: #059669" onclick="selectBulkColor(this, '#059669'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === '#d97706' ? 'selected' : ''}" style="background-color: #d97706" onclick="selectBulkColor(this, '#d97706'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === '#4f46e5' ? 'selected' : ''}" style="background-color: #4f46e5" onclick="selectBulkColor(this, '#4f46e5'); markUnsaved();"></div>
                            <div class="color-circle ${colorVal === '#1e293b' ? 'selected' : ''}" style="background-color: #1e293b" onclick="selectBulkColor(this, '#1e293b'); markUnsaved();"></div>
                        </div>
                        <label class="color-custom-btn">
                            Özel 
                            <input type="color" class="bulk-cat-color circle-picker" value="${(colorVal && colorVal.startsWith('#')) ? colorVal : '#374151'}" onchange="selectBulkCustomColor(this); markUnsaved();">
                        </label>
                    </div>
                    <input type="hidden" class="bulk-cat-color-value" value="${colorVal}">
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Sortable removed to prevent script crashes
    
    window.hasUnsavedChanges = false;
    document.getElementById('bulk-edit-categories-modal').style.display = 'flex';
}

function closeBulkEditCategoriesModal() {
    document.getElementById('bulk-edit-categories-modal').style.display = 'none';
}

function saveBulkEditCategories() {
    const tbody = document.getElementById('bulk-edit-categories-body');
    const rows = tbody.querySelectorAll('tr');
    
    let updatedCount = 0;
    
    rows.forEach(row => {
        const id = row.querySelector('.bulk-cat-id').value;
        const name = row.querySelector('.bulk-cat-name').value.trim();
        const color = row.querySelector('.bulk-cat-color-value').value;
        
        if (!name) return;
        
        const cat = categories.find(c => String(c.id) === String(id));
        if (cat) {
            if (cat.name !== name || cat.color !== color) {
                cat.name = name;
                cat.color = color;
                updatedCount++;
            }
        }
    });
    
    if (updatedCount > 0) {
        if (isFirebaseInitialized && currentUsername) {
            db.ref('categories/' + currentUsername).set(categories);
        } else {
            appStorage.setItem('duran_cafe_categories', JSON.stringify(categories));
            renderCategoryFilters();
            renderCategoryDropdown();
            renderCategoryList();
            renderProducts();
            renderAdminProducts();
        }
        showToast(`${updatedCount} kategori başarıyla güncellendi.`);
    }
    
    // Uncheck boxes
    const selectAll = document.getElementById('select-all-categories');
    if (selectAll) selectAll.checked = false;
    document.querySelectorAll('.category-checkbox').forEach(cb => cb.checked = false);
    checkCategorySelectionState();
    
    window.hasUnsavedChanges = false;
    closeBulkEditCategoriesModal();
}

// Bulk Edit Helpers
let bulkEditIsDirty = false;

function selectBulkColor(element, colorVal) {
    const container = element.closest('.color-dropdown-container');
    container.querySelectorAll('.color-circle').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    const inputVal = container.querySelector('.bulk-prod-color-value, .bulk-cat-color-value');
    if (inputVal) inputVal.value = colorVal;
    
    // Update trigger background
    const trigger = container.querySelector('.color-dropdown-trigger');
    if (trigger) trigger.style.backgroundColor = colorVal;
    
    // Hide menu
    container.querySelector('.color-dropdown-menu').classList.remove('show');
    bulkEditIsDirty = true;
}

function selectBulkCustomColor(input) {
    const container = input.closest('.color-dropdown-container');
    container.querySelectorAll('.color-circle').forEach(el => el.classList.remove('selected'));
    const inputVal = container.querySelector('.bulk-prod-color-value, .bulk-cat-color-value');
    if (inputVal) inputVal.value = input.value;
    
    // Update trigger background
    const trigger = container.querySelector('.color-dropdown-trigger');
    if (trigger) trigger.style.backgroundColor = input.value;
    
    // Do not auto-hide on custom color change because the user might still be picking.
    bulkEditIsDirty = true;
}

function toggleColorDropdown(trigger) {
    // Close other menus first
    document.querySelectorAll('.color-dropdown-menu').forEach(m => {
        if (m !== trigger.nextElementSibling) m.classList.remove('show');
    });
    const menu = trigger.nextElementSibling;
    menu.classList.toggle('show');
}

// Close dropdowns if clicked outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.color-dropdown-container')) {
        document.querySelectorAll('.color-dropdown-menu').forEach(m => m.classList.remove('show'));
    }
});

setTimeout(() => {
    const prodBody = document.getElementById('bulk-edit-products-body');
    const catBody = document.getElementById('bulk-edit-categories-body');
    if (prodBody) prodBody.addEventListener('input', () => bulkEditIsDirty = true);
    if (catBody) catBody.addEventListener('input', () => bulkEditIsDirty = true);
}, 1000);

const origCloseProducts = closeBulkEditProductsModal;
closeBulkEditProductsModal = function() {
    if (bulkEditIsDirty) {
        showCustomConfirm("Değişiklikleri kaydetmek istiyor musunuz?", "Kaydedilmemiş Değişiklikler", "Kaydet", "Kaydetme", (res) => {
            if (res) {
                saveBulkEditProducts();
            } else {
                bulkEditIsDirty = false;
                origCloseProducts();
            }
        });
        document.getElementById('btn-custom-confirm-yes').style.backgroundColor = "var(--accent-green)";
        document.getElementById('btn-custom-confirm-no').style.backgroundColor = "var(--accent-red)";
        document.getElementById('btn-custom-confirm-yes').style.borderColor = "var(--accent-green)";
        document.getElementById('btn-custom-confirm-no').style.borderColor = "var(--accent-red)";
    } else {
        origCloseProducts();
    }
};

const origCloseCategories = closeBulkEditCategoriesModal;
closeBulkEditCategoriesModal = function() {
    if (bulkEditIsDirty) {
        showCustomConfirm("Değişiklikleri kaydetmek istiyor musunuz?", "Kaydedilmemiş Değişiklikler", "Kaydet", "Kaydetme", (res) => {
            if (res) {
                saveBulkEditCategories();
            } else {
                bulkEditIsDirty = false;
                origCloseCategories();
            }
        });
        document.getElementById('btn-custom-confirm-yes').style.backgroundColor = "var(--accent-green)";
        document.getElementById('btn-custom-confirm-no').style.backgroundColor = "var(--accent-red)";
        document.getElementById('btn-custom-confirm-yes').style.borderColor = "var(--accent-green)";
        document.getElementById('btn-custom-confirm-no').style.borderColor = "var(--accent-red)";
    } else {
        origCloseCategories();
    }
};

const origOpenProducts = openBulkEditProductsModal;
openBulkEditProductsModal = function() { bulkEditIsDirty = false; origOpenProducts(); };

const origSaveProducts = saveBulkEditProducts;
saveBulkEditProducts = function() { bulkEditIsDirty = false; origSaveProducts(); };

const origOpenCategories = openBulkEditCategoriesModal;
openBulkEditCategoriesModal = function() { bulkEditIsDirty = false; origOpenCategories(); };

const origSaveCategories = saveBulkEditCategories;
saveBulkEditCategories = function() { bulkEditIsDirty = false; origSaveCategories(); };

const origCloseConfirm = closeCustomConfirm;
closeCustomConfirm = function(res) {
    origCloseConfirm(res);
    setTimeout(() => {
        document.getElementById('btn-custom-confirm-yes').style.backgroundColor = "";
        document.getElementById('btn-custom-confirm-no').style.backgroundColor = "";
        document.getElementById('btn-custom-confirm-yes').style.borderColor = "";
        document.getElementById('btn-custom-confirm-no').style.borderColor = "";
    }, 300);
};


// ==========================================
// ADMIN (MÜŞTERİLER) PANEL LOGIC
// ==========================================

function loadAdminUsers() {
    if (currentUsername !== 'durancafe') return;
    
    db.ref('users').once('value').then(snapshot => {
        const usersObj = snapshot.val() || {};
        const tbody = document.getElementById('admin-users-table-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        for (const [uname, udata] of Object.entries(usersObj)) {
            // Count active sessions
            let activeSessions = 0;
            if (udata.sessions) {
                activeSessions = Object.keys(udata.sessions).length;
            }
            
            let expiryText = udata.license_expiry || 'Süresiz / Belirtilmemiş';
            let isExpired = false;
            if (udata.license_expiry) {
                const expiryDate = new Date(udata.license_expiry);
                if (expiryDate < new Date()) {
                    isExpired = true;
                    expiryText = `<span style="color: var(--accent-red); font-weight: bold;">${udata.license_expiry} (Süresi Dolmuş)</span>`;
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 16px; border-bottom: 1px solid var(--panel-border);"><strong>${escapeHTML(uname)}</strong></td>
                <td style="padding: 16px; border-bottom: 1px solid var(--panel-border); vertical-align: middle;">
        <div style="display: flex; align-items: center; gap: 8px;">
        <span id="admin-pw-${uname}" data-pw="${escapeHTML(udata.password || '')}">${udata.password ? '••••••••' : 'Bilinmiyor'}</span>
        ${udata.password ? `<span style="cursor: pointer; color: var(--text-muted);" onclick="toggleAdminPassword('${uname}')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
        </span>` : ''}
        </div>
    </td>
                <td style="padding: 16px; border-bottom: 1px solid var(--panel-border);">${expiryText}</td>
                <td style="padding: 16px; border-bottom: 1px solid var(--panel-border);">
                    <span style="${activeSessions > 0 ? 'color: var(--accent-blue); font-weight: bold;' : 'color: var(--text-muted);'}">${activeSessions} aktif</span>
                </td>
                <td style="padding: 16px; border-bottom: 1px solid var(--panel-border); text-align: right; gap: 8px; display: flex; justify-content: flex-end;">
                    <button class="btn-pos" style="background: var(--btn-teal); padding: 8px 12px; font-size: 0.9rem;" onclick="adminAddTrial('${uname}')">+7 Gün Deneme</button>
                    <button class="btn-pos" style="background: var(--accent-blue); padding: 8px 12px; font-size: 0.9rem;" onclick="adminLoginAs('${uname}')">Giriş Yap</button>
                </td>
            `;
            tbody.appendChild(tr);
        }
    }).catch(err => {
        console.error('Error loading admin users:', err);
        showToast('Kullanıcılar yüklenemedi', 'error');
    });
}

// Intercept tab switching to load admin data
const origSwitchTabAdmin = switchTab;
switchTab = function(tabId) {
    origSwitchTabAdmin(tabId);
    if (tabId === 'admin') {
        document.getElementById('tab-content-admin').classList.add('active');
        const adminBtn = document.getElementById('btn-tab-admin');
        if(adminBtn) adminBtn.classList.add('active');
        loadAdminUsers();
    }
};

function adminLoginAs(username) {
    showCustomConfirm(username + " hesabına giriş yapmak istiyor musunuz?", "Hesaba Giriş Yap", "Giriş Yap", "İptal", (res) => {
        if(res) {
            // Terminate current listener
            if (isFirebaseInitialized && currentUsername) {
                db.ref('users/' + currentUsername).off('value');
                db.ref('products/' + currentUsername).off('value');
                db.ref('categories/' + currentUsername).off('value');
            }
            // Start session as the new user using a special admin token
            const adminToken = "admin_" + Date.now();
            
            // First fetch the target user data to pass it
            db.ref('users/' + username).once('value').then(snap => {
                const targetData = snap.val();
                
                // Write session
                db.ref(`users/${username}/sessions/${adminToken}`).set({
                    userAgent: navigator.userAgent,
                    loginTime: new Date().toISOString(),
                    deviceId: "admin_override"
                }).then(() => {
                    startPOSSession(username, adminToken, targetData);
                    switchTab('pos');
                    showToast(username + " hesabına admin olarak giriş yapıldı.", "success");
                });
            });
        }
    });
}

function adminAddTrial(username) {
    const today = new Date();
    today.setDate(today.getDate() + 7);
    const expiryStr = today.toISOString().split('T')[0];
    
    db.ref(`users/${username}/license_expiry`).set(expiryStr).then(() => {
        showToast(username + " kullanıcısına +7 gün deneme süresi eklendi.", "success");
        loadAdminUsers();
    }).catch(err => {
        showToast("Hata oluştu", "error");
    });
}

function openCreateUserModal() {
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('create-user-modal').style.display = 'flex';
}

function closeCreateUserModal() {
    document.getElementById('create-user-modal').style.display = 'none';
}

function submitCreateUser() {
    const u = document.getElementById('new-user-username').value.trim().toLowerCase();
    const p = document.getElementById('new-user-password').value.trim();
    
    if (!u || !p) {
        showToast('Kullanıcı adı ve şifre zorunludur.', 'error');
        return;
    }
    
    // Check if exists
    db.ref('users/' + u).once('value').then(snap => {
        if (snap.exists()) {
            showToast('Bu kullanıcı adı zaten alınmış!', 'error');
            return;
        }
        
        // Give 14 days default trial
        const today = new Date();
        today.setDate(today.getDate() + 14);
        const expiryStr = today.toISOString().split('T')[0];
        
        const newData = {
            password: p,
            license_expiry: expiryStr,
            createdAt: new Date().toISOString()
        };
        
        db.ref('users/' + u).set(newData).then(() => {
            showToast(u + ' kullanıcısı başarıyla oluşturuldu!', 'success');
            closeCreateUserModal();
            loadAdminUsers();
        }).catch(err => {
            showToast('Kullanıcı oluşturulurken hata oluştu.', 'error');
        });
    });
}

window.hasUnsavedChanges = false;
function attemptCloseModal(modalId) {
    if (window.hasUnsavedChanges) {
        showCustomConfirm("Değişiklikleri kaydetmeden çıkmak istediğinize emin misiniz?", "Kaydedilmemiş Değişiklikler", "Evet, Çık", "İptal", (res) => {
            if(res) {
                window.hasUnsavedChanges = false;
                document.getElementById(modalId).style.display = 'none';
            }
        });
    } else {
        document.getElementById(modalId).style.display = 'none';
    }
}
function markUnsaved() {
    window.hasUnsavedChanges = true;
}

function toggleAdminPassword(uname) {
    const el = document.getElementById('admin-pw-' + uname);
    if (!el) return;
    const pw = el.getAttribute('data-pw');
    if (el.textContent === '••••••••') {
        el.textContent = pw;
    } else {
        el.textContent = '••••••••';
    }
}





function getItemImagesDir() {
    const { remote } = window.require('electron');
    // For portable exe: save next to the exe file
    let baseDir;
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        baseDir = process.env.PORTABLE_EXECUTABLE_DIR;
    } else if (remote && remote.app) {
        baseDir = path.dirname(remote.app.getPath('exe'));
    } else {
        // Fallback: use userData (AppData/Roaming)
        try {
            const { app: electronApp } = window.require('@electron/remote') || {};
            if (electronApp) {
                baseDir = electronApp.getPath('userData');
            } else {
                baseDir = path.join(window.require('os').homedir(), 'AppData', 'Roaming', 'duranlux-pos');
            }
        } catch(e) {
            baseDir = path.join(window.require('os').homedir(), 'AppData', 'Roaming', 'duranlux-pos');
        }
    }
    const dir = path.join(baseDir, 'item_images');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}


// Helper: convert local file path to displayable src
function getImageSrc(imagePath) {
    if (!imagePath) return '';
    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
    // For local paths, use file:// protocol
    return 'file:///' + imagePath.replace(/\\/g, '/');
}

function slugify(text) {
    if (!text) return 'item';
    const trMap = {
        'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I',
        'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U'
    };
    let str = text;
    for (let key in trMap) {
        str = str.replace(new RegExp(key, 'g'), trMap[key]);
    }
    return str.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}


function saveProductsData() {
    if (isFirebaseInitialized && currentUsername) {
        db.ref('products/' + currentUsername).set(products);
    } else {
        appStorage.setItem('duran_cafe_products', JSON.stringify(products));
        renderAdminProducts();
        renderProducts();
    }
}


// ==========================================
// IMAGE & FAVORITES LOGIC
// ==========================================

const IMGUR_CLIENT_ID = '546c25a59c58ad7';


// Auto-add Su ve Çay to favorites for all users
async function autoAddDefaultFavorites() {
    const flag = appStorage.getItem('duran_default_favs_v138');
    if (flag) return;
    
    let modified = false;
    products.forEach(p => {
        if (p.name === 'Su' || p.name === 'Çay') {
            if (!p.favorite) {
                p.favorite = true;
                modified = true;
            }
        }
    });
    
    if (modified) {
        saveProductsData();
        console.log("Su ve Çay favorilere eklendi.");
    }
    appStorage.setItem('duran_default_favs_v138', 'true');
}

function addSelectedToFavorites() {
    if(document.querySelectorAll('.product-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir ürün seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showToast("Lütfen önce ürün seçin.", "var(--accent-red)");
        return;
    }
    
    let updatedCount = 0;
    checkedBoxes.forEach(cb => {
        const prod = products.find(p => String(p.id) === cb.value);
        if (prod) {
            prod.favorite = true;
            updatedCount++;
        }
    });
    
    if (updatedCount > 0) {
        saveProductsData();
        renderAdminProducts();
        renderProducts(); // Refresh POS
        showToast(updatedCount + " ürün favorilere eklendi!", "var(--btn-teal)");
    }
}


// Get SerpAPI key securely (stored in appStorage, set at startup)
function getSerpApiKey() {
    return appStorage.getItem('duran_serpapi_key') || '';
}

async function searchSerpAPI(productName) {
    const https = window.require('https');
    return new Promise((resolve) => {
        const query = encodeURIComponent(productName + ' food high quality');
        const url = `https://serpapi.com/search.json?engine=google_images&q=${query}&ijn=0&api_key=' + getSerpApiKey() + '`;
        
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.images_results && json.images_results.length > 0) {
                        // Get up to 3 image URLs
                        const images = json.images_results.slice(0, 3).map(r => r.original || r.thumbnail);
                        resolve(images.filter(Boolean));
                    } else {
                        resolve([]);
                    }
                } catch(e) { resolve([]); }
            });
        }).on('error', () => resolve([]));
    });
}

function resizeAndConvertToWebP(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Only set crossOrigin for external URLs, not data URLs
        if (!imageUrl.startsWith('data:')) {
            img.crossOrigin = 'Anonymous';
        }
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300;
            const ctx = canvas.getContext('2d');
            
            // Cover logic
            const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
            const x = (canvas.width / 2) - (img.width / 2) * scale;
            const y = (canvas.height / 2) - (img.height / 2) * scale;
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
            
            const dataUrl = canvas.toDataURL('image/webp', 0.8);
            resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = imageUrl;
    });
}

async function uploadToImgur(base64Data) {
    const base64Image = base64Data.split(',')[1];
    try {
        const response = await fetch('https://api.imgur.com/3/image', {
            method: 'POST',
            headers: {
                'Authorization': 'Client-ID ' + IMGUR_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image: base64Image,
                type: 'base64'
            })
        });
        const result = await response.json();
        if (result.success) {
            return result.data.link;
        }
    } catch(e) {
        console.error('Imgur upload error:', e);
    }
    return null;
}

async function processProductAutoImage(product) {
    console.log("SerpAPI searching for:", product.name);
    
    const images = await searchSerpAPI(product.name);
    if (images.length === 0) {
        throw new Error('No images found');
    }
    
    // Store all 3 image URLs (alternatives array) and set first as primary
    const prod = products.find(p => String(p.id) === String(product.id || product));
    if (prod) {
        prod.image = images[0]; // Primary image (direct URL)
        prod.imageAlternatives = images; // All 3 alternatives
    }
    
    console.log("Found", images.length, "images for", product.name || product);
    return images[0];
}

async function autoAddImagesToSelected() {
    if(document.querySelectorAll('.product-checkbox:checked').length === 0) {
        showToast('Lütfen en az bir ürün seçiniz.', '#ef4444');
        return;
    }
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showToast("Lütfen görsel eklenecek ürünleri seçin.", "var(--accent-red)");
        return;
    }
    
    showToast("Görseller bulunuyor ve işleniyor, lütfen bekleyin...", "var(--accent-blue)");
    
    const results = {};
    let successCount = 0;
    
    for (const cb of checkedBoxes) {
        const prod = products.find(p => String(p.id) === cb.value);
        if (prod) {
            try {
                const link = await processProductAutoImage(prod);
                prod.image = link;
                results[prod.name] = link;
                successCount++;
            } catch(e) {
                console.warn(prod.name, "hata:", e.message);
                results[prod.name] = "Hata: " + e.message;
            }
        }
    }
    
    console.log("Auto Image Results JSON:", JSON.stringify(results, null, 2));
    
    if (successCount > 0) {
        saveProductsData();
        renderAdminProducts();
        renderProducts(); // Refresh POS
        showToast(successCount + " ürünün görseli başarıyla eklendi!", "var(--btn-teal)");
    } else {
        showToast("Görsel ekleme başarısız oldu.", "var(--accent-red)");
    }
}

async function autoImageForSingleProduct() {
    const prodName = document.getElementById('edit-product-name').value;
    if (!prodName) return showToast("Önce ürün adını girin", "var(--accent-red)");
    showToast("Görsel aranıyor...", "var(--accent-blue)");
    try {
        const link = await processProductAutoImage(prodName);
        document.getElementById('edit-product-image').value = link;
        markUnsaved();
        showToast("Görsel başarıyla bulundu!", "var(--btn-teal)");
    } catch(e) {
        showToast("Görsel bulunamadı.", "var(--accent-red)");
    }
}

async function autoImageForSingleAddProduct() {
    const prodName = document.getElementById('add-product-name').value;
    if (!prodName) return showToast("Önce ürün adını girin", "var(--accent-red)");
    showToast("Görsel aranıyor...", "var(--accent-blue)");
    try {
        const link = await processProductAutoImage(prodName);
        document.getElementById('add-product-image').value = link;
        markUnsaved();
        showToast("Görsel başarıyla bulundu!", "var(--btn-teal)");
    } catch(e) {
        showToast("Görsel bulunamadı.", "var(--accent-red)");
    }
}

// Bulk Edit Upload logic
function triggerBulkImageUpload(inputId) {
    const input = document.getElementById(inputId);
    input.click();
}

function handleBulkImageFile(event, imgElementId, inputElementId) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById(imgElementId).src = e.target.result;
        document.getElementById(imgElementId).style.display = 'block';
        document.getElementById(imgElementId).nextElementSibling.style.display = 'none'; // hide +
        document.getElementById(inputElementId).value = e.target.result; // store base64 temporarily
        markUnsaved();
    }
    reader.readAsDataURL(file);
}


function updateCategoryCustomColor(picker) {
    const radio = document.getElementById('category-color-custom-radio');
    const textSpan = document.getElementById('category-custom-color-text');
    const label = picker.closest('label');
    if (radio && label) {
        radio.value = picker.value;
        radio.checked = true;
        label.style.backgroundColor = picker.value;
        label.style.color = getContrastYIQ(picker.value);
        if (textSpan) textSpan.textContent = "Özel: " + picker.value.toUpperCase();
        markUnsaved();
    }
}

function getContrastYIQ(hexcolor){
    if (!hexcolor || hexcolor.startsWith('var')) return '#ffffff';
    const hex = hexcolor.replace('#', '');
    const r = parseInt(hex.substr(0,2),16);
    const g = parseInt(hex.substr(2,2),16);
    const b = parseInt(hex.substr(4,2),16);
    const yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}

function triggerSingleImageUpload() {
    const fileInput = document.getElementById('modal-product-image-upload');
    if (fileInput) fileInput.click();
}

async function uploadSingleProductImage(input) {
    const fs = window.require('fs');
    const path = window.require('path');
    
    const file = input.files[0];
    if (!file) return;
    
    const prodId = document.getElementById('modal-edit-product-id').value || String(Date.now());
    const prodName = document.getElementById('modal-product-name').value.trim() || 'product';
    
    showToast("Görsel yükleniyor...", "var(--accent-blue)");
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsDataURL(file);
        });
        
        const webpBase64 = await resizeAndConvertToWebP(dataUrl);
        
        // Save locally
        const filename = slugify(prodName) + '-' + prodId + '.webp';
        const itemImagesDir = getItemImagesDir();
        
        const base64Data = webpBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const localPath = path.join(itemImagesDir, filename);
        fs.writeFileSync(localPath, buffer);
        
        document.getElementById('modal-product-image').value = localPath;
        
        // Update modal preview
        const imgPreview = document.getElementById('modal-product-image-preview');
        const imgPlaceholder = document.getElementById('modal-product-image-preview-placeholder');
        if (imgPreview) {
            imgPreview.src = getImageSrc(localPath);
            imgPreview.style.display = 'block';
        }
        if (imgPlaceholder) imgPlaceholder.style.display = 'none';
        
        markUnsaved();
        showToast("Görsel başarıyla yüklendi!", "var(--btn-teal)");
    } catch(e) {
        console.error(e);
        showToast("Görsel yüklenirken hata oluştu.", "var(--accent-red)");
    }
}

function triggerRowImageUpload(wrapper) {
    const fileInput = wrapper.nextElementSibling;
    if (fileInput) fileInput.click();
}

async function uploadBulkRowImage(fileInput) {
    const fs = window.require('fs');
    const path = window.require('path');
    
    const file = fileInput.files[0];
    if (!file) return;
    
    const wrapper = fileInput.previousElementSibling;
    const previewImg = wrapper.querySelector('.bulk-prod-img-preview');
    const plusSpan = wrapper.querySelector('.bulk-prod-img-plus');
    const spinner = wrapper.querySelector('.bulk-prod-img-spinner');
    const hiddenInput = fileInput.nextElementSibling;
    
    const row = fileInput.closest('tr');
    const prodId = row.querySelector('.bulk-prod-id').value;
    const prodName = row.querySelector('.bulk-prod-name').value.trim() || 'product';
    
    if (spinner) spinner.style.display = 'flex';
    
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(e);
            reader.readAsDataURL(file);
        });
        
        const webpBase64 = await resizeAndConvertToWebP(dataUrl);
        
        // Save locally
        const filename = slugify(prodName) + '-' + prodId + '.webp';
        const itemImagesDir = getItemImagesDir();
        
        const base64Data = webpBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const localPath = path.join(itemImagesDir, filename);
        fs.writeFileSync(localPath, buffer);
        
        if (previewImg) {
            previewImg.src = getImageSrc(localPath);
            previewImg.style.display = 'block';
        }
        if (plusSpan) plusSpan.style.display = 'none';
        if (hiddenInput) hiddenInput.value = localPath;
        
        markUnsaved();
        showToast("Görsel başarıyla yüklendi!", "var(--btn-teal)");
    } catch(e) {
        console.error(e);
        showToast("Görsel yüklenirken hata oluştu.", "var(--accent-red)");
    } finally {
        if (spinner) spinner.style.display = 'none';
    }
}
