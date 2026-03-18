import { useState, useEffect, useRef } from 'react';
import { CalibrationPanel } from './CalibrationPanel';

const useSshSession = (id, jetsonHost, command) => {
  const [status, setStatus] = useState('idle');
  const [output, setOutput] = useState('');

  // Check if session or process is already running on mount
  useEffect(() => {
    (async () => {
      try {
        // First check bridge session
        const res = await fetch('http://localhost:4500/ssh/output', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, since: 0 }),
        });
        const data = await res.json();
        if (data.ok && !data.done) { setStatus('running'); return; }

        // Fallback: check if process is alive on Jetson
        const procName = command.split('&&').pop().trim().split(/\s+/).slice(0, 2).join(' ');
        const chk = await fetch('http://localhost:4500/ssh/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'hec', password: 'h3ll0', command: `ps aux | grep "${procName}" | grep -v grep | grep -v pgrep | grep -v pkill > /dev/null 2>&1 && echo ALIVE || echo DEAD` }),
        });
        const chkData = await chk.json();
        if (chkData.ok && chkData.output.trim() === 'ALIVE') setStatus('running');
      } catch {}
    })();
  }, [id, jetsonHost, command]);

  const launch = async () => {
    setStatus('launching'); setOutput('');
    try {
      const res = await fetch('http://localhost:4500/ssh/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, host: jetsonHost, user: 'hec', password: 'h3ll0', command }),
      });
      const data = await res.json();
      setStatus(data.ok ? 'running' : 'error');
      setOutput(data.message || data.error || '');
    } catch (e) { setStatus('error'); setOutput(`Cannot reach SSH bridge: ${e.message}`); }
  };
  const stop = async () => {
    try {
      await fetch('http://localhost:4500/ssh/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, host: jetsonHost, user: 'hec', password: 'h3ll0', command }) });
      setStatus('idle'); setOutput('Stopped');
    } catch (e) { setOutput(`Stop failed: ${e.message}`); }
  };
  return { status, output, launch, stop };
};

const StepBadge = ({ num, done, active }) => (
  <div style={{
    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0,
    background: done ? '#00d26a22' : active ? '#6c5ce722' : '#1a1a24',
    border: `2px solid ${done ? '#00d26a' : active ? '#6c5ce7' : '#333'}`,
    color: done ? '#00d26a' : active ? '#6c5ce7' : '#555',
  }}>
    {done ? '✓' : num}
  </div>
);

const StepLine = ({ done }) => (
  <div style={{ width: 2, height: 20, margin: '4px 0 4px 13px', background: done ? '#00d26a44' : '#1e1e2a' }} />
);

