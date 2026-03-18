"""Recorder node for Jetson — subscribes to v4l2_multicamara topics,
writes CSV per topic, controlled via /jetson/recording/command."""

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
from sensor_msgs.msg import CompressedImage

JETSON_TOPICS = [
    ('/jetson/cam0/image_raw/compressed', CompressedImage),
    ('/jetson/cam0/image_undistorted/compressed', CompressedImage),
    ('/jetson/cam1/image_raw/compressed', CompressedImage),
    ('/jetson/cam1/image_undistorted/compressed', CompressedImage),
]

SENSOR_QOS = QoSProfile(
    reliability=ReliabilityPolicy.RELIABLE,
    history=HistoryPolicy.KEEP_LAST,
    depth=200,
)


def _sanitize(name):
    return name.strip('/').replace('/', '_')


class JetsonRecorderNode(Node):
    def __init__(self):
        super().__init__('jetson_recorder')

        self.recording = False
        self.patrol_id = ''
        self.recording_id = ''
        self.output_dir = ''
        self.frame_counters = defaultdict(int)
        self.writers = {}
        self.files = {}
        self.queues = {}
        self.threads = {}

        cmd_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self.create_subscription(String, '/jetson/recording/command', self._on_command, cmd_qos)
        self.status_pub = self.create_publisher(String, '/jetson/recording/status', 10)
        self.create_timer(1.0, self._publish_status)

        for topic_name, msg_type in JETSON_TOPICS:
            self.queues[topic_name] = Queue(maxsize=5000)
            self.create_subscription(
                msg_type, topic_name,
                lambda msg, t=topic_name: self._on_sensor(t, msg),
                SENSOR_QOS,
            )

        self.get_logger().info(f'JetsonRecorder ready — {len(JETSON_TOPICS)} topics')

    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except json.JSONDecodeError:
            return
        action = cmd.get('action')
        pid = cmd.get('patrol_id', 'unknown')
        rid = cmd.get('recording_id', 'unknown')

        if action == 'start' and not self.recording:
            self._start(pid, rid)
        elif action == 'stop' and self.recording:
            self._stop()

    def _start(self, patrol_id, recording_id):
        self.patrol_id = patrol_id
        self.recording_id = recording_id
        base = os.path.join(os.path.expanduser('~'), 'agrotech_recordings', patrol_id, recording_id, 'jetson_raw')
        self.output_dir = base
        os.makedirs(base, exist_ok=True)
        self.frame_counters.clear()

        for topic_name, _ in JETSON_TOPICS:
            safe = _sanitize(topic_name)
            fh = open(os.path.join(base, f'{safe}.csv'), 'w', newline='', buffering=1)
            writer = csv.writer(fh)
            writer.writerow(['patrol_id', 'recording_id', 'frame_id', 'topic', 'timestamp', 'payload'])
            self.files[topic_name] = fh
            self.writers[topic_name] = writer
            while not self.queues[topic_name].empty():
                try: self.queues[topic_name].get_nowait()
                except Empty: break
            t = threading.Thread(target=self._writer_loop, args=(topic_name,), daemon=True)
            self.threads[topic_name] = t
            t.start()

        self.recording = True
        self.get_logger().info(f'▶ Recording started → {base}')

    def _stop(self):
        self.recording = False
        for q in self.queues.values():
            q.put(None)
        for t in self.threads.values():
            t.join(timeout=5.0)
        for fh in self.files.values():
            fh.close()
        total = sum(self.frame_counters.values())
        self.get_logger().info(f'⏹ Stopped — {total} frames → {self.output_dir}')
        self.writers.clear()
        self.files.clear()
        self.threads.clear()

    def _on_sensor(self, topic_name, msg):
        if not self.recording:
            return
        try:
            self.queues[topic_name].put_nowait((msg, self.get_clock().now()))
        except Exception:
            pass

    def _writer_loop(self, topic_name):
        q = self.queues[topic_name]
        writer = self.writers[topic_name]
        while True:
            item = q.get()
            if item is None:
                break
            msg, now = item
            self.frame_counters[topic_name] += 1
            ts = f'{msg.header.stamp.sec}.{msg.header.stamp.nanosec:09d}' if hasattr(msg, 'header') and msg.header.stamp.sec > 0 else f'{now.nanoseconds}'
            payload = json.dumps({'format': msg.format, 'data_size': len(msg.data)}, separators=(',', ':'))
            writer.writerow([self.patrol_id, self.recording_id, self.frame_counters[topic_name], topic_name, ts, payload])

    def _publish_status(self):
        total = sum(self.frame_counters.values())
        msg = String()
        msg.data = json.dumps({
            'recording': self.recording,
            'patrol_id': self.patrol_id,
            'recording_id': self.recording_id,
            'output_dir': self.output_dir,
            'total_frames': total,
        }, separators=(',', ':'))
        self.status_pub.publish(msg)

    def destroy_node(self):
        if self.recording:
            self._stop()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = JetsonRecorderNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()
