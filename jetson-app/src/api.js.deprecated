// Auto-detect: if served from port 4500 or non-localhost, we're on the Jetson
export const isLocal = window.location.port === '4500' || (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1');

export const API_URL = isLocal
  ? `http://${window.location.hostname}:4500/api`
  : 'http://localhost:4500/ssh';

export const rosEnv = (domainId = 42) =>
  `source /opt/ros/humble/setup.bash && source ~/ros2_ws/install/setup.bash 2>/dev/null && export ROS_DOMAIN_ID=${domainId} && export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp && export CYCLONEDDS_URI=file:///home/ada/cyclonedds.xml`;

// Build request body — on Jetson no SSH creds needed
const body = (data, host) => {
  if (isLocal) return JSON.stringify(data);
  return JSON.stringify({ ...data, host, user: 'ada', password: 'ada123' });
};

const post = async (path, data, host) => {
  const r = await fetch(`${API_URL}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body(data, host),
  });
  return r.json();
};

export const apiExec = (command, host) => post('exec', { command }, host);
export const apiLaunch = (id, command, host) => post('launch', { id, command }, host);
export const apiStop = (id, host, opts = {}) => post('stop', { id, ...opts }, host);
export const apiOutput = async (id, since) => {
  // /output never needs SSH creds
  const r = await fetch(`${API_URL}/output`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, since }),
  });
  return r.json();
};

export const apiConfig = (host) => post('config', {}, host);
export const apiLog = (events, host) => post('log', { events }, host);
export const apiLogList = (filters, host) => post('log/list', filters || {}, host);
export const apiServicesStatus = (host) => post('services/status', {}, host);
export const apiServicesRestart = (name, action, host) => post('services/restart', { name, action }, host);
export const apiPreflight = (ids, host) => post('preflight', ids, host);
export const apiMcapInfo = (ids, host) => post('mcap-info', ids, host);

export const getRosbridgeUrl = (jetsonHost, jetsonPort = '9090') => {
  if (isLocal) return `ws://${window.location.hostname}:${jetsonPort}`;
  return `ws://${jetsonHost}:${jetsonPort}`;
};
