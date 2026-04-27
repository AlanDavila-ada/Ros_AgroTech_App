import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';
import { apiExec, apiLaunch, apiStop, apiOutput, apiPreflight, apiMcapInfo, rosEnv } from '../api';
import { logEvent } from '../hooks/useEventLogger';
const STORAGE_KEY = 'agrotech_jetson_rec_topics';
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;
const START_ACK_TIMEOUT_MS = 8000;
const newUuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const TOPIC_SECTIONS = [
  { id: 'local', label: '📡 Local Sensors', topics: [
    { key: 'imu_data', topic: '/imu/data', type: 'sensor_msgs/Imu', enabled: true },
  ]},
  { id: 'agv_real', label: '🤖 AGV Real', topics: [
    { key: 'agv_odom', topic: '/agv/odom', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'agv_odometry_global', topic: '/agv/odometry/global', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'agv_odometry_local', topic: '/agv/odometry/local', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'agv_wheel_odom', topic: '/agv/wheel_odom', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'agv_zed_odom', topic: '/agv/zed/odom', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'agv_zed_path_odom', topic: '/agv/zed/path_odom', type: 'nav_msgs/Path', enabled: true },
    { key: 'agv_zed_pose', topic: '/agv/zed/pose', type: 'geometry_msgs/PoseStamped', enabled: true },
    { key: 'agv_pose', topic: '/agv/pose', type: 'geometry_msgs/PoseWithCovarianceStamped', enabled: true },
    { key: 'agv_imu_filtered', topic: '/agv/imu/filtered', type: 'sensor_msgs/Imu', enabled: true },
    { key: 'agv_scan', topic: '/agv/scan', type: 'sensor_msgs/LaserScan', enabled: true },
  ]},
  { id: 'slam', label: '🗺 SLAM', topics: [
    { key: 'visual_slam_odom', topic: '/visual_slam/tracking/odometry', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'visual_slam_slam_odom', topic: '/visual_slam/vis/slam_odometry', type: 'nav_msgs/Odometry', enabled: true },
    { key: 'visual_slam_path', topic: '/visual_slam/tracking/slam_path', type: 'nav_msgs/Path', enabled: true },
    { key: 'visual_slam_vo_path', topic: '/visual_slam/tracking/vo_path', type: 'nav_msgs/Path', enabled: true },
    { key: 'visual_slam_vo_pose', topic: '/visual_slam/tracking/vo_pose', type: 'geometry_msgs/PoseStamped', enabled: true },
    { key: 'slam_quality', topic: '/slam/quality', type: 'std_msgs/String', enabled: true },
  ]},
  { id: 'tf', label: '🔗 TF', topics: [
    { key: 'tf', topic: '/tf', type: 'tf2_msgs/TFMessage', enabled: true },
    { key: 'tf_static', topic: '/tf_static', type: 'tf2_msgs/TFMessage', enabled: true },
    { key: 'clock', topic: '/clock', type: 'rosgraph_msgs/Clock', enabled: false },
  ]},
  { id: 'sim', label: '🎮 Simulation', topics: [
    { key: 'sim_gt_pose', topic: '/agv/sim/ground_truth/pose', type: 'geometry_msgs/PoseStamped', enabled: true },
    { key: 'sim_gt_obstacles', topic: '/agv/sim/ground_truth/obstacles', type: 'std_msgs/String', enabled: false },
    { key: 'sim_loc_error', topic: '/agv/sim/localization_error', type: 'std_msgs/String', enabled: true },
    { key: 'sim_events', topic: '/agv/sim/events', type: 'std_msgs/String', enabled: true },
    { key: 'sim_episode', topic: '/agv/sim/episode_summary', type: 'std_msgs/String', enabled: false },
    { key: 'agv_imu_data', topic: '/agv/imu/data', type: 'sensor_msgs/Imu', enabled: true },
    { key: 'agv_imu_clean', topic: '/agv/imu/data_clean', type: 'sensor_msgs/Imu', enabled: true },
    { key: 'agv_joint_states', topic: '/agv/joint_states', type: 'sensor_msgs/JointState', enabled: true },
    { key: 'agv_cmd_vel', topic: '/agv/cmd_vel', type: 'geometry_msgs/Twist', enabled: false },
  ]},
];

const ALL_DEFAULT_TOPICS = TOPIC_SECTIONS.flatMap(s => s.topics.map(t => ({ ...t, section: s.id })));

const loadTopics = () => {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (r) {
      const saved = JSON.parse(r);
      const savedKeys = new Set(saved.map(t => t.key));
      const missing = ALL_DEFAULT_TOPICS.filter(d => !savedKeys.has(d.key));
      return missing.length ? [...saved, ...missing] : saved;
    }
  } catch {}
  return null;
};
const saveTopics = (t) => localStorage.setItem(STORAGE_KEY, JSON.stringify(t));

