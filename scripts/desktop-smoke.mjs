import { spawn } from 'node:child_process';

const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/desktop-smoke.mjs <path-to-exe>');

const deadline = Date.now() + 60_000;
const child = spawn(executable, [], { stdio: 'ignore', windowsHide: false });
let socket;
let nextMessageId = 1;

function evaluate(expression) {
  const id = nextMessageId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for WebView2 DevTools response.'));
    }, 5_000);

    function onMessage(event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result?.result?.value);
    }

    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
}

try {
  child.on('error', error => {
    throw error;
  });

  let pageTarget;
  while (Date.now() < deadline && !pageTarget) {
    if (child.exitCode !== null) {
      throw new Error(`SeasonFetch exited before its WebView appeared (code ${child.exitCode}); check the WebView2 Runtime.`);
    }
    try {
      const response = await fetch('http://127.0.0.1:9222/json/list');
      if (response.ok) {
        const targets = await response.json();
        pageTarget = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      }
    } catch {
      // The WebView2 debugging endpoint may take several seconds to start.
    }
    if (!pageTarget) await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!pageTarget) throw new Error('WebView2 did not expose a page within 60 seconds.');

  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to WebView2 DevTools.')), 10_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Could not connect to WebView2 DevTools.'));
    }, { once: true });
  });

  let rendered;
  while (Date.now() < deadline) {
    const value = await evaluate(
      "JSON.stringify({title: document.title, body: document.body?.innerText ?? '', bridge: document.querySelector('.desktop-bridge-status')?.innerText ?? ''})",
    );
    if (typeof value === 'string') {
      rendered = JSON.parse(value);
      if (rendered.body.includes('SeasonFetch') && rendered.bridge.includes('Native bridge connected')) break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!rendered?.body.includes('SeasonFetch')) {
    throw new Error('The SeasonFetch React interface did not render in the desktop WebView.');
  }
  if (!rendered.bridge.includes('Native bridge connected')) {
    throw new Error(`The React UI did not receive the native Rust status event. Last bridge status: ${rendered.bridge || '(missing)'}`);
  }

  console.log(`Rendered page: ${rendered.title || 'SeasonFetch'}`);
  console.log(`Native IPC verified: ${rendered.bridge}`);
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill();
}
