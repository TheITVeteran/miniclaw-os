/**
 * viewer-html.ts — inline noVNC web viewer page
 *
 * Served at GET /?token=<TOKEN> after token validation.
 * Loads noVNC from CDN (unpkg/jsdelivr) and auto-connects to the local
 * WebSocket proxy endpoint (/websockify).
 */

export function buildViewerHtml(opts: {
  wsPath: string;
  token: string;
  reason: string;
  vncPassword?: string;
}): string {
  const { wsPath, token, reason, vncPassword } = opts;
  // noVNC core from jsdelivr CDN — stable 1.5.0 release
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AM Human Session — ${escHtml(reason)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#1a1a2e; color:#eee; font-family:sans-serif; display:flex; flex-direction:column; height:100vh; }
  #header { padding:10px 16px; background:#16213e; border-bottom:1px solid #0f3460; display:flex; align-items:center; gap:12px; }
  #header h1 { font-size:14px; font-weight:600; }
  #reason { font-size:12px; color:#a0aec0; flex:1; }
  #status { font-size:12px; padding:4px 10px; border-radius:12px; background:#2d3748; }
  #status.connected { background:#276749; color:#9ae6b4; }
  #status.error { background:#742a2a; color:#fc8181; }
  #screen { flex:1; overflow:hidden; position:relative; }
  #noVNC_canvas { width:100%; height:100%; }
  #overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:16px; background:#1a1a2e; }
  #overlay p { color:#a0aec0; }
  .spinner { width:32px; height:32px; border:3px solid #2d3748; border-top-color:#63b3ed; border-radius:50%; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  #close-btn { position:fixed; bottom:16px; right:16px; padding:8px 18px; background:#e53e3e; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:14px; }
  #close-btn:hover { background:#c53030; }
</style>
</head>
<body>
<div id="header">
  <h1>AM Human Session</h1>
  <span id="reason">Reason: ${escHtml(reason)}</span>
  <span id="status">Connecting…</span>
</div>
<div id="screen">
  <div id="overlay">
    <div class="spinner"></div>
    <p>Connecting to desktop…</p>
  </div>
</div>
<button id="close-btn" onclick="closeSession()">Done — Resume AM</button>

<script type="module">
import RFB from '/novnc/rfb.js';

const status = document.getElementById('status');
const overlay = document.getElementById('overlay');
const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = wsProto + '://' + location.host + '${wsPath}?token=${token}';
const vncPassword = ${vncPassword ? JSON.stringify(vncPassword) : 'null'};

let rfb;
try {
  rfb = new RFB(document.getElementById('screen'), wsUrl, {
    credentials: vncPassword ? { password: vncPassword } : {},
  });

  rfb.addEventListener('connect', () => {
    overlay.style.display = 'none';
    status.textContent = 'Connected';
    status.className = 'connected';
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
  });

  rfb.addEventListener('disconnect', (e) => {
    status.textContent = e.detail.clean ? 'Disconnected' : 'Lost connection';
    status.className = 'error';
    overlay.innerHTML = '<p>' + (e.detail.clean ? 'Session ended.' : 'Connection lost. You can close this tab.') + '</p>';
    overlay.style.display = 'flex';
  });

  rfb.addEventListener('credentialsrequired', () => {
    // Fallback if auto-auth fails
    const pw = prompt('VNC password:') ?? '';
    rfb.sendCredentials({ password: pw });
  });
} catch(err) {
  status.textContent = 'Error';
  status.className = 'error';
  overlay.innerHTML = '<p>Failed to load VNC client: ' + err.message + '</p>';
}

window.closeSession = function() {
  if (rfb) rfb.disconnect();
  fetch('/session-done?token=${token}', { method: 'POST' }).finally(() => {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#a0aec0;font-family:sans-serif">Session closed. AM is resuming. You can close this tab.</div>';
  });
};

// Auto-signal done when tab closes
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/session-done?token=${token}');
});
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
