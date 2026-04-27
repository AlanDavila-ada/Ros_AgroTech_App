#!/usr/bin/env python3
"""Dual IMX477 CSI node — direct MCAP recording + ROS2 preview.

Recording controlled via /recording/command topic:
  {"action":"start","company":"x","device":"y","patrol":"p","recording":"r"}
  {"action":"stop"}

Status published on /recording/status topic.
"""
import os, sys, time, json, threading, argparse, yaml
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from agrotech_log import log as alog
except Exception:
    def alog(*args, **kwargs): pass
import cv2, numpy as np
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String
from mcap.writer import Writer

Gst.init(None)

# --- defaults (overridable via args) ---
CAP_W, CAP_H = 1920, 1080
FPS = 30
JPEG_QUALITY = 85
PREVIEW_EVERY = 5  # publish 1 of N frames to ROS2
BASE_DIR = '/AgroTech_recordings'
ENCODE_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]

SCHEMA_TEXT = 'sensor_msgs/msg/CompressedImage'


def _pipe(sid, w, h, fps):
    return (f'nvarguscamerasrc sensor-id={sid} ! '
            f'video/x-raw(memory:NVMM),width=1920,height=1080,format=NV12,framerate={fps}/1 ! '
            f'nvvidconv ! video/x-raw,format=BGRx,width={w},height={h} ! '
            f'appsink name=sink max-buffers=1 drop=true sync=false emit-signals=false')


def load_maps(path, w, h):
    if not os.path.isfile(path):
        return None
    with open(path) as f:
        c = yaml.safe_load(f)
    ow, oh = c['image_width'], c['image_height']
    K = np.array(c['camera_matrix']['data'], dtype=np.float64).reshape(3, 3)
    D = np.array(c['distortion_coefficients']['data'], dtype=np.float64).reshape(-1, 1)
    K[0, :] *= w / ow; K[1, :] *= h / oh
    nK, _ = cv2.getOptimalNewCameraMatrix(K, D, (w, h), alpha=0)
    return cv2.initUndistortRectifyMap(K, D, None, nK, (w, h), cv2.CV_16SC2)


def read_calib_profile():
    info = {}
    for cid in [0, 1]:
        path = os.path.expanduser(f'~/cam{cid}.yaml')
        if os.path.isfile(path):
            try:
                with open(path) as f:
                    c = yaml.safe_load(f)
                K = c.get('camera_matrix', {}).get('data', [])
                D = c.get('distortion_coefficients', {}).get('data', [])
                info[f'cam{cid}'] = {
                    'fx': round(K[0], 2) if len(K) > 0 else None,
                    'fy': round(K[4], 2) if len(K) > 4 else None,
                    'cx': round(K[2], 2) if len(K) > 2 else None,
                    'cy': round(K[5], 2) if len(K) > 5 else None,
                    'distortion': [round(d, 6) for d in D],
                    'model': c.get('distortion_model', 'unknown'),
                }
            except Exception:
                pass
    return info or None


