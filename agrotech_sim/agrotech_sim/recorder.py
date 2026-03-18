import os
import json
import csv
import threading
from queue import Queue, Empty
from collections import defaultdict

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from std_msgs.msg import String
from sensor_msgs.msg import Imu, CompressedImage, CameraInfo, Image, PointCloud2
from nav_msgs.msg import Odometry

# ── Topic registry: all sensor topics to record ──
SENSOR_TOPICS = [
    ('/imu/data', Imu),
    ('/camera/fisheye_left/image_raw/compressed', CompressedImage),
    ('/camera/fisheye_left/camera_info', CameraInfo),
    ('/camera/fisheye_right/image_raw/compressed', CompressedImage),
    ('/camera/fisheye_right/camera_info', CameraInfo),
    ('/zed/zed_node/rgb/image_rect_color', Image),
    ('/zed/zed_node/depth/depth_registered', Image),
    ('/zed/zed_node/rgb/camera_info', CameraInfo),
    ('/zed/zed_node/point_cloud/cloud_registered', PointCloud2),
    ('/wheel/odometry', Odometry),
]

SENSOR_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=200,
)


def _sanitize_topic(name):
    """Convert topic name to safe filename: /imu/data -> imu_data"""
    return name.strip('/').replace('/', '_')


def _stamp_to_iso(header):
    """Extract ISO-ish timestamp from a header stamp."""
    sec = header.stamp.sec
    nsec = header.stamp.nanosec
    return f'{sec}.{nsec:09d}'


def _msg_to_payload(msg):
    """Serialize a ROS message to a compact JSON string.

    Handles numpy arrays, bytes, nested messages, and primitive types.
    For binary-heavy fields we store metadata instead of raw bytes.
    """
    d = {}
    for slot in msg.__slots__:
        attr = slot.lstrip('_')
        val = getattr(msg, attr)
        if isinstance(val, bytes):
            d[attr] = f'<bytes:{len(val)}>'
        elif hasattr(val, 'tolist'):  # numpy array
            lst = val.tolist()
            d[attr] = lst if len(lst) <= 36 else f'<array:{len(lst)}>'
        elif isinstance(val, (list, tuple)) and len(val) > 0 and isinstance(val[0], (int, float)):
            d[attr] = list(val) if len(val) <= 36 else f'<array:{len(val)}>'
        elif hasattr(val, '__slots__'):
            d[attr] = _msg_to_payload(val)
        else:
            d[attr] = val
    return d


