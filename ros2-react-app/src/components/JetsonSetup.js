import { useState, useEffect, useRef } from 'react';
import { CalibrationPanel } from './CalibrationPanel';
import { rosEnv } from '../rosEnv';

const useSshSession = (id, jetsonHost, command) => {
  const [status, setStatus] = useState('checking');
  const [output, setOutput] = useState('');

  // Check if tmux session already exists on mount
  useEffect(() => {
    setStatus('checking');
    (async () => {
      try {
        const chk = await fetch('http://localhost:4500/ssh/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'ada', password: 'ada123', command: `tmux has-session -t ${id} 2>/dev/null && echo ALIVE || echo DEAD` }),
        });
        const data = await chk.json();
        setStatus(data.ok && data.output.trim() === 'ALIVE' ? 'running' : 'idle');
      } catch { setStatus('idle'); }
    })();
  }, [id, jetsonHost]);

  const launch = async () => {
    setStatus('launching'); setOutput('');
    try {
      const res = await fetch('http://localhost:4500/ssh/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, host: jetsonHost, user: 'ada', password: 'ada123', command }),
      });
      const data = await res.json();
      setStatus(data.ok ? 'running' : 'error');
      setOutput(data.message || data.error || '');
    } catch (e) { setStatus('error'); setOutput(`Cannot reach SSH bridge: ${e.message}`); }
  };
  const stop = async () => {
    setStatus('stopping');
    try {
      await fetch('http://localhost:4500/ssh/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, host: jetsonHost, user: 'ada', password: 'ada123', command }) });
      setStatus('idle'); setOutput('Stopped');
    } catch (e) { setStatus('error'); setOutput(`Stop failed: ${e.message}`); }
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

export const JetsonSetup = ({ jetsonHost, connected, domainId }) => {
  const [activeProfile, setActiveProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [confirmStop, setConfirmStop] = useState(null); // 'rosbridge' | 'v4l2' | null
  const [undistort, setUndistort] = useState(true);

  const rosbridge = useSshSession('rosbridge', jetsonHost, `${rosEnv(domainId)} && ros2 launch rosbridge_server rosbridge_websocket_launch.xml`);
  const camCmd = `${rosEnv(domainId)} && python3 /home/ada/camera_node.py${undistort ? '' : ' --no-undistort'}`;
  const camNode = useSshSession('v4l2', jetsonHost, camCmd);
  const imuNode = useSshSession('bno080', jetsonHost, `${rosEnv(domainId)} && source ~/ros2_ws/install/setup.bash && ros2 run bno080_imu bno080_node`);

  const [profileChecking, setProfileChecking] = useState(true);

  useEffect(() => {
    setProfileChecking(true);
    (async () => {
      try {
        const r = await fetch('http://localhost:4500/ssh/exec', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'ada', password: 'ada123', command: `${rosEnv(domainId)} && python3 /home/ada/calibrate_headless.py --list-profiles` }),
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
      setProfileChecking(false);
    })();
  }, [jetsonHost]);

  const step1Done = rosbridge.status === 'running';
  const step2Done = connected;
  const step3Done = profileReady;
  const step4Done = camNode.status === 'running';
  const step5Done = imuNode.status === 'running';
  const colors = { idle: '#555', checking: '#6c5ce7', launching: '#ffa502', running: '#00d26a', error: '#ff4757', stopping: '#ffa502' };

  const anyChecking = rosbridge.status === 'checking' || camNode.status === 'checking' || imuNode.status === 'checking';

  const allRunning = step1Done && step4Done && step5Done;
  const anyLaunching = rosbridge.status === 'launching' || camNode.status === 'launching' || imuNode.status === 'launching';
  const canLaunchAll = step3Done && !allRunning && !anyLaunching;

  const launchAll = async () => {
    if (!step1Done) await rosbridge.launch();
    await new Promise(r => setTimeout(r, 2000));
    const promises = [];
    if (!step4Done) promises.push(camNode.launch());
    if (!step5Done) promises.push(imuNode.launch());
    await Promise.all(promises);
  };

  const stopAll = async () => {
    await Promise.all([camNode.stop(), imuNode.stop()]);
    await rosbridge.stop();
  };

  return (
    <div style={st.container}>
      <div style={st.panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={st.panelTitle}>Setup</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!step3Done && <span style={{ fontSize: 10, color: '#ffa502' }}>Select profile first</span>}
            <button style={canLaunchAll ? st.btnLaunchAll : st.btnLaunchAllDisabled} onClick={launchAll} disabled={!canLaunchAll}>
              🚀 {anyLaunching ? 'Launching...' : 'Launch All'}
            </button>
            <button style={st.btnRed(!step1Done && !step4Done && !step5Done)} onClick={stopAll} disabled={!step1Done && !step4Done && !step5Done}>
              ⏹ Stop All
            </button>
          </div>
        </div>

        {/* Step 1 */}
        <div style={st.stepRow}>
          <StepBadge num={1} done={step1Done} active={!step1Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Launch rosbridge_websocket</div>
            <div style={st.stepDesc}>
              {rosbridge.status === 'checking' ? <span style={st.checkingText}>⏳ Checking...</span>
                : 'WebSocket bridge on Jetson (port 9090)'}
            </div>
            <div style={st.stepActions}>
              <span style={{ fontSize: 10, color: colors[rosbridge.status], fontWeight: 700 }}>● {rosbridge.status.toUpperCase()}</span>
              <button style={st.btnGreen(rosbridge.status === 'launching' || step1Done)} onClick={rosbridge.launch} disabled={rosbridge.status === 'launching' || step1Done}>{rosbridge.status === 'launching' ? '⏳ Starting...' : '▶ Start'}</button>
              <button style={st.btnRed(rosbridge.status === 'idle' || rosbridge.status === 'stopping')} onClick={() => setConfirmStop('rosbridge')} disabled={rosbridge.status === 'idle' || rosbridge.status === 'stopping'}>{rosbridge.status === 'stopping' ? '⏳ Stopping...' : '⏹ Stop'}</button>
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
              {profileChecking ? <span style={st.checkingText}>⏳ Loading profiles...</span>
                : step3Done ? <span style={{ color: '#00d26a' }}>Profile: {activeProfile}</span>
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
            <div style={st.stepLabel}>Launch camera_node</div>
            <div style={st.stepDesc}>
              {camNode.status === 'checking' ? <span style={st.checkingText}>⏳ Checking...</span>
                : 'Direct MCAP recording + ROS2 preview'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <button
                style={undistort ? st.toggleOn : st.toggleOff}
                onClick={() => { if (camNode.status !== 'running') setUndistort(!undistort); }}
                disabled={camNode.status === 'running'}
              >
                {undistort ? '✓ Undistort ON' : '✗ Undistort OFF'}
              </button>
              <span style={{ fontSize: 10, color: '#555' }}>
                {undistort ? '~8 fps @ 1920×1080 (2 cams)' : '~21 fps @ 1920×1080 (2 cams)'}
              </span>
            </div>
            <div style={st.stepActions}>
              <span style={{ fontSize: 10, color: colors[camNode.status], fontWeight: 700 }}>● {camNode.status.toUpperCase()}</span>
              <button style={st.btnGreen(!step3Done || camNode.status === 'launching' || step4Done)} onClick={camNode.launch} disabled={!step3Done || camNode.status === 'launching' || step4Done}>{camNode.status === 'launching' ? '⏳ Starting...' : '▶ Start'}</button>
              <button style={st.btnRed(camNode.status === 'idle' || camNode.status === 'stopping')} onClick={camNode.stop} disabled={camNode.status === 'idle' || camNode.status === 'stopping'}>{camNode.status === 'stopping' ? '⏳ Stopping...' : '⏹ Stop'}</button>
              {camNode.output && camNode.status === 'error' && <span style={st.errInline}>{camNode.output}</span>}
            </div>
          </div>
        </div>
        <StepLine done={step4Done} />

        {/* Step 5 */}
        <div style={st.stepRow}>
          <StepBadge num={5} done={step5Done} active={step1Done && !step5Done} />
          <div style={st.stepContent}>
            <div style={st.stepLabel}>Launch BNO080 IMU node</div>
            <div style={st.stepDesc}>
              {imuNode.status === 'checking' ? <span style={st.checkingText}>⏳ Checking...</span>
                : 'Publishes /imu/data (accel, gyro, orientation)'}
            </div>
            <div style={st.stepActions}>
              <span style={{ fontSize: 10, color: colors[imuNode.status], fontWeight: 700 }}>● {imuNode.status.toUpperCase()}</span>
              <button style={st.btnGreen(!step1Done || imuNode.status === 'launching' || step5Done)} onClick={imuNode.launch} disabled={!step1Done || imuNode.status === 'launching' || step5Done}>{imuNode.status === 'launching' ? '⏳ Starting...' : '▶ Start'}</button>
              <button style={st.btnRed(imuNode.status === 'idle' || imuNode.status === 'stopping')} onClick={() => setConfirmStop('bno080')} disabled={imuNode.status === 'idle' || imuNode.status === 'stopping'}>{imuNode.status === 'stopping' ? '⏳ Stopping...' : '⏹ Stop'}</button>
              {imuNode.output && imuNode.status === 'error' && <span style={st.errInline}>{imuNode.output}</span>}
            </div>
          </div>
        </div>
      </div>

      {!step4Done && <CalibrationPanel jetsonHost={jetsonHost} onProfileActivated={(name) => { setActiveProfile(name); setProfileReady(true); }} domainId={domainId} />}

      {/* Confirmation popup */}
      {confirmStop && (
        <div style={st.overlay}>
          <div style={st.modal}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e0e0e6', marginBottom: 8 }}>⚠ Stop {confirmStop}?</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              {confirmStop === 'rosbridge'
                ? 'This will disconnect all ROS2 communication. Recording and camera nodes will lose their bridge.'
                : confirmStop === 'bno080'
                ? 'This will stop the IMU node. IMU data will no longer be published.'
                : 'This will stop the camera node.'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={st.btnCancel} onClick={() => setConfirmStop(null)}>Cancel</button>
              <button style={st.btnConfirmStop} onClick={() => {
                if (confirmStop === 'rosbridge') rosbridge.stop();
                else if (confirmStop === 'bno080') imuNode.stop();
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
  checkingBanner: { padding: '10px 14px', background: '#6c5ce710', border: '1px solid #6c5ce733', borderRadius: 8, color: '#6c5ce7', fontSize: 12, fontWeight: 600, marginBottom: 12, textAlign: 'center' },
  checkingText: { color: '#6c5ce7', fontWeight: 600 },
  btnGreen: (disabled) => ({ padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#1a1a24' : '#00d26a15', border: `1px solid ${disabled ? '#2a2a3a' : '#00d26a44'}`, color: disabled ? '#444' : '#00d26a', opacity: disabled ? 0.6 : 1, transition: 'all 0.15s' }),
  btnRed: (disabled) => ({ padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#1a1a24' : '#ff475715', border: `1px solid ${disabled ? '#2a2a3a' : '#ff475744'}`, color: disabled ? '#444' : '#ff4757', opacity: disabled ? 0.6 : 1, transition: 'all 0.15s' }),
  btnLaunchAll: { padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#6c5ce715', border: '1px solid #6c5ce744', color: '#6c5ce7' },
  btnLaunchAllDisabled: { padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'not-allowed', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#444', opacity: 0.6 },
  errInline: { fontSize: 10, color: '#ff4757', fontFamily: 'monospace' },
  toggleOn: { padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#00d26a18', border: '1px solid #00d26a44', color: '#00d26a' },
  toggleOff: { padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff9f4312', border: '1px solid #ff9f4333', color: '#ff9f43' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#111118', border: '1px solid #2a2a3a', borderRadius: 12, padding: 20, maxWidth: 360, width: '100%' },
  btnCancel: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888' },
  btnConfirmStop: { padding: '6px 16px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
};
