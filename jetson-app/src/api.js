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

export const apiExec = async (command, host) => {
  const r = await fetch(`${API_URL}/exec`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body({ command }, host),
  });
  return r.json();
};

export const apiLaunch = async (id, command, host) => {
  const r = await fetch(`${API_URL}/launch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body({ id, command }, host),
  });
  return r.json();
};

export const apiStop = async (id, host) => {
  const r = await fetch(`${API_URL}/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body({ id }, host),
  });
  return r.json();
};

export const apiOutput = async (id, since) => {
  const r = await fetch(`${API_URL}/output`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, since }),
  });
  return r.json();
};

export const getRosbridgeUrl = (jetsonHost, jetsonPort = '9090') => {
  if (isLocal) return `ws://${window.location.hostname}:${jetsonPort}`;
  return `ws://${jetsonHost}:${jetsonPort}`;
};
