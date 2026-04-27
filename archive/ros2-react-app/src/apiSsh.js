// Thin client wrapper around the desktop ssh-bridge.js (routes under /ssh/*).
// All requests carry SSH creds in the body so the bridge can connect to the Jetson.

const SSH_URL = ''; // same-origin; the desktop dev server proxies / ssh-bridge runs alongside

const post = async (path, data) => {
  const r = await fetch(`${SSH_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
};

const withCreds = (jetsonHost, extra = {}) => ({
  host: jetsonHost, user: 'ada', password: 'ada123', ...extra,
});

export const apiExec = (command, host) => post('/ssh/exec', withCreds(host, { command }));
export const apiLaunch = (id, command, host) => post('/ssh/launch', withCreds(host, { id, command }));
export const apiStop = (id, host, opts = {}) => post('/ssh/stop', withCreds(host, { id, ...opts }));
export const apiOutput = (id, since) => post('/ssh/output', { id, since });

export const apiConfig = (host) => post('/ssh/config', withCreds(host));
export const apiLog = (events, host) => post('/ssh/log', withCreds(host, { events }));
export const apiLogList = (filters, host) => post('/ssh/log/list', withCreds(host, filters || {}));
export const apiServicesStatus = (host) => post('/ssh/services/status', withCreds(host));
export const apiServicesRestart = (name, action, host) => post('/ssh/services/restart', withCreds(host, { name, action }));
export const apiPreflight = (ids, host) => post('/ssh/preflight', withCreds(host, ids));
export const apiMcapInfo = (ids, host) => post('/ssh/mcap-info', withCreds(host, ids));
