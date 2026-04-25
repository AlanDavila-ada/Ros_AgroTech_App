import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';
import { rosEnv } from '../rosEnv';

const SSH_URL = 'http://localhost:4500';
const STORAGE_KEY = 'agrotech_jetson_rec_topics';

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

export const JetsonRecording = ({ jetsonHost, connected, ros, domainId }) => {
  const [topics, setTopics] = useState(() => loadTopics() || ALL_DEFAULT_TOPICS);
  const [recordVideo, setRecordVideo] = useState(true);
  const [patrolId, setPatrolId] = useState('');
  const [recordingId, setRecordingId] = useState('');
  const [companyId, setCompanyId] = useState('chada');
  const [deviceId, setDeviceId] = useState('1st-demo');
  const [recording, setRecording] = useState(false);
  const [camStatus, setCamStatus] = useState(null);
  const [sensorFrames, setSensorFrames] = useState(0);
  const [error, setError] = useState('');
  const [overwriteWarn, setOverwriteWarn] = useState(false);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [newType, setNewType] = useState('std_msgs/String');
  const [availableTopics, setAvailableTopics] = useState([]);
  const [topicActivity, setTopicActivity] = useState({}); // { topic: 'publishing' | 'idle' | 'none' }
  const activityRef = useRef({});
  const pubCountRef = useRef({}); // { topic: number }
  const pollRef = useRef(null);
  const offsetRef = useRef(0);

  // Subscribe to /recording/status from camera_node.py
  useEffect(() => {
    if (!ros || !connected) return;
    const sub = new ROSLIB.Topic({ ros, name: '/recording/status', messageType: 'std_msgs/String' });
    sub.subscribe((msg) => { try { setCamStatus(JSON.parse(msg.data)); } catch {} });
    return () => { sub.unsubscribe(); };
  }, [ros, connected]);

  // Check publisher counts periodically via SSH
  useEffect(() => {
    if (!ros || !connected) return;
    const enabled = topics.filter(t => t.enabled);
    const checkPubs = async () => {
      try {
        const topicList = enabled.map(t => t.topic).join(' ');
        const r = await fetch(`${SSH_URL}/ssh/exec`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'ada', password: 'ada123',
            command: `source /opt/ros/humble/setup.bash && export ROS_DOMAIN_ID=${domainId} && for t in ${topicList}; do echo "$t $(ros2 topic info $t 2>/dev/null | grep -oP 'Publisher count: \\K[0-9]+' || echo 0)"; done` }),
        });
        const d = await r.json();
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

  const toggleRecording = async () => {
    if (recording) {
      // === STOP ===
      if (recordVideo) publishRecordingCommand({ action: 'stop' });
      if (enabledSensorTopics.length > 0) {
        try { await fetch(`${SSH_URL}/ssh/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'mcap_recorder' }) }); } catch {}
      }
      clearInterval(pollRef.current);
      setRecording(false);
      return;
    }

    // === START ===
    if (!patrolId.trim() || !recordingId.trim() || !companyId.trim() || !deviceId.trim()) {
      setError('Company, Device, Patrol and Recording IDs are required.');
      return;
    }
    if (!recordVideo && enabledSensorTopics.length === 0) {
      setError('Enable video recording or select at least one sensor topic.');
      return;
    }
    setError('');

    if (!overwriteWarn) {
      setChecking(true);
      try {
        const chk = await fetch(`${SSH_URL}/ssh/exec`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: jetsonHost, user: 'ada', password: 'ada123', command: `test -d /AgroTech_recordings/${companyId}/${deviceId}/${patrolId}/${recordingId} && echo EXISTS || echo NO` }),
        });
        const d = await chk.json();
        if (d.ok && d.output.trim() === 'EXISTS') { setOverwriteWarn(true); setChecking(false); return; }
      } catch {}
      setChecking(false);
    }
    setOverwriteWarn(false);
    setSensorFrames(0);
    offsetRef.current = 0;

    // 1. Camera direct MCAP
    if (recordVideo) {
      publishRecordingCommand({ action: 'start', company: companyId, device: deviceId, patrol: patrolId, recording: recordingId });
    }

    // 2. Sensor recorder
    if (enabledSensorTopics.length > 0) {
      const topicsArg = enabledSensorTopics.map(t => `${t.topic}:${t.type}`).join(',');
      try {
        await fetch(`${SSH_URL}/ssh/launch`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'mcap_recorder', host: jetsonHost, user: 'ada', password: 'ada123',
            command: `${rosEnv(domainId)} && python3 /home/ada/mcap_recorder.py --company "${companyId}" --device "${deviceId}" --patrol "${patrolId}" --recording "${recordingId}" --topics "${topicsArg}"`,
          }),
        });
      } catch {}

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${SSH_URL}/ssh/output`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'mcap_recorder', since: offsetRef.current }),
          });
          const d = await r.json();
          if (d.lines) {
            offsetRef.current = d.offset;
            for (const l of d.lines.split('\n').filter(Boolean)) {
              try { const p = JSON.parse(l); if (p.counts) setSensorFrames(Object.values(p.counts).reduce((a, b) => a + b, 0)); } catch {}
            }
          }
        } catch {}
      }, 1000);
    }

    setRecording(true);
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
      {/* Status banner */}
      {recording && (
        <div style={st.statusBanner}>
          <div style={st.statusRow}>
            <span style={st.statusDot} />
            <span style={st.statusLabel}>RECORDING</span>
            <span style={st.statusTime}>{Math.floor(camElapsed)}s</span>
          </div>
          <div style={st.statusCounts}>
            {recordVideo && (
              <div style={st.countItem}>
                <span style={st.countLabel}>📷 Video (direct MCAP)</span>
                <span style={st.countValue}>{camFrames} frames</span>
              </div>
            )}
            {enabledSensorTopics.length > 0 && (
              <div style={st.countItem}>
                <span style={st.countLabel}>🤖 Sensors/AGV</span>
                <span style={st.countValue}>{sensorFrames} msgs</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Video toggle + Sensor topics */}
      <div style={st.section}>
        <div style={st.sectionHeader}>
          <span style={st.sectionTitle}>What to Record</span>
        </div>

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
        {/* Custom topics not in any section */}
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

      {/* Recording controls */}
      <div style={st.section}>
        <div style={st.recRow}>
          <input style={st.input} placeholder="Company" value={companyId}
            onChange={e => { setCompanyId(e.target.value); setError(''); setOverwriteWarn(false); }} disabled={recording} />
          <input style={st.input} placeholder="Device" value={deviceId}
            onChange={e => { setDeviceId(e.target.value); setError(''); setOverwriteWarn(false); }} disabled={recording} />
        </div>
        <div style={{ ...st.recRow, marginTop: 8 }}>
          <input style={{ ...st.input, ...(error && !patrolId.trim() ? { borderColor: '#ff475766' } : {}) }}
            placeholder="Patrol ID" value={patrolId}
            onChange={e => { setPatrolId(e.target.value); setError(''); setOverwriteWarn(false); }} disabled={recording} />
          <input style={{ ...st.input, ...(error && !recordingId.trim() ? { borderColor: '#ff475766' } : {}) }}
            placeholder="Recording ID" value={recordingId}
            onChange={e => { setRecordingId(e.target.value); setError(''); setOverwriteWarn(false); }} disabled={recording} />
          <button onClick={toggleRecording} style={st.recBtn(recording)} disabled={!connected || checking}>
            <span style={st.recDot(recording)} />
            {recording ? 'Stop' : checking ? '⏳ Checking...' : overwriteWarn ? '⚠ Overwrite?' : 'Record'}
          </button>
        </div>
        {error && <div style={st.errorMsg}>{error}</div>}
        {!connected && <div style={st.warnMsg}>Connect to Jetson rosbridge first (Setup tab)</div>}
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
};