export const JetsonSetup = ({ jetsonHost, connected }) => {
  const [activeProfile, setActiveProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [confirmStop, setConfirmStop] = useState(null); // 'rosbridge' | 'v4l2' | null

  const rosbridge = useSshSession('rosbridge', jetsonHost, 'source /opt/ros/humble/setup.bash && ros2 launch rosbridge_server rosbridge_websocket_launch.xml');
  const camNode = useSshSession('v4l2', jetsonHost, 'source /opt/ros/humble/setup.bash && python3 /home/hec/camera_undistort_node.py');

  useEffect(() => {
    if (!connected) return;
    (async () => {
      try {
        const r = await fetch('http://localhost:4500/ssh/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'hec', password: 'h3ll0', command: 'source /opt/ros/humble/setup.bash && python3 /home/hec/calibrate_headless.py --list-profiles' }),
        });
        const d = await r.json();
        if (d.ok) {
          for (const l of d.output.split('\n').filter(Boolean)) {
            try {
              const p = JSON.parse(l);
              if (p.stage === 'profiles') {
                const act = (p.profiles || []).find(pr => pr.cam0_active && pr.cam1_active);
                if (act) { setActiveProfile(act.name); setProfileReady(true); }
                break;
              }
            } catch {}
          }
        }
      } catch {}
    })();
  }, [connected, jetsonHost]);

  const step1Done = rosbridge.status === 'running';
  const step2Done = connected;
  const step3Done = profileReady;
  const step4Done = camNode.status === 'running';
  const colors = { idle: '#555', launching: '#ffa502', running: '#00d26a', error: '#ff4757' };

  return (
    <div style={st.container}>
      <div style={st.panel}>
        <div style={st.panelTitle}>Setup</div>

        {/* Step 1 */}
        <div style={st.stepRow}>
          <StepBadge num={1} done={step1Done} active={!step1Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Launch rosbridge_websocket</div>
            <div style={st.stepDesc}>WebSocket bridge on Jetson (port 9090)</div>
            <div style={st.stepActions}>
              <span style={{ fontSize: 10, color: colors[rosbridge.status], fontWeight: 700 }}>● {rosbridge.status.toUpperCase()}</span>
              <button style={st.btnGreen} onClick={rosbridge.launch} disabled={rosbridge.status === 'launching' || step1Done}>▶ Start</button>
              <button style={st.btnRed} onClick={() => setConfirmStop('rosbridge')} disabled={rosbridge.status === 'idle'}>⏹ Stop</button>
              {rosbridge.output && rosbridge.status === 'error' && <span style={st.errInline}>{rosbridge.output}</span>}
            </div>
          </div>
        </div>
        <StepLine done={step1Done} />

        {/* Step 2 */}
        <div style={st.stepRow}>
          <StepBadge num={2} done={step2Done} active={step1Done && !step2Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Connect to Jetson</div>
            <div style={st.stepDesc}>
              {step2Done ? <span style={{ color: '#00d26a' }}>Connected to ws://{jetsonHost}:9090</span>
                : step1Done ? <span style={{ color: '#ffa502' }}>Connecting...</span>
                : 'Waiting for rosbridge'}
            </div>
          </div>
        </div>
        <StepLine done={step2Done} />

        {/* Step 3 */}
        <div style={st.stepRow}>
          <StepBadge num={3} done={step3Done} active={step2Done && !step3Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Select intrinsics profile</div>
            <div style={st.stepDesc}>
              {step3Done ? <span style={{ color: '#00d26a' }}>Profile: {activeProfile}</span>
                : step2Done ? 'Select a calibration profile below'
                : <span style={{ color: '#555' }}>Waiting for connection</span>}
            </div>
          </div>
        </div>
        <StepLine done={step3Done} />

        {/* Step 4 */}
        <div style={st.stepRow}>
          <StepBadge num={4} done={step4Done} active={step3Done && !step4Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Launch camera_undistort_node</div>
            <div style={st.stepDesc}>Raw + undistorted compressed images</div>
            <div style={st.stepActions}>
              <span style={{ fontSize: 10, color: colors[camNode.status], fontWeight: 700 }}>● {camNode.status.toUpperCase()}</span>
              <button style={st.btnGreen} onClick={camNode.launch} disabled={!step3Done || camNode.status === 'launching' || step4Done}>▶ Start</button>
              <button style={st.btnRed} onClick={camNode.stop} disabled={camNode.status === 'idle'}>⏹ Stop</button>
              {camNode.output && camNode.status === 'error' && <span style={st.errInline}>{camNode.output}</span>}
            </div>
          </div>
        </div>
      </div>

      {step2Done && !step4Done && <CalibrationPanel jetsonHost={jetsonHost} onProfileActivated={(name) => { setActiveProfile(name); setProfileReady(true); }} />}

      {/* Confirmation popup */}
      {confirmStop && (
        <div style={st.overlay}>
          <div style={st.modal}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e6', marginBottom: 8 }}>⚠ Stop {confirmStop}?</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              {confirmStop === 'rosbridge'
                ? 'This will disconnect all ROS2 communication. Recording and camera nodes will lose their bridge.'
                : 'This will stop the camera node.'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={st.btnCancel} onClick={() => setConfirmStop(null)}>Cancel</button>
              <button style={st.btnConfirmStop} onClick={() => {
                if (confirmStop === 'rosbridge') rosbridge.stop();
                else camNode.stop();
                setConfirmStop(null);
              }}>Stop</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const st = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },
  panel: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 20 },
  panelTitle: { fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#e0e0e6' },
  stepRow: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  stepContent: { flex: 1, minWidth: 0 },
  stepLabel: { fontSize: 13, fontWeight: 700, color: '#e0e0e6', marginBottom: 2 },
  stepDesc: { fontSize: 11, color: '#666', marginBottom: 8 },
  stepActions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btnGreen: { padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#00d26a15', border: '1px solid #00d26a44', color: '#00d26a' },
  btnRed: { padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
  errInline: { fontSize: 10, color: '#ff4757', fontFamily: 'monospace' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#111118', border: '1px solid #2a2a3a', borderRadius: 12, padding: 20, maxWidth: 360, width: '100%' },
  btnCancel: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888' },
  btnConfirmStop: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
};
