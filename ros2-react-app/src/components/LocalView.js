import { useState, useEffect, useRef } from 'react';
import ROSLIB from 'roslib';

const STORAGE_KEY = 'agrotech_topic_config';

const DEFAULT_SENSOR_TOPICS = [
  { key: 'imu', label: 'IMU', topic: '/imu/data', type: 'sensor_msgs/Imu' },
  { key: 'fisheye_left', label: 'Fisheye L', topic: '/camera/fisheye_left/image_raw/compressed', type: 'sensor_msgs/CompressedImage' },
  { key: 'fisheye_left_info', label: 'Fisheye L Info', topic: '/camera/fisheye_left/camera_info', type: 'sensor_msgs/CameraInfo' },
  { key: 'fisheye_right', label: 'Fisheye R', topic: '/camera/fisheye_right/image_raw/compressed', type: 'sensor_msgs/CompressedImage' },
  { key: 'fisheye_right_info', label: 'Fisheye R Info', topic: '/camera/fisheye_right/camera_info', type: 'sensor_msgs/CameraInfo' },
  { key: 'zed_rgb', label: 'ZED RGB', topic: '/zed/zed_node/rgb/image_rect_color', type: 'sensor_msgs/Image' },
  { key: 'zed_depth', label: 'ZED Depth', topic: '/zed/zed_node/depth/depth_registered', type: 'sensor_msgs/Image' },
  { key: 'zed_info', label: 'ZED Info', topic: '/zed/zed_node/rgb/camera_info', type: 'sensor_msgs/CameraInfo' },
  { key: 'zed_pc', label: 'ZED PointCloud', topic: '/zed/zed_node/point_cloud/cloud_registered', type: 'sensor_msgs/PointCloud2' },
  { key: 'wheel_odom', label: 'Wheel Odom', topic: '/wheel/odometry', type: 'nav_msgs/Odometry' },
];

const DEFAULT_PROCESSING_TOPICS = [
  { key: 'robot_odom', label: 'Robot Odometry', topic: '/odom', type: 'nav_msgs/Odometry' },
  { key: 'slam', label: 'SLAM', topic: '/slam/status', type: 'std_msgs/String' },
  { key: 'mapping', label: 'Mapping', topic: '/map', type: 'nav_msgs/OccupancyGrid' },
  { key: 'localization', label: 'Localization', topic: '/amcl_pose', type: 'geometry_msgs/PoseWithCovarianceStamped' },
  { key: 'path', label: 'Path Planning', topic: '/planned_path', type: 'nav_msgs/Path' },
];

const loadConfig = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};
const saveConfig = (sensors, processing) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ sensors, processing }));

