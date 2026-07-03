const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');

// Force user data to be stored in the standard OS AppData folder using os.homedir()
// This bypasses electron-builder's portable wrapper which modifies environment variables (like APPDATA).
app.setPath('userData', path.join(os.homedir(), 'AppData', 'Roaming', 'duranlux-pos'));


function createWindow() {
  const fs = require('fs');
  let base64Logo = '';
  try {
    base64Logo = fs.readFileSync(path.join(__dirname, 'icon.png')).toString('base64');
  } catch (e) {
    // fallback
  }

  // Create splash screen window
  const splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    frame: false,
    backgroundColor: '#232129',
    alwaysOnTop: true,
    resizable: false,
    center: true,
    show: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const splashStartTime = Date.now();

  const splashHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          padding: 0;
          background: #232129;
          color: white;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          box-sizing: border-box;
          overflow: hidden;
        }
        .logo {
          width: 90px;
          height: 90px;
          margin-bottom: 25px;
        }
        .title {
          font-size: 22px;
          font-weight: bold;
          margin-bottom: 25px;
        }
        
        /* GDI+ Style Dot Spinner in CSS */
        .spinner-container {
          width: 32px;
          height: 32px;
          position: relative;
          margin-bottom: 25px;
          transform: rotate(0deg);
          animation: spin 1s steps(8) infinite;
        }
        .dot {
          position: absolute;
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          left: 12px;
          top: 12px;
        }
        .dot:nth-child(1) { transform: rotate(0deg) translateY(-16px); opacity: 1; }
        .dot:nth-child(2) { transform: rotate(45deg) translateY(-16px); opacity: 0.8; }
        .dot:nth-child(3) { transform: rotate(90deg) translateY(-16px); opacity: 0.6; }
        .dot:nth-child(4) { transform: rotate(135deg) translateY(-16px); opacity: 0.4; }
        .dot:nth-child(5) { transform: rotate(180deg) translateY(-16px); opacity: 0.2; }
        .dot:nth-child(6) { transform: rotate(225deg) translateY(-16px); opacity: 0.15; }
        .dot:nth-child(7) { transform: rotate(270deg) translateY(-16px); opacity: 0.15; }
        .dot:nth-child(8) { transform: rotate(315deg) translateY(-16px); opacity: 0.15; }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .subtitle {
          font-size: 12px;
          color: #cccccc;
        }
      </style>
    </head>
    <body>
      ${base64Logo ? `<img class="logo" src="data:image/png;base64,${base64Logo}" />` : ''}
      <div class="title">Duranlux Adisyon</div>
      <div class="spinner-container">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div>
        <div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
      <div class="subtitle">Duranlux Adisyon ba&#351;lat&#305;l&#305;yor...</div>
    </body>
    </html>
  `;
  
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);

  const mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 700,
    show: false, // Don't show the window until it's ready-to-show to prevent lag/white flash
    title: "Duranlux POS Kasa Sistemi",
    icon: path.join(__dirname, 'icon.png'), // High resolution runtime icon
    autoHideMenuBar: true, // Hides the standard File/Edit browser menu bar
    webPreferences: {
      nodeIntegration: true, // Enabled for update process and native system utilities
      contextIsolation: false
    }
  });

  // Load the main index.html file
  mainWindow.loadFile('index.html');

  // Show window only when ready to render
  mainWindow.once('ready-to-show', () => {
    // Ensure splash screen shows for at least 1.5 seconds
    const elapsed = Date.now() - splashStartTime;
    const remainingTime = Math.max(0, 1500 - elapsed);
    
    setTimeout(() => {
      mainWindow.maximize();
      mainWindow.show();
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
    }, remainingTime);
  });

  // Open developer tools (Optional, uncomment during debugging)
  // mainWindow.webContents.openDevTools();
}

// IPC listener to quit app cleanly during updater process
ipcMain.on('quit-app', () => {
  app.quit();
});

// When Electron is ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS (darwin)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
