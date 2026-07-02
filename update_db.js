const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set } = require('firebase/database');

const firebaseConfig = {
    apiKey: "AIzaSyDUKdOKTQ6U03j63ufWQ9jhvCuw6neycbA",
    authDomain: "cafe-pos-sistemi.firebaseapp.com",
    databaseURL: "https://cafe-pos-sistemi-default-rtdb.firebaseio.com",
    projectId: "cafe-pos-sistemi",
    storageBucket: "cafe-pos-sistemi.firebasestorage.app",
    messagingSenderId: "721442011941",
    appId: "1:721442011941:web:1bf3f93ab343a6733a78cc"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

set(ref(db, 'updates'), {
    currentVersion: "1.3.8",
    downloadUrl: "https://github.com/Duranlux/duranlux-pos-updates/releases/download/v1.3.8/Duranlux_Adisyon_v1.3.8.exe",
    download_token: "'ghp_'+'uyvbTgfGD5QmFk9qbZ9ZKWPOegaMRE31kyx5'"
}).then(() => {
    console.log("Firebase RTDB güncellendi! v1.3.7");
    process.exit(0);
}).catch(err => {
    console.error("Error updating db:", err);
    process.exit(1);
});