class RecorderNode(Node):
    """Always-on recorder node.

    Subscribes to all sensor topics at startup.  Idles until it receives
    a start command on /recording/command, then writes one CSV per topic
    using a dedicated writer thread per topic (non-blocking callbacks).
    """

    def __init__(self):
        super().__init__('recorder')

        self.recording = False
        self.patrol_id = ''
        self.recording_id = ''
        self.output_dir = ''
        self.frame_counters = defaultdict(int)
        self.writers = {}       # topic -> csv.writer
        self.files = {}         # topic -> file handle
        self.queues = {}        # topic -> Queue
        self.threads = {}       # topic -> Thread
        self._lock = threading.Lock()

        # Command listener — rosbridge publishes with TRANSIENT_LOCAL durability
        cmd_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self.create_subscription(
            String, '/recording/command', self._on_command, cmd_qos)

        # Status publisher — the app subscribes to this
        self.status_pub = self.create_publisher(String, '/recording/status', 10)
        self.status_timer = self.create_timer(1.0, self._publish_status)

        # Subscribe to every sensor topic immediately
        for topic_name, msg_type in SENSOR_TOPICS:
            q = Queue(maxsize=5000)
            self.queues[topic_name] = q
            self.create_subscription(
                msg_type, topic_name,
                lambda msg, t=topic_name: self._on_sensor(t, msg),
                SENSOR_QOS,
            )

        self.get_logger().info(
            f'Recorder ready — listening to {len(SENSOR_TOPICS)} topics, waiting for start command')

    # ── Command handling ──

    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn(f'Invalid command JSON: {msg.data}')
            return

        action = cmd.get('action')
        pid = cmd.get('patrol_id', 'unknown')
        rid = cmd.get('recording_id', 'unknown')

        if action == 'check':
            self._check_exists(pid, rid)
        elif action == 'start' and not self.recording:
            self._start(pid, rid)
        elif action == 'stop' and self.recording:
            self._stop()

    def _recording_base(self, patrol_id, recording_id):
        return os.path.join(
            os.path.expanduser('~'), 'agrotech_recordings',
            patrol_id, recording_id)

    def _check_exists(self, patrol_id, recording_id):
        base = self._recording_base(patrol_id, recording_id)
        raw_dir = os.path.join(base, 'raw')
        exists = os.path.isdir(raw_dir) and any(
            f.endswith('.csv') for f in os.listdir(raw_dir))
        resp = String()
        resp.data = json.dumps({
            'type': 'check_result',
            'exists': exists,
            'path': base,
            'patrol_id': patrol_id,
            'recording_id': recording_id,
        }, separators=(',', ':'))
        self.status_pub.publish(resp)

    def _start(self, patrol_id, recording_id):
        self.patrol_id = patrol_id
        self.recording_id = recording_id
        base = self._recording_base(patrol_id, recording_id)
        self.output_dir = base
        raw_dir = os.path.join(base, 'raw')
        processed_dir = os.path.join(base, 'processed')
        os.makedirs(raw_dir, exist_ok=True)
        os.makedirs(processed_dir, exist_ok=True)

        self.frame_counters.clear()

        for topic_name, _ in SENSOR_TOPICS:
            safe = _sanitize_topic(topic_name)
            path = os.path.join(raw_dir, f'{safe}.csv')
            fh = open(path, 'w', newline='', buffering=1)  # line-buffered
            writer = csv.writer(fh)
            writer.writerow([
                'patrol_id', 'recording_id', 'frame_id', 'topic',
                'timestamp', 'payload',
            ])
            self.files[topic_name] = fh
            self.writers[topic_name] = writer

            # Drain any stale data
            while not self.queues[topic_name].empty():
                try:
                    self.queues[topic_name].get_nowait()
                except Empty:
                    break

            # Writer thread per topic
            t = threading.Thread(
                target=self._writer_loop, args=(topic_name,), daemon=True)
            self.threads[topic_name] = t
            t.start()

        self.recording = True
        self.get_logger().info(
            f'▶ Recording started — patrol={patrol_id} rec={recording_id} → {self.output_dir}')

    def _stop(self):
        self.recording = False

        # Signal threads to finish (None sentinel)
        for topic_name in self.queues:
            self.queues[topic_name].put(None)

        for t in self.threads.values():
            t.join(timeout=5.0)

        for fh in self.files.values():
            fh.close()

        total = sum(self.frame_counters.values())
        self.get_logger().info(
            f'⏹ Recording stopped — {total} total frames saved to {self.output_dir}')

        self.writers.clear()
        self.files.clear()
        self.threads.clear()

    # ── Sensor callback (non-blocking) ──

    def _on_sensor(self, topic_name, msg):
        if not self.recording:
            return
        try:
            self.queues[topic_name].put_nowait((msg, self.get_clock().now()))
        except Exception:
            pass  # queue full — drop frame rather than block callback

    # ── Writer thread (one per topic) ──

    def _writer_loop(self, topic_name):
        q = self.queues[topic_name]
        writer = self.writers[topic_name]

        while True:
            item = q.get()
            if item is None:
                break

            msg, now = item
            try:
                self.frame_counters[topic_name] += 1
                frame_id = self.frame_counters[topic_name]

                if hasattr(msg, 'header') and msg.header.stamp.sec > 0:
                    ts = _stamp_to_iso(msg.header)
                else:
                    ts = f'{now.nanoseconds}'

                payload = json.dumps(_msg_to_payload(msg), separators=(',', ':'))

                writer.writerow([
                    self.patrol_id,
                    self.recording_id,
                    frame_id,
                    topic_name,
                    ts,
                    payload,
                ])
            except Exception as e:
                self.get_logger().error(f'Write error on {topic_name}: {e}')

    # ── Status broadcast ──

    def _publish_status(self):
        total = sum(self.frame_counters.values())
        per_topic = {_sanitize_topic(k): v for k, v in self.frame_counters.items() if v > 0}
        status = {
            'recording': self.recording,
            'patrol_id': self.patrol_id,
            'recording_id': self.recording_id,
            'output_dir': self.output_dir,
            'total_frames': total,
            'frames_per_topic': per_topic,
        }
        msg = String()
        msg.data = json.dumps(status, separators=(',', ':'))
        self.status_pub.publish(msg)

    # ── Cleanup ──

    def destroy_node(self):
        if self.recording:
            self._stop()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = RecorderNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