class CameraNode(Node):
    CAMS = [
        {'id': 0, 'name': 'cam0', 'calib': os.path.expanduser('~/cam0.yaml')},
        {'id': 1, 'name': 'cam1', 'calib': os.path.expanduser('~/cam1.yaml')},
    ]

    def __init__(self, pub_w, pub_h, fps, preview_every, no_undistort):
        super().__init__('camera_node')
        self.pub_w, self.pub_h = pub_w, pub_h
        self.fps = fps
        self.preview_every = preview_every
        self.no_undistort = no_undistort
        self._running = True
        self._threads = []

        # --- recording state ---
        # Reentrant — _publish_status acquires this lock too, and may be called
        # from inside _start_recording / _stop_recording which also hold it.
        self._rec_lock = threading.RLock()
        self._recording = False
        self._mcap_fh = None
        self._mcap_writer = None
        self._mcap_channels = {}
        self._rec_counts = {}
        self._rec_start = None
        self._rec_dir = None

        # --- ROS2 command/status ---
        self._cmd_sub = self.create_subscription(String, '/recording/command', self._on_command, 10)
        self._status_pub = self.create_publisher(String, '/recording/status', 10)
        self._status_timer = self.create_timer(1.0, self._publish_status)

        # --- camera pipelines + preview publishers ---
        self.cam_data = {}
        for cam in self.CAMS:
            name, sid = cam['name'], cam['id']
            d = {}
            d['pub_raw'] = self.create_publisher(CompressedImage, f'/jetson/{name}/image_raw/compressed', 1)
            if not no_undistort:
                d['pub_ud'] = self.create_publisher(CompressedImage, f'/jetson/{name}/image_undistorted/compressed', 1)

            p = Gst.parse_launch(_pipe(sid, pub_w, pub_h, fps))
            d['sink'] = p.get_by_name('sink')
            p.set_state(Gst.State.PLAYING)
            d['pipe'] = p
            d['maps'] = None if no_undistort else load_maps(cam['calib'], pub_w, pub_h)
            d['frame_n'] = 0

            self.cam_data[name] = d
            t = threading.Thread(target=self._cam_loop, args=(name,), daemon=True)
            t.start()
            self._threads.append(t)

        self.get_logger().info(f'Camera node started: {pub_w}x{pub_h}@{fps} preview=1/{preview_every} undistort={"OFF" if no_undistort else "ON"}')

    # --- command handler ---
    def _on_command(self, msg):
        try:
            cmd = json.loads(msg.data)
        except Exception:
            return
        action = cmd.get('action', '')
        if action == 'start':
            self._start_recording(cmd)
        elif action == 'stop':
            self._stop_recording()

    def _start_recording(self, cmd):
        with self._rec_lock:
            if self._recording:
                self.get_logger().warn('Already recording')
                return

            company = cmd.get('company', 'default')
            device = cmd.get('device', 'default')
            patrol = cmd.get('patrol', 'patrol')
            rec = cmd.get('recording', 'rec')
            self._rec_identity = {
                'customer_id': company,
                'device_id': device,
                'patrol_id': patrol,
                'recording_id': rec,
                'comment': cmd.get('comment', '') or '',
            }
            self._rec_dir = os.path.join(BASE_DIR, company, device, patrol, rec)
            os.makedirs(self._rec_dir, exist_ok=True)

            self._mcap_fh = open(os.path.join(self._rec_dir, 'cameras.mcap'), 'wb')
            self._mcap_writer = Writer(self._mcap_fh)
            self._mcap_writer.start(profile='ros2', library='agrotech-camera-node')

            schema_id = self._mcap_writer.register_schema(
                name=SCHEMA_TEXT, encoding='ros2msg', data=SCHEMA_TEXT.encode())

            self._mcap_channels = {}
            self._rec_counts = {}
            suffixes = ['raw', 'undistorted'] if not self.no_undistort else ['raw']
            for name in self.cam_data:
                for suffix in suffixes:
                    topic = f'/jetson/{name}/image_{suffix}/compressed'
                    ch = self._mcap_writer.register_channel(
                        schema_id=schema_id, topic=topic, message_encoding='cdr')
                    self._mcap_channels[f'{name}_{suffix}'] = ch
                    self._rec_counts[topic] = 0

            self._rec_start = time.time()
            self._recording = True
            self.get_logger().info(f'Recording started → {self._rec_dir}')
            alog('info', 'camera_node', 'camera.recording.started',
                 customer=company, device=device, patrol=patrol, recording=rec,
                 meta={'dir': self._rec_dir})
            # Push an immediate status message so subscribers (UI ack-wait) see
            # the transition without waiting for the next 1s timer tick.
            try:
                self._publish_status()
            except Exception:
                pass

    def _stop_recording(self):
        with self._rec_lock:
            if not self._recording:
                return
            self._recording = False

            # Embed metadata in MCAP
            duration = round(time.time() - self._rec_start, 2)
            recording_meta = {
                "start_time": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(self._rec_start)),
                "end_time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "duration_sec": str(duration),
                "resolution": f"{self.pub_w}x{self.pub_h}",
                "fps": str(self.fps),
                "undistort": str(not self.no_undistort),
            }
            for k, v in (getattr(self, '_rec_identity', None) or {}).items():
                recording_meta[k] = "" if v is None else str(v)
            self._mcap_writer.add_metadata(name="recording", data=recording_meta)
            calib = read_calib_profile()
            if calib:
                self._mcap_writer.add_metadata(name="calibration", data={
                    k: json.dumps(v) for k, v in calib.items()
                })
            self._mcap_writer.add_metadata(name="topics", data={
                t: json.dumps({"type": SCHEMA_TEXT, "frames": c}) for t, c in self._rec_counts.items()
            })
            self._mcap_writer.finish()
            self._mcap_fh.close()

            # write metadata.json
            meta = {
                **(getattr(self, '_rec_identity', None) or {}),
                'start_time': time.strftime('%Y-%m-%dT%H:%M:%S%z', time.localtime(self._rec_start)),
                'end_time': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                'duration_sec': round(time.time() - self._rec_start, 2),
                'resolution': f'{self.pub_w}x{self.pub_h}',
                'topics': {t: {'type': SCHEMA_TEXT, 'frames': c} for t, c in self._rec_counts.items()},
                'calibration_profile': read_calib_profile(),
            }
            with open(os.path.join(self._rec_dir, 'cameras_metadata.json'), 'w') as f:
                json.dump(meta, f, indent=2)

            total = sum(self._rec_counts.values())
            self.get_logger().info(f'Recording stopped: {total} frames → {self._rec_dir}')
            ident = getattr(self, '_rec_identity', None) or {}
            alog('info', 'camera_node', 'camera.recording.stopped',
                 customer=ident.get('customer_id'), device=ident.get('device_id'),
                 patrol=ident.get('patrol_id'), recording=ident.get('recording_id'),
                 meta={'frames': total, 'duration_sec': duration})
            self._mcap_writer = None
            self._mcap_fh = None
            try:
                self._publish_status()
            except Exception:
                pass

    def _publish_status(self):
        with self._rec_lock:
            if self._recording:
                elapsed = round(time.time() - self._rec_start, 1)
                total = sum(self._rec_counts.values())
                data = {'state': 'recording', 'elapsed': elapsed, 'total': total, 'counts': self._rec_counts, 'dir': self._rec_dir}
            else:
                ud_bytes = None
                data = {'state': 'idle'}
        msg = String()
        msg.data = json.dumps(data)
        self._status_pub.publish(msg)

    # --- camera loop ---
    def _cam_loop(self, name):
        d = self.cam_data[name]
        interval = 1.0 / self.fps
        no_frame_count = 0

        while self._running and rclpy.ok():
            t0 = time.monotonic()

            sample = d['sink'].emit('try-pull-sample', 0)
            if sample is None:
                no_frame_count += 1
                if no_frame_count > self.fps * 5:
                    self.get_logger().warn(f'{name}: no frames for 5s, disabling')
                    d['pipe'].set_state(Gst.State.NULL)
                    return
                time.sleep(interval)
                continue
            no_frame_count = 0

            buf = sample.get_buffer()
            ok, mi = buf.map(Gst.MapFlags.READ)
            if not ok:
                continue
            bgr = np.frombuffer(mi.data, dtype=np.uint8).reshape(self.pub_h, self.pub_w, 4)[:, :, :3].copy()
            buf.unmap(mi)

            ts_ns = time.time_ns()
            d['frame_n'] += 1

            # JPEG encode raw
            _, jbuf = cv2.imencode('.jpg', bgr, ENCODE_PARAMS)
            raw_bytes = jbuf.tobytes()

            # undistort
            if not self.no_undistort and d['maps'] is not None:
                ud = cv2.remap(bgr, d['maps'][0], d['maps'][1], cv2.INTER_LINEAR)
                _, ubuf = cv2.imencode('.jpg', ud, ENCODE_PARAMS)
                ud_bytes = ubuf.tobytes()
            else:
                ud_bytes = None


            # --- MCAP write (every frame, no ROS2 overhead) ---
            with self._rec_lock:
                if self._recording and self._mcap_writer:
                    ch_raw = self._mcap_channels.get(f'{name}_raw')
                    ch_ud = self._mcap_channels.get(f'{name}_undistorted')
                    if ch_raw is not None:
                        self._mcap_writer.add_message(channel_id=ch_raw, log_time=ts_ns, publish_time=ts_ns, data=raw_bytes)
                        self._rec_counts[f'/jetson/{name}/image_raw/compressed'] += 1
                    if ch_ud is not None and ud_bytes is not None:
                        self._mcap_writer.add_message(channel_id=ch_ud, log_time=ts_ns, publish_time=ts_ns, data=ud_bytes)
                        self._rec_counts[f'/jetson/{name}/image_undistorted/compressed'] += 1

            # --- ROS2 preview (every Nth frame) ---
            if d['frame_n'] % self.preview_every == 0:
                stamp = self.get_clock().now().to_msg()
                msg = CompressedImage()
                msg.header.stamp = stamp
                msg.header.frame_id = f'{name}_raw'
                msg.format = 'jpeg'
                msg.data = raw_bytes
                d['pub_raw'].publish(msg)
                # undistorted preview
                if ud_bytes is not None and ud_bytes != raw_bytes:
                    ud_msg = CompressedImage()
                    ud_msg.header.stamp = stamp
                    ud_msg.header.frame_id = f'{name}_undistorted'
                    ud_msg.format = 'jpeg'
                    ud_msg.data = ud_bytes
                    d['pub_ud'].publish(ud_msg)

            elapsed = time.monotonic() - t0
            if elapsed < interval:
                time.sleep(interval - elapsed)

    def destroy_node(self):
        self._running = False
        with self._rec_lock:
            if self._recording:
                self._stop_recording()
        for t in self._threads:
            t.join(timeout=3)
        for d in self.cam_data.values():
            d['pipe'].set_state(Gst.State.NULL)
        super().destroy_node()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--width', type=int, default=1920)
    parser.add_argument('--height', type=int, default=1080)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--preview-every', type=int, default=5)
    parser.add_argument('--no-undistort', action='store_true')
    parser.add_argument('--jpeg-quality', type=int, default=85)
    parsed, ros_args = parser.parse_known_args()

    global ENCODE_PARAMS
    ENCODE_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, parsed.jpeg_quality]

    rclpy.init(args=ros_args)
    node = CameraNode(parsed.width, parsed.height, parsed.fps, parsed.preview_every, parsed.no_undistort)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
