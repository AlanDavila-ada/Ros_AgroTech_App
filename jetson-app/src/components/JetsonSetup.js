import { useState, useEffect, useRef } from 'react';
import { CalibrationPanel } from './CalibrationPanel';
import { apiServicesStatus, apiServicesRestart } from '../api';

const SERVICES = [
  { name: 'agrotech-rosbridge', label: 'Rosbridge WebSocket', desc: 'Bridge on port 9090 — required for the UI to talk to ROS' },
  { name: 'agrotech-camera',    label: 'Camera Node',         desc: 'Dual IMX477 → /jetson/cam{0,1}/image_raw and /recording/{command,status}' },
  { name: 'agrotech-imu',       label: 'BNO080 IMU',          desc: 'Publishes /imu/data (accel, gyro, orientation)' },
];

const fmtUptime = (s) => {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

const dotColor = (active) => active === 'active' ? '#00d26a' : active === 'activating' ? '#ffa502' : '#ff4757';

export const JetsonSetup = ({ jetsonHost, connected, domainId }) => {
  const [statuses, setStatuses] = useState([]);
  const [busy, setBusy] = useState({}); // { name: 'restart' | 'start' | 'stop' }
  const [err, setErr] = useState({});
  const pollRef = useRef(null);

  const refresh = async () => {
    try {
      const r = await apiServicesStatus(jetsonHost);
      if (r.ok) setStatuses(r.services);
    } catch {}
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 5000);
    return () => clearInterval(pollRef.current);
  }, [jetsonHost]);

  const act = async (name, action) => {
    setBusy((b) => ({ ...b, [name]: action }));
    setErr((e) => ({ ...e, [name]: '' }));
    try {
      const r = await apiServicesRestart(name, action, jetsonHost);
      if (!r.ok) setErr((e) => ({ ...e, [name]: r.error || 'failed' }));
      await new Promise((res) => setTimeout(res, 1500));
      await refresh();
    } catch (e) { setErr((er) => ({ ...er, [name]: e.message })); }
    finally { setBusy((b) => { const { [name]: _, ...rest } = b; return rest; }); }
  };

  const byName = Object.fromEntries(statuses.map((s) => [s.name, s]));
  const allActive = SERVICES.every((s) => byName[s.name]?.active === 'active');

  return (
    <div style={st.container}>
      <div style={st.panel}>
        <div style={st.headerRow}>
          <div>
            <div style={st.panelTitle}>Services</div>
            <div style={st.panelSub}>
              Managed by systemd — start automatically on boot. Use this panel to verify health or restart after a config change.
            </div>
          </div>
          <div style={st.allBadge(allActive)}>
            <span style={{ ...st.dot, background: dotColor(allActive ? 'active' : 'inactive') }} />
            {allActive ? 'All running' : 'Issues'}
          </div>
        </div>

        {SERVICES.map((svc) => {
          const s = byName[svc.name] || { active: 'unknown', enabled: 'unknown', uptime: null };
          const isBusy = !!busy[svc.name];
          return (
            <div key={svc.name} style={st.row}>
              <span style={{ ...st.dot, background: dotColor(s.active), boxShadow: s.active === 'active' ? `0 0 6px ${dotColor(s.active)}88` : 'none' }} />
              <div style={st.rowMeta}>
                <div style={st.rowLabel}>{svc.label}</div>
                <div style={st.rowDesc}>{svc.desc}</div>
                <div style={st.rowStatus}>
                  <span style={{ color: dotColor(s.active), fontWeight: 700 }}>● {String(s.active).toUpperCase()}</span>
                  <span style={st.muted}>· enabled: {s.enabled}</span>
                  <span style={st.muted}>· uptime: {fmtUptime(s.uptime)}</span>
                </div>
                {err[svc.name] && <div style={st.errInline}>{err[svc.name]}</div>}
              </div>
              <div style={st.rowActions}>
                <button style={st.btn} onClick={() => act(svc.name, 'restart')} disabled={isBusy}>
                  {busy[svc.name] === 'restart' ? '⏳' : '↻'} Restart
                </button>
                {s.active === 'active'
                  ? <button style={st.btnRed} onClick={() => act(svc.name, 'stop')} disabled={isBusy}>
                      {busy[svc.name] === 'stop' ? '⏳' : '⏹'} Stop
                    </button>
                  : <button style={st.btnGreen} onClick={() => act(svc.name, 'start')} disabled={isBusy}>
                      {busy[svc.name] === 'start' ? '⏳' : '▶'} Start
                    </button>}
              </div>
            </div>
          );
        })}

        {!connected && byName['agrotech-rosbridge']?.active === 'active' && (
          <div style={st.warn}>
            Rosbridge is running on the Jetson but the browser hasn't connected yet — check the URL in the sidebar (ws://{jetsonHost}:9090).
          </div>
        )}
        {byName['agrotech-rosbridge']?.active !== 'active' && (
          <div style={st.warn}>
            Rosbridge isn't active. Restart it above; without it the recording controls cannot reach the camera.
          </div>
        )}
        <div style={st.hint}>
          Restart needs passwordless sudo for the <code>ada</code> user. If you see a sudo error, run on the Jetson:
          <pre style={st.code}>echo 'ada ALL=(ALL) NOPASSWD: /bin/systemctl restart agrotech-*, /bin/systemctl start agrotech-*, /bin/systemctl stop agrotech-*' | sudo tee /etc/sudoers.d/agrotech</pre>
        </div>
      </div>

      <CalibrationPanel jetsonHost={jetsonHost} onProfileActivated={() => {}} domainId={domainId} />
    </div>
  );
};

const st = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },
  panel: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 20 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 },
  panelTitle: { fontSize: 15, fontWeight: 700, color: '#e0e0e6', marginBottom: 4 },
  panelSub: { fontSize: 11, color: '#666', maxWidth: 480 },
  allBadge: (ok) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8,
    background: ok ? '#00d26a12' : '#ff475712',
    border: `1px solid ${ok ? '#00d26a44' : '#ff475744'}`,
    color: ok ? '#00d26a' : '#ff4757', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
  }),
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
    borderTop: '1px solid #1e1e2a',
  },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 6 },
  rowMeta: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 13, fontWeight: 700, color: '#e0e0e6' },
  rowDesc: { fontSize: 11, color: '#666', marginTop: 2 },
  rowStatus: { fontSize: 10, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' },
  muted: { color: '#555' },
  errInline: { fontSize: 10, color: '#ff4757', fontFamily: 'monospace', marginTop: 4 },
  rowActions: { display: 'flex', gap: 6, flexShrink: 0 },
  btn: { padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#6c5ce715', border: '1px solid #6c5ce744', color: '#6c5ce7' },
  btnGreen: { padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#00d26a15', border: '1px solid #00d26a44', color: '#00d26a' },
  btnRed: { padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
  warn: { marginTop: 12, padding: '8px 12px', background: '#ff9f4312', border: '1px solid #ff9f4333', borderRadius: 8, color: '#ff9f43', fontSize: 11 },
  hint: { marginTop: 16, padding: 12, background: '#0d0d14', borderRadius: 8, fontSize: 10, color: '#666' },
  code: { background: '#000', color: '#aaa', padding: 8, borderRadius: 6, marginTop: 6, overflow: 'auto', fontSize: 10 },
};