/* ── Modal editor ── */
const TopicEditor = ({ title, topics, onSave, onClose }) => {
  const [items, setItems] = useState(topics.map((t) => ({ ...t })));
  const update = (i, field, val) => {
    const next = [...items];
    next[i] = { ...next[i], [field]: val };
    if (field === 'label') next[i].key = val.toLowerCase().replace(/\s+/g, '_');
    setItems(next);
  };
  const remove = (i) => setItems(items.filter((_, idx) => idx !== i));
  const add = () => setItems([...items, { key: `custom_${Date.now()}`, label: '', topic: '', type: 'std_msgs/String' }]);

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={(e) => e.stopPropagation()}>
        <div style={modal.header}>
          <span style={modal.title}>{title}</span>
          <button style={modal.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={modal.body}>
          {items.map((item, i) => (
            <div key={i} style={modal.row}>
              <input style={modal.input} placeholder="Label" value={item.label} onChange={(e) => update(i, 'label', e.target.value)} />
              <input style={{ ...modal.input, flex: 2 }} placeholder="/topic/name" value={item.topic} onChange={(e) => update(i, 'topic', e.target.value)} />
              <input style={modal.input} placeholder="msg type" value={item.type} onChange={(e) => update(i, 'type', e.target.value)} />
              <button style={modal.rmBtn} onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
        <div style={modal.footer}>
          <button style={modal.addBtn} onClick={add}>+ Add Topic</button>
          <button style={modal.saveBtn} onClick={() => onSave(items)}>Save</button>
        </div>
      </div>
    </div>
  );
};

/* ── Status row component (table-like) ── */
const StatusRow = ({ label, topic, type, alive, activeLabel, idleLabel }) => (
  <div style={s.statusRow}>
    <div style={s.statusDot(alive)} />
    <span style={s.rowLabel}>{label}</span>
    <span style={s.rowTopic} title={topic}>{topic}</span>
    <span style={s.rowType}>{type}</span>
    <span style={s.rowState(alive)}>{alive ? activeLabel : idleLabel}</span>
  </div>
);

export const LocalView = ({ ros, recording, setRecording, patrolId, setPatrolId, recordingId, setRecordingId }) => {
  const saved = loadConfig();
  const [sensorTopics, setSensorTopics] = useState(saved?.sensors || DEFAULT_SENSOR_TOPICS);
  const [processingTopics, setProcessingTopics] = useState(saved?.processing || DEFAULT_PROCESSING_TOPICS);
  const [sensorStatus, setSensorStatus] = useState({});
  const [processingStatus, setProcessingStatus] = useState({});
  const [publishLog, setPublishLog] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [topics, setTopics] = useState([]);
  const [topicName, setTopicName] = useState('');
  const [messageType, setMessageType] = useState('');
  const [messageData, setMessageData] = useState('{}');
  const [editSection, setEditSection] = useState(null);
  const [activeTab, setActiveTab] = useState('sensors'); // 'sensors' | 'processing' | 'publish'
  const [recorderStatus, setRecorderStatus] = useState(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState(null);
  const pendingStart = useRef(false);
  const patrolIdRef = useRef(patrolId);
  const recordingIdRef = useRef(recordingId);
  patrolIdRef.current = patrolId;
  recordingIdRef.current = recordingId;

  const sensorTimers = useRef({});
  const processingTimers = useRef({});
  const recorderAlive = useRef(null);
  const recordingConfig = { topicName: '/recording/command', messageType: 'std_msgs/String' };

  // Recorder status listener
  useEffect(() => {
    if (!ros) return;
    const listener = new ROSLIB.Topic({ ros, name: '/recording/status', messageType: 'std_msgs/String' });
    listener.subscribe((msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'check_result') {
          if (data.exists) {
            setOverwriteConfirm({ path: data.path });
          } else {
            // No existing data — start directly
            sendStart();
          }
          return;
        }
        setRecorderStatus(data);
        clearTimeout(recorderAlive.current);
        recorderAlive.current = setTimeout(() => setRecorderStatus(null), 3000);
      } catch {}
    });
    return () => listener.unsubscribe();
  }, [ros]);

  useEffect(() => {
    if (!ros) return;
    const f = () => ros.getTopics((r) => setTopics(r.topics.map((name, i) => ({ name, type: r.types[i] }))));
    f();
    const interval = setInterval(f, 5000);
    return () => clearInterval(interval);
  }, [ros]);

  useEffect(() => {
    if (!ros) return;
    const listeners = sensorTopics.map(({ key, topic, type }) => {
      const listener = new ROSLIB.Topic({ ros, name: topic, messageType: type });
      listener.subscribe(() => {
        setSensorStatus((prev) => ({ ...prev, [key]: Date.now() }));
        clearTimeout(sensorTimers.current[key]);
        sensorTimers.current[key] = setTimeout(
          () => setSensorStatus((prev) => { const n = { ...prev }; delete n[key]; return n; }), 3000
        );
      });
      return listener;
    });
    return () => listeners.forEach((l) => l.unsubscribe());
  }, [ros, sensorTopics]);

  useEffect(() => {
    if (!ros || !recording) { setProcessingStatus({}); return; }
    const listeners = processingTopics.map(({ key, topic, type }) => {
      const listener = new ROSLIB.Topic({ ros, name: topic, messageType: type || 'std_msgs/String' });
      listener.subscribe(() => {
        setProcessingStatus((prev) => ({ ...prev, [key]: Date.now() }));
        clearTimeout(processingTimers.current[key]);
        processingTimers.current[key] = setTimeout(
          () => setProcessingStatus((prev) => { const n = { ...prev }; delete n[key]; return n; }), 3000
        );
      });
      return listener;
    });
    return () => listeners.forEach((l) => l.unsubscribe());
  }, [ros, recording, processingTopics]);

  const activeSensors = Object.keys(sensorStatus).length;
  const activeProcessing = Object.keys(processingStatus).length;

  const sendCommand = (action) => {
    const topic = new ROSLIB.Topic({ ros, name: recordingConfig.topicName, messageType: recordingConfig.messageType });
    topic.publish(new ROSLIB.Message({ data: JSON.stringify({ action, patrol_id: patrolIdRef.current, recording_id: recordingIdRef.current }) }));
  };

  const sendStart = () => {
    sendCommand('start');
    setRecording(true);
    addLog(recordingConfig.topicName, `START (patrol: ${patrolIdRef.current}, rec: ${recordingIdRef.current})`);
  };

  const toggleRecording = () => {
    if (!ros) return;
    if (recording) {
      sendCommand('stop');
      setRecording(false);
      addLog(recordingConfig.topicName, 'STOP');
      return;
    }
    if (!patrolId.trim() || !recordingId.trim()) {
      setValidationError('Patrol ID and Recording ID are required to start recording.');
      return;
    }
    setValidationError('');
    // Ask recorder to check if path exists
    sendCommand('check');
  };

  const confirmOverwrite = () => {
    setOverwriteConfirm(null);
    sendStart();
  };

  const publish = () => {
    if (!ros || !topicName || !messageType) return;
    try {
      const topic = new ROSLIB.Topic({ ros, name: topicName, messageType });
      topic.publish(new ROSLIB.Message(JSON.parse(messageData)));
      addLog(topicName, messageData);
    } catch (e) { addLog(topicName, `ERROR: ${e.message}`); }
  };

  const addLog = (topic, data) =>
    setPublishLog((prev) => [{ topic, data, ts: Date.now() }, ...prev.slice(0, 49)]);

  const handleSaveSensors = (items) => { setSensorTopics(items); saveConfig(items, processingTopics); setEditSection(null); };
  const handleSaveProcessing = (items) => { setProcessingTopics(items); saveConfig(sensorTopics, items); setEditSection(null); };
  const resetDefaults = () => { setSensorTopics(DEFAULT_SENSOR_TOPICS); setProcessingTopics(DEFAULT_PROCESSING_TOPICS); localStorage.removeItem(STORAGE_KEY); };

  return (
    <main style={s.main}>
      {editSection === 'sensors' && <TopicEditor title="Edit Sensor Topics" topics={sensorTopics} onSave={handleSaveSensors} onClose={() => setEditSection(null)} />}
      {editSection === 'processing' && <TopicEditor title="Edit Processing Topics" topics={processingTopics} onSave={handleSaveProcessing} onClose={() => setEditSection(null)} />}

      {/* Overwrite confirmation popup */}
      {overwriteConfirm && (
        <div style={modal.overlay} onClick={() => setOverwriteConfirm(null)}>
          <div style={modal.box} onClick={(e) => e.stopPropagation()}>
            <div style={modal.header}>
              <span style={modal.title}>⚠ Recording Exists</span>
              <button style={modal.closeBtn} onClick={() => setOverwriteConfirm(null)}>✕</button>
            </div>
            <div style={{ padding: '20px', fontSize: 13, color: '#ccc', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>A recording already exists at:</p>
              <div style={{ padding: '8px 12px', background: '#1a1a24', borderRadius: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#888', wordBreak: 'break-all' }}>
                {overwriteConfirm.path}
              </div>
              <p style={{ margin: '12px 0 0', color: '#ff4757', fontSize: 12 }}>
                Starting will overwrite the raw sensor data. Processed data will not be affected.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid #1e1e2a' }}>
              <button style={modal.addBtn} onClick={() => setOverwriteConfirm(null)}>Cancel</button>
              <button style={{ ...modal.saveBtn, background: '#ff475718', borderColor: '#ff475744', color: '#ff4757' }} onClick={confirmOverwrite}>Overwrite & Record</button>
            </div>
          </div>
        </div>
      )}

      {/* Recording — always visible */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <span style={s.sectionTitle}>Recording Control</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {recording && <span style={s.recBadge}>● REC</span>}
            <span style={s.recorderOnline(!!recorderStatus)}>
              {recorderStatus ? '◉ Recorder Online' : '○ Recorder Offline'}
            </span>
            <button style={s.editBtn} onClick={resetDefaults} title="Reset to defaults">⟲ Reset</button>
          </div>
        </div>
        <div style={s.metaRow}>
          <div style={s.metaField}>
            <label style={s.label}>Patrol ID</label>
            <input style={{ ...s.input, ...(validationError && !patrolId.trim() ? s.inputError : {}) }} placeholder="patrol_001" value={patrolId} onChange={(e) => { setPatrolId(e.target.value); setValidationError(''); }} disabled={recording} />
          </div>
          <div style={s.metaField}>
            <label style={s.label}>Recording ID</label>
            <input style={{ ...s.input, ...(validationError && !recordingId.trim() ? s.inputError : {}) }} placeholder="rec_001" value={recordingId} onChange={(e) => { setRecordingId(e.target.value); setValidationError(''); }} disabled={recording} />
          </div>
          <div style={s.metaField}>
            <button onClick={toggleRecording} style={s.recordBtn(recording)}>
              <span style={s.recordDot(recording)} />
              {recording ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>
        </div>
        {validationError && <div style={s.errorMsg}>{validationError}</div>}
        {!recorderStatus && recording && (
          <div style={s.warnMsg}>⚠ Recorder node not responding — data may not be saving</div>
        )}
        {recorderStatus && recorderStatus.recording && (
          <div style={s.recStatus}>
            <span>📁 {recorderStatus.output_dir}</span>
            <span style={s.frameCount}>{recorderStatus.total_frames} frames saved</span>
          </div>
        )}
      </div>

      {/* Tabbed area: Sensors / Processing / Publish */}
      <div style={s.tabbedSection}>
        <div style={s.tabBar}>
          <button style={s.tab(activeTab === 'sensors')} onClick={() => setActiveTab('sensors')}>
            Sensors <span style={s.tabBadge(activeSensors > 0)}>{activeSensors}/{sensorTopics.length}</span>
          </button>
          <button style={s.tab(activeTab === 'processing')} onClick={() => setActiveTab('processing')}>
            Processing <span style={s.tabBadge(activeProcessing > 0)}>{activeProcessing}/{processingTopics.length}</span>
          </button>
          <button style={s.tab(activeTab === 'publish')} onClick={() => setActiveTab('publish')}>
            Publish
          </button>
          <div style={s.tabSpacer} />
          {activeTab !== 'publish' && (
            <button style={s.editBtn} onClick={() => setEditSection(activeTab === 'sensors' ? 'sensors' : 'processing')}>✎ Edit</button>
          )}
        </div>

        <div style={s.tabContent}>
          {/* ── Sensors tab ── */}
          {activeTab === 'sensors' && (
            <div>
              <div style={s.tableHeader}>
                <span style={s.thDot} />
                <span style={s.thLabel}>Name</span>
                <span style={s.thTopic}>Topic</span>
                <span style={s.thType}>Type</span>
                <span style={s.thState}>Status</span>
              </div>
              {sensorTopics.map(({ key, label, topic, type }) => (
                <StatusRow key={key} label={label} topic={topic} type={type} alive={!!sensorStatus[key]} activeLabel="RECEIVING" idleLabel="IDLE" />
              ))}
            </div>
          )}

          {/* ── Processing tab ── */}
          {activeTab === 'processing' && (
            <div>
              <div style={s.tableHeader}>
                <span style={s.thDot} />
                <span style={s.thLabel}>Name</span>
                <span style={s.thTopic}>Topic</span>
                <span style={s.thType}>Type</span>
                <span style={s.thState}>Status</span>
              </div>
              {processingTopics.map(({ key, label, topic, type }) => (
                <StatusRow key={key} label={label} topic={topic} type={type} alive={!!processingStatus[key]} activeLabel="PROCESSING" idleLabel="STANDBY" />
              ))}
              {activeSensors === 0 && <div style={s.pipelineHint}>Waiting for sensor data to begin processing...</div>}
            </div>
          )}

          {/* ── Publish tab ── */}
          {activeTab === 'publish' && (
            <div style={s.publishLayout}>
              <div>
                <div style={s.formGroup}>
                  <label style={s.label}>Topic</label>
                  <input style={s.input} placeholder="/my_topic" value={topicName} onChange={(e) => setTopicName(e.target.value)} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Message Type</label>
                  <input style={s.input} placeholder="std_msgs/String" value={messageType} onChange={(e) => setMessageType(e.target.value)} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Data (JSON)</label>
                  <textarea style={s.textarea} value={messageData} onChange={(e) => setMessageData(e.target.value)} />
                </div>
                <button onClick={publish} style={s.publishBtn}>Publish ▷</button>
              </div>
              <div>
                <div style={{ ...s.label, marginBottom: 8 }}>Quick Select</div>
                <div style={s.topicGrid}>
                  {topics.map((t) => (
                    <button key={t.name} style={s.topicChip(t.name === topicName)} onClick={() => { setTopicName(t.name); setMessageType(t.type); }}>
                      <div style={s.chipName}>{t.name}</div>
                      <div style={s.chipType}>{t.type}</div>
                    </button>
                  ))}
                  {topics.length === 0 && <div style={s.empty}>No topics available</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Log */}
      {publishLog.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionHeader}>
            <span style={s.sectionTitle}>Publish Log</span>
            <button onClick={() => setPublishLog([])} style={s.editBtn}>Clear</button>
          </div>
          <div style={s.logArea}>
            {publishLog.map((entry, i) => (
              <div key={i} style={s.logRow}>
                <span style={s.logTs}>{new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false })}</span>
                <span style={s.logTopic}>{entry.topic}</span>
                <span style={s.logData}>{entry.data}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
};

/* ── Modal styles ── */
const modal = {
  overlay: { position: 'fixed', inset: 0, background: '#000000aa', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  box: { background: '#16161e', border: '1px solid #2a2a3a', borderRadius: 14, width: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #1e1e2a' },
  title: { fontSize: 15, fontWeight: 700, color: '#e0e0e6' },
  closeBtn: { background: 'none', border: 'none', color: '#666', fontSize: 16, cursor: 'pointer' },
  body: { flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  input: { flex: 1, padding: '7px 10px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#ccc', fontSize: 12, outline: 'none', boxSizing: 'border-box' },
  rmBtn: { background: '#ff475712', border: '1px solid #ff475733', borderRadius: 6, color: '#ff4757', width: 28, height: 28, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  footer: { display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid #1e1e2a' },
  addBtn: { padding: '8px 16px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#888', fontSize: 12, cursor: 'pointer' },
  saveBtn: { padding: '8px 20px', background: '#6c5ce718', border: '1px solid #6c5ce744', borderRadius: 8, color: '#6c5ce7', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};

/* ── Main styles ── */
const s = {
  main: { flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  section: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, padding: 20 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: 700 },

  recBadge: { fontSize: 11, color: '#ff4757', fontWeight: 700, letterSpacing: '1.5px' },
  recorderOnline: (on) => ({
    fontSize: 10, fontWeight: 600, letterSpacing: '0.5px',
    color: on ? '#00d26a' : '#ff4757',
  }),
  warnMsg: {
    marginTop: 10, padding: '8px 12px', background: '#ffa50212',
    border: '1px solid #ffa50233', borderRadius: 8,
    color: '#ffa502', fontSize: 12, fontWeight: 600,
  },
  recStatus: {
    marginTop: 10, padding: '8px 12px', background: '#00d26a08',
    border: '1px solid #00d26a22', borderRadius: 8,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 11, color: '#888',
  },
  frameCount: { color: '#00d26a', fontWeight: 700, fontSize: 12 },
  metaRow: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  metaField: { flex: 1, minWidth: 160 },
  recordBtn: (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px', marginTop: 18,
    background: active ? '#ff475715' : '#00d26a15', border: `1px solid ${active ? '#ff475744' : '#00d26a44'}`,
    borderRadius: 10, color: active ? '#ff4757' : '#00d26a', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  }),
  recordDot: (active) => ({ width: 10, height: 10, borderRadius: '50%', background: active ? '#ff4757' : '#00d26a', boxShadow: active ? '0 0 10px #ff475788' : 'none' }),
  errorMsg: { marginTop: 10, padding: '8px 12px', background: '#ff475712', border: '1px solid #ff475733', borderRadius: 8, color: '#ff4757', fontSize: 12, fontWeight: 600 },
  inputError: { borderColor: '#ff475766' },

  editBtn: { padding: '4px 10px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 6, color: '#888', fontSize: 11, cursor: 'pointer', fontWeight: 600 },

  /* Tabbed section */
  tabbedSection: { background: '#111118', border: '1px solid #1e1e2a', borderRadius: 12, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' },
  tabBar: { display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0', borderBottom: '1px solid #1e1e2a' },
  tab: (active) => ({
    padding: '8px 16px', background: 'none', border: 'none', borderBottom: active ? '2px solid #6c5ce7' : '2px solid transparent',
    color: active ? '#e0e0e6' : '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
  }),
  tabBadge: (active) => ({
    fontSize: 10, padding: '1px 7px', borderRadius: 10,
    background: active ? '#00d26a18' : '#1a1a24', color: active ? '#00d26a' : '#555',
  }),
  tabSpacer: { flex: 1 },
  tabContent: { flex: 1, overflow: 'auto', padding: 16 },

  /* Table-like rows */
  tableHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px 8px', borderBottom: '1px solid #1e1e2a', marginBottom: 4 },
  thDot: { width: 8, flexShrink: 0 },
  thLabel: { width: 110, flexShrink: 0, fontSize: 10, color: '#555', fontWeight: 700, letterSpacing: '1px' },
  thTopic: { flex: 1, fontSize: 10, color: '#555', fontWeight: 700, letterSpacing: '1px', minWidth: 0 },
  thType: { width: 180, flexShrink: 0, fontSize: 10, color: '#555', fontWeight: 700, letterSpacing: '1px' },
  thState: { width: 80, flexShrink: 0, fontSize: 10, color: '#555', fontWeight: 700, letterSpacing: '1px', textAlign: 'right' },

  statusRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 8px', borderBottom: '1px solid #1a1a24' },
  statusDot: (alive) => ({ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: alive ? '#00d26a' : '#333', boxShadow: alive ? '0 0 8px #00d26a88' : 'none' }),
  rowLabel: { width: 110, flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#e0e0e6' },
  rowTopic: { flex: 1, fontSize: 12, color: '#888', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  rowType: { width: 180, flexShrink: 0, fontSize: 11, color: '#555' },
  rowState: (alive) => ({ width: 80, flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: alive ? '#00d26a' : '#444', textAlign: 'right' }),

  pipelineHint: { marginTop: 12, fontSize: 11, color: '#444', fontStyle: 'italic', padding: '0 8px' },

  /* Publish tab */
  publishLayout: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  formGroup: { marginBottom: 12 },
  label: { display: 'block', fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 600 },
  input: { width: '100%', padding: '8px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', height: 80, padding: '8px 12px', background: '#1a1a24', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", outline: 'none', resize: 'vertical', boxSizing: 'border-box' },
  publishBtn: { padding: '10px 24px', background: '#6c5ce718', border: '1px solid #6c5ce744', borderRadius: 8, color: '#6c5ce7', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  topicGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 280, overflowY: 'auto' },
  topicChip: (active) => ({ padding: '8px 12px', background: active ? '#6c5ce712' : '#1a1a24', border: active ? '1px solid #6c5ce733' : '1px solid #2a2a3a', borderRadius: 8, cursor: 'pointer', textAlign: 'left', color: '#e0e0e6' }),
  chipName: { fontSize: 12, fontWeight: 500 },
  chipType: { fontSize: 9, color: '#555', marginTop: 2 },
  empty: { fontSize: 12, color: '#444' },

  logArea: { maxHeight: 200, overflowY: 'auto' },
  logRow: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #1a1a24', fontSize: 12 },
  logTs: { color: '#555', fontSize: 10, whiteSpace: 'nowrap' },
  logTopic: { color: '#6c5ce7', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  logData: { color: '#888', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
};