export const JetsonRecording = ({ jetsonHost, connected, ros, domainId, rec, identity }) => {
  const [topics, setTopics] = useState(() => loadTopics() || ALL_DEFAULT_TOPICS);
  const [recordVideo, setRecordVideo] = useState(true);
  const [patrolId, setPatrolId] = useState(() => newUuid());
  const [recordingId, setRecordingId] = useState(() => newUuid());
  // Customer/device IDs are owned by App.js (fetched once from env via /api/config).
  const companyId = identity?.customerId || '';
  const deviceId = identity?.deviceId || '';
  const [comment, setComment] = useState('');
  // recording is now sourced from the global hook (rec.active) — survives tab switches and page reloads.
  const recording = !!rec?.active;
  const [topicsExpanded, setTopicsExpanded] = useState(false);
  const [sensorFrames, setSensorFrames] = useState(0);
  const [error, setError] = useState('');
  const [overwriteWarn, setOverwriteWarn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [preflight, setPreflight] = useState(null); // { checks: {...} } | null
  const [staleSession, setStaleSession] = useState(null); // { uptime, lastLine } | null
  const [stopReport, setStopReport] = useState(null); // { ok, info, sizeBytes } | null
  const [adding, setAdding] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newType, setNewType] = useState('std_msgs/String');
  const [availableTopics, setAvailableTopics] = useState([]);
  const [topicActivity, setTopicActivity] = useState({}); // { topic: 'publishing' | 'idle' | 'none' }
  const activityRef = useRef({});
  const pubCountRef = useRef({}); // { topic: number }
  const pollRef = useRef(null);
  const offsetRef = useRef(0);

  // /recording/status is owned by the global hook (rec) — derived camStatus comes from rec.status.
  const camStatus = rec?.status || null;


  // Check publisher counts periodically via SSH
  useEffect(() => {
    if (!ros || !connected) return;
    const enabled = topics.filter(t => t.enabled);
    const checkPubs = async () => {
      try {
        const topicList = enabled.map(t => t.topic).join(' ');
        const d = await apiExec(`source /opt/ros/humble/setup.bash && export ROS_DOMAIN_ID=${domainId} && for t in ${topicList}; do echo "$t $(ros2 topic info $t 2>/dev/null | grep -oP 'Publisher count: \\K[0-9]+' || echo 0)"; done`, jetsonHost);
        if (d.ok && d.output) {
          const counts = {};
          d.output.trim().split('\n').forEach(line => {
            const parts = line.trim().split(' ');
            if (parts.length >= 2) counts[parts[0]] = parseInt(parts[1]) || 0;
          });
          pubCountRef.current = counts;
        }
      } catch {}
    };
    checkPubs();
    const iv = setInterval(checkPubs, 10000);
    return () => clearInterval(iv);
  }, [ros, connected, jetsonHost, domainId, topics.filter(t => t.enabled).map(t => t.key).join(',')]);

  // Monitor topic activity (message reception)
  useEffect(() => {
    if (!ros || !connected) return;
    const subs = [];
    const enabled = topics.filter(t => t.enabled);
    enabled.forEach(t => {
      const rosType = t.type.includes('/msg/') ? t.type : t.type.replace(/^([^/]+)\//, '$1/msg/');
      const sub = new ROSLIB.Topic({ ros, name: t.topic, messageType: rosType, throttle_rate: 2000 });
      sub.subscribe(() => {
        activityRef.current[t.topic] = Date.now();
      });
      subs.push(sub);
    });
    const iv = setInterval(() => {
      const now = Date.now();
      const activity = {};
      const enabled = topics.filter(t => t.enabled);
      enabled.forEach(t => {
        const lastMsg = activityRef.current[t.topic];
        const receiving = lastMsg && (now - lastMsg < 3000);
        const hasPub = (pubCountRef.current[t.topic] || 0) > 0;
        activity[t.topic] = receiving ? 'publishing' : hasPub ? 'idle' : 'none';
      });
      setTopicActivity(activity);
    }, 1000);
    return () => { subs.forEach(s => s.unsubscribe()); clearInterval(iv); };
  }, [ros, connected, topics.filter(t => t.enabled).map(t => t.key).join(',')]);

  // Fetch available ROS topics
  useEffect(() => {
    if (!connected) return;
    const r = new ROSLIB.Ros({ url: `ws://${jetsonHost}:9090` });
    r.on('connection', () => {
      r.getTopics((result) => {
        setAvailableTopics(result.topics.map((name, i) => ({ name, type: result.types[i] })));
        r.close();
      });
    });
    r.on('error', () => {});
    return () => { try { r.close(); } catch {} };
  }, [connected, jetsonHost]);

  const enabledSensorTopics = topics.filter(t => t.enabled);

  const toggleTopic = (key) => {
    const next = topics.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t);
    setTopics(next);
    saveTopics(next);
  };

  const removeTopic = (key) => {
    const next = topics.filter(t => t.key !== key);
    setTopics(next);
    saveTopics(next);
  };

  const addTopic = () => {
    if (!newTopic) return;
    const key = newTopic.replace(/\//g, '_').replace(/^_/, '');
    const type = availableTopics.find(t => t.name === newTopic)?.type || newType;
    const next = [...topics, { key, topic: newTopic, type, enabled: true }];
    setTopics(next);
    saveTopics(next);
    setNewTopic('');
    setAdding(false);
  };

  const publishRecordingCommand = (cmd) => {
    if (!ros) return;
    const topic = new ROSLIB.Topic({ ros, name: '/recording/command', messageType: 'std_msgs/String' });
    topic.publish(new ROSLIB.Message({ data: JSON.stringify(cmd) }));
  };

  // Wait until /recording/status reports recording (matching ids) or timeout.
  const waitForCameraAck = (state) => new Promise((resolve) => {
    const start = Date.now();
    const iv = setInterval(() => {
      // Read fresh status from the global hook (state of rec lives in App).
      const s = rec?.status;
      if (s && s.state === state) { clearInterval(iv); resolve(true); }
      else if (Date.now() - start > START_ACK_TIMEOUT_MS) { clearInterval(iv); resolve(false); }
    }, 150);
  });

  const launchSensorRecorder = async (ids, force) => {
    const topicsArg = enabledSensorTopics.map(t => `${t.topic}:${t.type}`).join(',');
    // Comment may contain spaces/punctuation — base64 it so we never have to escape shell quotes.
    const commentArg = comment ? ` --comment "$(echo ${btoa(unescape(encodeURIComponent(comment)))} | base64 -d)"` : '';
    const cmd = `${rosEnv(domainId)} && python3 /home/ada/mcap_recorder.py --company "${ids.company}" --device "${ids.device}" --patrol "${ids.patrol}" --recording "${ids.recording}" --topics "${topicsArg}"${commentArg}`;
    if (force) { try { await apiStop('mcap_recorder', jetsonHost, { force: true }); } catch {} }
    const r = await apiLaunch('mcap_recorder', cmd, jetsonHost);
    if (!r.ok && r.alive) { setStaleSession(r); return false; }
    return true;
  };

  const toggleRecording = async () => {
    if (recording) {
      // === STOP ===
      setStopReport(null);
      rec?.markPending?.('stop');
      logEvent('info', 'recording.stop.requested', { source: 'recording_tab' }, { host: jetsonHost });
      if (recordVideo) publishRecordingCommand({ action: 'stop' });
      if (enabledSensorTopics.length > 0) {
        try { await apiStop('mcap_recorder', jetsonHost); } catch {}
      }
      clearInterval(pollRef.current);
      // Poll for mcap finalization. mcap_recorder.py buffers in-memory and only
      // writes the file on finish(); camera_node.py needs a moment to flush metadata.
      // We poll every 600ms for up to 8s, accepting the first non-zero result.
      (async () => {
        const ids = { company: companyId, device: deviceId, patrol: patrolId, recording: recordingId };
        const filesToCheck = [];
        if (enabledSensorTopics.length > 0) filesToCheck.push('combined.mcap');
        if (recordVideo) filesToCheck.push('cameras.mcap');
        const deadline = Date.now() + 8000;
        let last = null;
        while (Date.now() < deadline) {
          let totalSize = 0; let anyExists = false; let lastInfo = '';
          for (const f of filesToCheck) {
            try {
              const r = await apiMcapInfo({ ...ids, file: f }, jetsonHost);
              if (r.ok) { totalSize += r.sizeBytes || 0; if (r.exists) anyExists = true; if (r.info) lastInfo = r.info; }
            } catch {}
          }
          last = { ok: anyExists && totalSize > 0, sizeBytes: totalSize, info: lastInfo };
          if (last.ok) break;
          await new Promise(res => setTimeout(res, 600));
        }
        if (last) {
          setStopReport(last);
          logEvent(last.ok ? 'info' : 'warn', last.ok ? 'recording.mcap.ok' : 'recording.mcap.empty_or_corrupt',
            { sizeBytes: last.sizeBytes }, { host: jetsonHost });
        }
      })();
      return;
    }

    // === START ===
    if (!patrolId.trim() || !recordingId.trim() || !companyId.trim() || !deviceId.trim()) {
      setError('Company, Device, Patrol and Recording IDs are required.');
      return;
    }
    for (const [label, v] of [['Company', companyId], ['Device', deviceId], ['Patrol', patrolId], ['Recording', recordingId]]) {
      if (!SAFE_ID.test(v)) { setError(`${label} ID must match [A-Za-z0-9_.-]+`); return; }
    }
    if (!recordVideo && enabledSensorTopics.length === 0) {
      setError('Enable video recording or select at least one sensor topic.');
      return;
    }
    setError('');
    setStopReport(null);
    logEvent('info', 'recording.start.requested', {
      patrol: patrolId, recording: recordingId, customer: companyId, device: deviceId,
      video: recordVideo, sensor_topics: enabledSensorTopics.length,
      comment: comment ? comment.slice(0, 200) : undefined,
    }, { host: jetsonHost });

    // Pre-flight (single round-trip).
    if (!preflight) {
      setChecking(true);
      try {
        const pf = await apiPreflight({ company: companyId, device: deviceId, patrol: patrolId, recording: recordingId }, jetsonHost);
        setChecking(false);
        if (!pf.ok) { setError(pf.error || 'Pre-flight failed'); return; }
        const c = pf.checks;
        const issues = [];
        if (!c.disk?.ok) issues.push(`Disk: ${c.disk?.availMB || 0} MB free (need ≥ 1024)`);
        if (!c.servicesOk) issues.push(`Services not all active: ${JSON.stringify(c.services)}`);
        if (c.staleRecorder.length > 0) issues.push(`Stale mcap_recorder process(es): ${c.staleRecorder.join(', ')}`);
        if (c.staleTmux) issues.push('Stale mcap_recorder tmux session');
        if (c.recordingExists) setOverwriteWarn(true);
        if (issues.length > 0 || c.disk?.warn) {
          setPreflight({ ...c, issues });
          logEvent('warn', 'recording.preflight.issues', { issues, disk: c.disk, services: c.services }, { host: jetsonHost });
          return;
        }
      } catch (e) {
        setChecking(false); setError(`Pre-flight failed: ${e.message}`);
        logEvent('error', 'recording.preflight.error', { error: e.message }, { host: jetsonHost });
        return;
      }
    }
    setPreflight(null);

    if (overwriteWarn) {
      // Operator already saw the warning — proceed.
      setOverwriteWarn(false);
    }
    setSensorFrames(0);
    offsetRef.current = 0;
    const ids = { company: companyId, device: deviceId, patrol: patrolId, recording: recordingId };

    // 1. Camera direct MCAP — fire-and-warn. The status topic is published on a 1s
    //    timer + over rosbridge, so ack latency can be up to ~1.5s normally and much
    //    longer under load. We don't want a missed ack to abort the sensor recorder
    //    (different process, independent file) so we just surface a warning.
    let cameraAcked = true;
    if (recordVideo) {
      rec?.markPending?.('start');
      publishRecordingCommand({ action: 'start', ...ids, comment });
      cameraAcked = await waitForCameraAck('recording');
      if (!cameraAcked) {
        logEvent('warn', 'recording.camera.ack_timeout', { timeout_ms: START_ACK_TIMEOUT_MS }, { host: jetsonHost });
      } else {
        logEvent('info', 'recording.camera.acked', {}, { host: jetsonHost });
      }
    }

    // 2. Sensor recorder — independent of camera ack. If it can't launch, *that's*
    //    the only reason we abort the camera too (since the user wanted both).
    if (enabledSensorTopics.length > 0) {
      const launched = await launchSensorRecorder(ids, false);
      if (!launched) {
        if (recordVideo) publishRecordingCommand({ action: 'stop' });
        rec?.markPending?.(null);
        logEvent('warn', 'recording.sensor.stale_session', { topics: enabledSensorTopics.length }, { host: jetsonHost });
        return;
      }
      logEvent('info', 'recording.sensor.launched', { topics: enabledSensorTopics.length }, { host: jetsonHost });
      pollRef.current = setInterval(async () => {
        try {
          const d = await apiOutput('mcap_recorder', offsetRef.current);
          if (d.lines) {
            offsetRef.current = d.offset;
            for (const l of d.lines.split('\n').filter(Boolean)) {
              try { const p = JSON.parse(l); if (p.counts) setSensorFrames(Object.values(p.counts).reduce((a, b) => a + b, 0)); } catch {}
            }
          }
        } catch {}
      }, 1000);
    }
    // If the camera didn't ack within the window, surface a soft warning. Recording
    // is still in progress (camera_node likely just had a slow status tick) — the
    // global REC bar will confirm when /recording/status arrives.
    if (recordVideo && !cameraAcked) {
      setError('Camera did not confirm start within 8s — check the live counters above. If frames stay at 0, stop and retry.');
    }
    // recording flips to true automatically via the global /recording/status subscription.
  };

  const adoptStaleSession = () => {
    setStaleSession(null);
    pollRef.current = setInterval(async () => {
      try {
        const d = await apiOutput('mcap_recorder', offsetRef.current);
        if (d.lines) {
          offsetRef.current = d.offset;
          for (const l of d.lines.split('\n').filter(Boolean)) {
            try { const p = JSON.parse(l); if (p.counts) setSensorFrames(Object.values(p.counts).reduce((a, b) => a + b, 0)); } catch {}
          }
        }
      } catch {}
    }, 1000);
  };

  const killStaleSession = async () => {
    try { await apiStop('mcap_recorder', jetsonHost, { force: true }); } catch {}
    setStaleSession(null);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const unusedTopics = availableTopics.filter(at => !topics.some(t => t.topic === at.name));

  const toggleSection = (sectionId, on) => {
    const sectionKeys = new Set(TOPIC_SECTIONS.find(s => s.id === sectionId)?.topics.map(t => t.key) || []);
    const next = topics.map(t => sectionKeys.has(t.key) ? { ...t, enabled: on } : t);
    setTopics(next);
    saveTopics(next);
  };

  const toggleAll = (on) => {
    const next = topics.map(t => ({ ...t, enabled: on }));
    setTopics(next);
    saveTopics(next);
  };
  const camFrames = camStatus?.state === 'recording' ? camStatus.total : 0;
  const camElapsed = camStatus?.state === 'recording' ? camStatus.elapsed : 0;

  return (
    <div style={st.container}>
      {/* Pre-flight gate modal */}
      {preflight && (
        <div style={st.modalOverlay}>
          <div style={st.modalCard}>
            <div style={st.modalTitle}>Pre-flight checks</div>
            <ul style={st.checkList}>
              <li style={st.checkItem(preflight.disk?.ok && !preflight.disk?.warn)}>
                Free disk: <b>{preflight.disk?.availMB} MB</b> {preflight.disk?.warn && '(low)'}
              </li>
              <li style={st.checkItem(preflight.servicesOk)}>
                Services: {Object.entries(preflight.services).map(([k, v]) =>
                  <span key={k} style={{ color: v === 'active' ? '#00d26a' : '#ff4757', marginRight: 8 }}>{k.replace('agrotech-', '')}:{v}</span>
                )}
              </li>
              <li style={st.checkItem(preflight.staleRecorder.length === 0)}>
                Stale recorder process: {preflight.staleRecorder.length === 0 ? 'none' : preflight.staleRecorder.join(', ')}
              </li>
              <li style={st.checkItem(!preflight.staleTmux)}>
                Stale tmux session: {preflight.staleTmux ? 'yes — will be force-killed' : 'no'}
              </li>
              {preflight.recordingExists && (
                <li style={st.checkItem(false)}>
                  Recording dir already exists at this ID — files will be overwritten.
                </li>
              )}
            </ul>
            {preflight.issues.length > 0 && (
              <div style={st.modalErr}>{preflight.issues.join(' · ')}</div>
            )}
            <div style={st.modalActions}>
              <button style={st.btnGhost} onClick={() => setPreflight(null)}>Cancel</button>
              <button
                style={st.btnPrimary}
                disabled={!preflight.disk?.ok || !preflight.servicesOk}
                onClick={() => { setPreflight(null); toggleRecording(); }}
              >
                {preflight.issues.length > 0 ? 'Force record anyway' : 'Start recording'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stale session adopt-or-kill modal */}
      {staleSession && (
        <div style={st.modalOverlay}>
          <div style={st.modalCard}>
            <div style={st.modalTitle}>Existing recorder session</div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>
              A previous mcap_recorder has been running for <b>{staleSession.uptime != null ? `${staleSession.uptime}s` : 'unknown time'}</b>.
            </div>
            {staleSession.lastLine && <pre style={st.lastLine}>{staleSession.lastLine}</pre>}
            <div style={st.modalActions}>
              <button style={st.btnGhost} onClick={() => setStaleSession(null)}>Dismiss</button>
              <button style={st.btnRed} onClick={killStaleSession}>Force kill</button>
              <button style={st.btnPrimary} onClick={adoptStaleSession}>Adopt</button>
            </div>
          </div>
        </div>
      )}

      {/* Stop report (mcap integrity) */}
      {stopReport && (
        <div style={stopReport.ok ? st.okBanner : st.warnBanner}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {stopReport.ok ? '✓ Recording closed' : '⚠ Recording may be empty or corrupt'}
          </div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            File size: {(stopReport.sizeBytes / 1e6).toFixed(1)} MB
          </div>
          <button style={st.dismissBtn} onClick={() => setStopReport(null)}>×</button>
        </div>
      )}

      {/* === LIVE PANEL (visible while recording) === */}
      {recording && (
        <div style={st.livePanel}>
          <div style={st.liveHeader}>
            <span style={st.liveDot} />
            <span style={st.liveTitle}>LIVE</span>
            <span style={st.liveTime}>{Math.floor(camElapsed / 60).toString().padStart(2, '0')}:{(Math.floor(camElapsed) % 60).toString().padStart(2, '0')}</span>
            <button onClick={toggleRecording} style={st.bigStopBtn}>⏹ Stop recording</button>
          </div>
          <div style={st.liveCounts}>
            {recordVideo && (
              <div style={st.countItem}>
                <span style={st.countLabel}>📷 Video</span>
                <span style={st.countValue}>{camFrames} frames</span>
              </div>
            )}
            {enabledSensorTopics.length > 0 && (
              <div style={st.countItem}>
                <span style={st.countLabel}>🤖 Sensors</span>
                <span style={st.countValue}>{sensorFrames} msgs</span>
              </div>
            )}
            <div style={st.countItem}>
              <span style={st.countLabel}>📦 Patrol</span>
              <span style={st.countValueId} title={patrolId}>{patrolId.slice(0, 8)}…</span>
            </div>
            <div style={st.countItem}>
              <span style={st.countLabel}>🎬 Recording</span>
              <span style={st.countValueId} title={recordingId}>{recordingId.slice(0, 8)}…</span>
            </div>
          </div>
        </div>
      )}

      {/* === ACTION ZONE — primary call to action === */}
      {!recording && (
        <div style={st.actionZone}>
          <div style={st.actionHeader}>
            <div>
              <div style={st.actionTitle}>Start a recording</div>
              <div style={st.actionSub}>Customer & device are pre-set. Patrol & recording IDs are auto-generated; edit or regenerate as needed.</div>
            </div>
            <button
              onClick={toggleRecording}
              style={st.bigRecordBtn(!connected || checking || !companyId || !deviceId)}
              disabled={!connected || checking || !companyId || !deviceId}
            >
              <span style={st.bigRecordDot} />
              {checking ? '⏳ Pre-flight…' : overwriteWarn ? '⚠ Overwrite?' : 'Start recording'}
            </button>
          </div>

          <div style={st.idChips}>
            <div style={st.chip}>
              <span style={st.chipLabel}>Customer</span>
              <span style={st.chipValue} title={companyId}>{companyId || '—'}</span>
            </div>
            <div style={st.chip}>
              <span style={st.chipLabel}>Device</span>
              <span style={st.chipValue} title={deviceId}>{deviceId || '—'}</span>
            </div>
          </div>

          <div style={{ ...st.recRow, marginTop: 8 }}>
            <div style={st.idField}>
              <label style={st.idFieldLabel}>Patrol ID</label>
              <input style={{ ...st.input, ...(error && !patrolId.trim() ? { borderColor: '#ff475766' } : {}) }}
                value={patrolId}
                onChange={e => { setPatrolId(e.target.value); setError(''); setOverwriteWarn(false); }} />
            </div>
            <button style={st.regenBtn} title="Regenerate" onClick={() => setPatrolId(newUuid())}>↻</button>
            <div style={st.idField}>
              <label style={st.idFieldLabel}>Recording ID</label>
              <input style={{ ...st.input, ...(error && !recordingId.trim() ? { borderColor: '#ff475766' } : {}) }}
                value={recordingId}
                onChange={e => { setRecordingId(e.target.value); setError(''); setOverwriteWarn(false); }} />
            </div>
            <button style={st.regenBtn} title="Regenerate" onClick={() => setRecordingId(newUuid())}>↻</button>
          </div>

          <div style={{ marginTop: 8 }}>
            <label style={st.idFieldLabel}>Comment (optional — saved into the mcap)</label>
            <input style={st.input} placeholder="e.g. weekly inspection, west field, foggy"
              value={comment} maxLength={500}
              onChange={e => setComment(e.target.value)} />
          </div>

          {error && <div style={st.errorMsg}>{error}</div>}
          {(!companyId || !deviceId) && <div style={st.warnMsg}>Customer / device IDs not set. Configure AGROTECH_CUSTOMER_ID and AGROTECH_DEVICE_ID on the Jetson.</div>}
          {!connected && <div style={st.warnMsg}>Jetson not connected — go to Setup to bring up rosbridge.</div>}
        </div>
      )}

      {/* === RECORDING SUMMARY (compact, when active) === */}
      {recording && (
        <div style={st.section}>
          <div style={st.sectionHeader}>
            <span style={st.sectionTitle}>Recording details</span>
          </div>
          <div style={st.idChips}>
            <div style={st.chip}>
              <span style={st.chipLabel}>Customer</span>
              <span style={st.chipValue} title={companyId}>{companyId || '—'}</span>
            </div>
            <div style={st.chip}>
              <span style={st.chipLabel}>Device</span>
              <span style={st.chipValue} title={deviceId}>{deviceId || '—'}</span>
            </div>
          </div>
          {comment && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#0d0d14', borderRadius: 8, fontSize: 11, color: '#bbb' }}>
              <span style={{ color: '#666', marginRight: 6 }}>💬</span>{comment}
            </div>
          )}
        </div>
      )}

      {/* === TOPICS (collapsed by default) === */}
      <div style={st.section}>
        <button
          onClick={() => setTopicsExpanded(!topicsExpanded)}
          style={st.disclosureHeader}
          aria-expanded={topicsExpanded}
        >
          <span style={st.sectionTitle}>What to record</span>
          <span style={st.disclosureMeta}>
            <span style={st.badge}>
              {recordVideo ? '📷 Video + ' : ''}{enabledSensorTopics.length}/{topics.length} topics
            </span>
            <span style={st.disclosureCaret}>{topicsExpanded ? '▾' : '▸'}</span>
          </span>
        </button>

        {topicsExpanded && (
          <div style={{ marginTop: 12 }}>
            {/* Video toggle */}
            <div style={st.videoRow}>
              <button style={recordVideo ? st.toggleOn : st.toggleOff} onClick={() => { if (!recording) setRecordVideo(!recordVideo); }} disabled={recording}>
                {recordVideo ? '📷 Record Video — ON' : '📷 Record Video — OFF'}
              </button>
              <span style={st.videoHint}>
                {recordVideo ? 'cameras.mcap — full FPS direct write' : 'No video — sensors only'}
              </span>
            </div>

            {/* Sensor topics by section */}
            <div style={st.subHeader}>
              <span style={st.subTitle}>Sensor & AGV Topics</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={st.badge}>{enabledSensorTopics.length}/{topics.length}</span>
                <button style={st.miniBtn} onClick={() => toggleAll(true)} disabled={recording}>All</button>
                <button style={st.miniBtn} onClick={() => toggleAll(false)} disabled={recording}>None</button>
              </div>
            </div>
            {TOPIC_SECTIONS.map(section => {
              const sectionTopics = topics.filter(t => {
                const def = ALL_DEFAULT_TOPICS.find(d => d.key === t.key);
                return def ? def.section === section.id : false;
              });
              if (sectionTopics.length === 0) return null;
              const enabledCount = sectionTopics.filter(t => t.enabled).length;
              return (
                <div key={section.id} style={{ marginBottom: 10 }}>
                  <div style={st.sectionRow}>
                    <span style={st.sectionLabel}>{section.label}</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={st.badge}>{enabledCount}/{sectionTopics.length}</span>
                      <button style={st.miniBtn} onClick={() => toggleSection(section.id, true)} disabled={recording}>✓</button>
                      <button style={st.miniBtn} onClick={() => toggleSection(section.id, false)} disabled={recording}>✗</button>
                    </div>
                  </div>
                  <div style={st.topicList}>
                    {sectionTopics.map(t => (
                      <div key={t.key} style={st.topicRow}>
                        <button style={st.checkbox(t.enabled)} onClick={() => { if (!recording) toggleTopic(t.key); }} disabled={recording}>
                          {t.enabled ? '✓' : ''}
                        </button>
                        <div style={st.topicInfo}>
                          <div style={st.topicName(t.enabled)}>{t.topic}</div>
                          <div style={st.topicType}>{t.type}</div>
                        </div>
                        {t.enabled && <span style={st.activityDot(topicActivity[t.topic])} title={topicActivity[t.topic] === 'publishing' ? 'Receiving data' : topicActivity[t.topic] === 'idle' ? 'Publisher exists, no data' : 'No publisher'} />}
                        {!ALL_DEFAULT_TOPICS.some(d => d.key === t.key) && !recording && (
                          <button style={st.rmBtn} onClick={() => removeTopic(t.key)}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {topics.filter(t => !ALL_DEFAULT_TOPICS.some(d => d.key === t.key)).length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={st.sectionRow}><span style={st.sectionLabel}>📌 Custom</span></div>
                <div style={st.topicList}>
                  {topics.filter(t => !ALL_DEFAULT_TOPICS.some(d => d.key === t.key)).map(t => (
                    <div key={t.key} style={st.topicRow}>
                      <button style={st.checkbox(t.enabled)} onClick={() => { if (!recording) toggleTopic(t.key); }} disabled={recording}>
                        {t.enabled ? '✓' : ''}
                      </button>
                      <div style={st.topicInfo}>
                        <div style={st.topicName(t.enabled)}>{t.topic}</div>
                        <div style={st.topicType}>{t.type}</div>
                      </div>
                      {t.enabled && <span style={st.activityDot(topicActivity[t.topic])} title={topicActivity[t.topic] === 'publishing' ? 'Receiving data' : topicActivity[t.topic] === 'idle' ? 'Publisher exists, no data' : 'No publisher'} />}
                      <button style={st.rmBtn} onClick={() => removeTopic(t.key)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!recording && (adding ? (
              <div style={st.addRow}>
                <select style={st.select} value={newTopic} onChange={e => { setNewTopic(e.target.value); const found = availableTopics.find(t => t.name === e.target.value); if (found) setNewType(found.type); }}>
                  <option value="">Select topic...</option>
                  {unusedTopics.map(t => <option key={t.name} value={t.name}>{t.name} ({t.type})</option>)}
                </select>
                <input style={st.typeInput} value={newType} onChange={e => setNewType(e.target.value)} placeholder="Type" />
                <button style={st.addConfirm} onClick={addTopic}>Add</button>
                <button style={st.cancelBtn} onClick={() => setAdding(false)}>✕</button>
              </div>
            ) : (
              <button style={st.addBtn} onClick={() => setAdding(true)}>+ Add Topic</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const st = {
  container: { display: 'flex', flexDirection: 'column', gap: 16 },

  statusBanner: { background: '#ff475710', border: '1px solid #ff475733', borderRadius: 12, padding: 16 },
  statusRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  statusDot: { width: 10, height: 10, borderRadius: '50%', background: '#ff4757', boxShadow: '0 0 10px #ff475788' },
  statusLabel: { fontSize: 12, fontWeight: 800, color: '#ff4757', letterSpacing: '2px' },
  statusTime: { fontSize: 12, color: '#ff9f43', fontWeight: 600, marginLeft: 'auto' },
  statusCounts: { display: 'flex', gap: 16 },
  countItem: { flex: 1, background: '#0a0a0f', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  countLabel: { fontSize: 11, color: '#888' },
  countValue: { fontSize: 12, fontWeight: 700, color: '#e0e0e6' },

  section: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 16 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0e6' },

  videoRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 12px', background: '#0d0d14', borderRadius: 8 },
  videoHint: { fontSize: 10, color: '#555' },
  toggleOn: { padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#00d26a18', border: '1px solid #00d26a44', color: '#00d26a', whiteSpace: 'nowrap' },
  toggleOff: { padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#555', whiteSpace: 'nowrap' },

  subHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  subTitle: { fontSize: 12, fontWeight: 600, color: '#888' },
  badge: { fontSize: 10, color: '#6c5ce7', background: '#6c5ce712', padding: '2px 8px', borderRadius: 8 },
  miniBtn: { padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888' },
  sectionRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0 4px' },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: '#6c5ce7', letterSpacing: '0.3px' },

  topicList: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10, maxHeight: 280, overflowY: 'auto' },
  topicRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#0d0d14', borderRadius: 8 },
  checkbox: (on) => ({
    width: 20, height: 20, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
    background: on ? '#00d26a18' : '#1a1a24', border: `1px solid ${on ? '#00d26a44' : '#2a2a3a'}`, color: on ? '#00d26a' : 'transparent',
  }),
  topicInfo: { flex: 1, minWidth: 0 },
  topicName: (on) => ({ fontSize: 11, fontWeight: 500, color: on ? '#e0e0e6' : '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  topicType: { fontSize: 9, color: '#444', marginTop: 1 },
  activityDot: (state) => ({ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: state === 'publishing' ? '#00d26a' : state === 'idle' ? '#ffa502' : '#333', boxShadow: state === 'publishing' ? '0 0 6px #00d26a88' : state === 'idle' ? '0 0 6px #ffa50288' : 'none', transition: 'all 0.3s' }),
  rmBtn: { background: '#ff475712', border: '1px solid #ff475733', borderRadius: 6, color: '#ff4757', width: 22, height: 22, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  addRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 },
  select: { flex: 2, padding: '7px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 11, outline: 'none' },
  typeInput: { flex: 1, padding: '7px 8px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 11, outline: 'none' },
  addConfirm: { padding: '6px 12px', background: '#00d26a15', border: '1px solid #00d26a44', borderRadius: 6, color: '#00d26a', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  cancelBtn: { background: 'none', border: 'none', color: '#666', fontSize: 14, cursor: 'pointer' },
  addBtn: { padding: '6px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#888', fontSize: 11, cursor: 'pointer', alignSelf: 'flex-start' },

  recRow: { display: 'flex', gap: 10, alignItems: 'center' },
  input: { flex: 1, padding: '8px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  recBtn: (active) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', whiteSpace: 'nowrap',
    background: active ? '#ff475715' : '#00d26a15', border: `1px solid ${active ? '#ff475744' : '#00d26a44'}`,
    borderRadius: 8, color: active ? '#ff4757' : '#00d26a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  }),
  recDot: (active) => ({ width: 8, height: 8, borderRadius: '50%', background: active ? '#ff4757' : '#00d26a', boxShadow: active ? '0 0 8px #ff475788' : 'none' }),
  errorMsg: { marginTop: 8, padding: '6px 12px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, color: '#ff4757', fontSize: 11, fontWeight: 600 },
  warnMsg: { marginTop: 8, padding: '6px 12px', background: '#ff9f4312', border: '1px solid #ff9f4333', borderRadius: 8, color: '#ff9f43', fontSize: 11 },

  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalCard: { background: '#111118', border: '1px solid #2a2a3a', borderRadius: 12, padding: 20, maxWidth: 480, width: '92%' },
  modalTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0e6', marginBottom: 12 },
  modalErr: { padding: '8px 12px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, color: '#ff4757', fontSize: 11, marginBottom: 12 },
  modalActions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  btnGhost: { padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888' },
  btnPrimary: { padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#6c5ce715', border: '1px solid #6c5ce744', color: '#6c5ce7' },
  btnRed: { padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: '#ff475715', border: '1px solid #ff475744', color: '#ff4757' },
  checkList: { listStyle: 'none', padding: 0, margin: '0 0 12px 0', display: 'flex', flexDirection: 'column', gap: 6 },
  checkItem: (ok) => ({ padding: '8px 12px', borderRadius: 8, fontSize: 11,
    background: ok ? '#00d26a10' : '#ff475710', border: `1px solid ${ok ? '#00d26a33' : '#ff475733'}`,
    color: ok ? '#aac' : '#ff9f43' }),
  lastLine: { background: '#000', color: '#aaa', padding: 8, borderRadius: 6, fontSize: 10, overflow: 'auto', maxHeight: 80, marginBottom: 12 },

  idChips: { display: 'flex', gap: 10, marginBottom: 10 },
  chip: { flex: 1, minWidth: 0, padding: '8px 12px', background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 2 },
  chipLabel: { fontSize: 9, fontWeight: 700, color: '#6c5ce7', letterSpacing: '0.5px', textTransform: 'uppercase' },
  chipValue: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  idField: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  idFieldLabel: { fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: '0.5px', textTransform: 'uppercase' },
  regenBtn: { padding: '6px 10px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', background: '#1a1a24', border: '1px solid #2a2a3a', color: '#888', alignSelf: 'flex-end', height: 34 },

  // === LIVE PANEL (visible while recording) ===
  livePanel: {
    background: 'linear-gradient(180deg, #1a0d10 0%, #0f0809 100%)',
    border: '1px solid #ff475755', borderRadius: 12, padding: 18,
    boxShadow: '0 0 24px #ff475722',
  },
  liveHeader: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' },
  liveDot: { width: 14, height: 14, borderRadius: '50%', background: '#ff4757', boxShadow: '0 0 12px #ff4757', animation: 'recPulse 1.6s ease-out infinite' },
  liveTitle: { fontSize: 14, fontWeight: 800, color: '#ff4757', letterSpacing: '3px' },
  liveTime: { fontSize: 24, fontWeight: 700, color: '#ff9f43', fontVariantNumeric: 'tabular-nums', letterSpacing: '2px', marginLeft: 'auto' },
  bigStopBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 22px', borderRadius: 10,
    background: '#ff4757', border: 'none', color: '#fff',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 16px #ff475766',
  },
  liveCounts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 },
  countValueId: { fontSize: 11, fontWeight: 700, color: '#bbb', fontFamily: 'monospace' },

  // === ACTION ZONE (visible when idle) ===
  actionZone: {
    background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 20,
  },
  actionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
  actionTitle: { fontSize: 16, fontWeight: 700, color: '#e0e0e6', marginBottom: 4 },
  actionSub: { fontSize: 11, color: '#666', maxWidth: 480 },
  bigRecordBtn: (disabled) => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 24px', borderRadius: 10,
    background: disabled ? '#1a1a24' : '#00d26a',
    border: 'none', color: disabled ? '#444' : '#0a0a0f',
    fontSize: 13, fontWeight: 800, cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 4px 16px #00d26a44',
    whiteSpace: 'nowrap', letterSpacing: '0.3px',
  }),
  bigRecordDot: { width: 10, height: 10, borderRadius: '50%', background: 'currentColor' },

  // === DISCLOSURE ===
  disclosureHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
    background: 'none', border: 'none', padding: 0, color: '#e0e0e6', cursor: 'pointer',
  },
  disclosureMeta: { display: 'flex', alignItems: 'center', gap: 10 },
  disclosureCaret: { fontSize: 14, color: '#666' },

  okBanner: { position: 'relative', padding: '10px 32px 10px 14px', background: '#00d26a12', border: '1px solid #00d26a44', borderRadius: 10, color: '#00d26a', fontSize: 12 },
  warnBanner: { position: 'relative', padding: '10px 32px 10px 14px', background: '#ff9f4312', border: '1px solid #ff9f4344', borderRadius: 10, color: '#ff9f43', fontSize: 12 },
  dismissBtn: { position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: 'inherit', fontSize: 16, cursor: 'pointer' },
};
