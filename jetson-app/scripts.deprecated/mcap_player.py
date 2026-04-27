#!/usr/bin/env python3
"""MCAP playback — auto-discovers all *.mcap files in a recording directory and
republishes their messages on /playback/* topics in real time.

Supports both:
  - sensor recordings (combined.mcap + sensors_metadata.json or metadata.json)
  - camera recordings (cameras.mcap + cameras_metadata.json)
  - mixed (both files present)
"""
import argparse, json, os, signal, sys, time, threading, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from agrotech_log import log as alog
except Exception:
    def alog(*args, **kwargs): pass
import rclpy
from rclpy.node import Node
from rclpy.serialization import deserialize_message
from rosidl_runtime_py.utilities import get_message
from mcap.reader import make_reader

TOPIC_MAP = {
    '/jetson/cam0/image_raw/compressed': '/playback/cam0/raw/compressed',
    '/jetson/cam1/image_raw/compressed': '/playback/cam1/raw/compressed',
    '/jetson/cam0/image_undistorted/compressed': '/playback/cam0/processed/compressed',
    '/jetson/cam1/image_undistorted/compressed': '/playback/cam1/processed/compressed',
}

# camera_node.py writes raw JPEG bytes (not CDR-serialized CompressedImage messages)
# into the MCAP for performance. The player must wrap them on the way out.
RAW_JPEG_TYPES = {'sensor_msgs/msg/CompressedImage', 'sensor_msgs/CompressedImage'}


def log(data):
    print(json.dumps(data), flush=True)


def load_metadata(rec_dir):
    """Merge any of the metadata.json variants we know about."""
    topics = {}
    for name in ('metadata.json', 'sensors_metadata.json', 'cameras_metadata.json'):
        fp = os.path.join(rec_dir, name)
        if not os.path.isfile(fp):
            continue
        try:
            with open(fp) as f:
                meta = json.load(f)
        except Exception:
            continue
        for topic, info in (meta.get('topics') or {}).items():
            topics[topic] = info
    return topics


def load_messages(rec_dir):
    """Read every *.mcap in the recording dir, merged and sorted by log_time."""
    topic_meta = load_metadata(rec_dir)
    msgs = []

    mcap_files = sorted(glob.glob(os.path.join(rec_dir, '*.mcap')))
    if not mcap_files:
        return msgs

    for fp in mcap_files:
        try:
            with open(fp, 'rb') as f:
                for schema, channel, message in make_reader(f).iter_messages():
                    info = topic_meta.get(channel.topic) or {}
                    msg_type = info.get('type') or (schema.name if schema else None)
                    if not msg_type:
                        continue
                    msgs.append((message.log_time, channel.topic, message.data, msg_type))
        except Exception as e:
            log({'stage': 'warn', 'message': f'Could not read {os.path.basename(fp)}: {e}'})

    msgs.sort(key=lambda x: x[0])
    return msgs


def main():
    parser = argparse.ArgumentParser()
    # Preferred: --path <recording_dir>. Legacy: --patrol/--recording for back-compat.
    parser.add_argument('--path', default=None, help='Absolute path to the recording directory')
    parser.add_argument('--patrol', default=None)
    parser.add_argument('--recording', default=None)
    parser.add_argument('--base', default='/AgroTech_recordings')
    parser.add_argument('--speed', type=float, default=1.0)
    args = parser.parse_args()

    if args.path:
        rec_dir = args.path
    elif args.patrol and args.recording:
        rec_dir = os.path.join(args.base, args.patrol, args.recording)
    else:
        log({'stage': 'error', 'message': 'Either --path or --patrol+--recording is required'})
        return

    if not os.path.isdir(rec_dir):
        log({'stage': 'error', 'message': f'Recording directory not found: {rec_dir}'})
        return

    log({'stage': 'loading', 'message': f'Loading MCAP files from {rec_dir}'})
    # Best-effort: parse the recording dir into ids for log correlation.
    parts = [p for p in rec_dir.split(os.sep) if p]
    ids = {'customer': parts[1], 'device': parts[2], 'patrol': parts[3], 'recording': parts[4]} if len(parts) >= 5 and parts[0] == 'AgroTech_recordings' else {}
    alog('info', 'mcap_player', 'player.start', meta={'path': rec_dir}, **ids)
    msgs = load_messages(rec_dir)
    if not msgs:
        log({'stage': 'error', 'message': 'No messages found in recording'})
        alog('error', 'mcap_player', 'player.no_messages', meta={'path': rec_dir}, **ids)
        return

    total = len(msgs)
    duration_ns = msgs[-1][0] - msgs[0][0]
    log({'stage': 'ready', 'total_frames': total, 'duration_sec': round(duration_ns / 1e9, 2)})

    rclpy.init()
    node = Node('mcap_player')

    pubs = {}
    msg_classes = {}
    for _, topic, _, msg_type in msgs:
        if topic in pubs:
            continue
        try:
            cls = get_message(msg_type)
        except Exception as e:
            log({'stage': 'warn', 'message': f'Skipping {topic} ({msg_type}): {e}'})
            continue
        pb_topic = TOPIC_MAP.get(topic, '/playback' + topic)
        pubs[topic] = node.create_publisher(cls, pb_topic, 10)
        msg_classes[topic] = cls

    log({'stage': 'playing', 'topics': list(pubs.keys()), 'total': total})

    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())

    t0_real = time.monotonic()
    t0_msg = msgs[0][0]
    played = 0

    deserialize_failures = {}
    for log_time, topic, raw_data, msg_type in msgs:
        if stop.is_set():
            break
        if topic not in pubs:
            continue

        elapsed_msg = (log_time - t0_msg) / 1e9
        target_real = elapsed_msg / max(args.speed, 0.1)
        now = time.monotonic() - t0_real
        if target_real > now:
            time.sleep(target_real - now)

        try:
            cls = msg_classes[topic]
            if msg_type in RAW_JPEG_TYPES:
                # MCAP holds raw JPEG bytes — wrap into CompressedImage in-process.
                msg = cls()
                msg.format = 'jpeg'
                msg.data = list(raw_data) if not isinstance(raw_data, (bytes, bytearray)) else raw_data
                # rclpy expects array.array('B', ...) or bytes for uint8[] fields; bytes works.
                if not isinstance(msg.data, (bytes, bytearray)):
                    msg.data = bytes(raw_data)
                # Stamp from the recorded log_time (ns since epoch).
                msg.header.stamp.sec = int(log_time // 1_000_000_000)
                msg.header.stamp.nanosec = int(log_time % 1_000_000_000)
                msg.header.frame_id = topic.strip('/').replace('/', '_')
            else:
                msg = deserialize_message(raw_data, cls)
            pubs[topic].publish(msg)
            played += 1
        except Exception as e:
            deserialize_failures[topic] = repr(e)

        if played and played % 50 == 0:
            log({'stage': 'playing', 'frame': played, 'total': total, 'pct': round(played * 100 / total, 1)})

    if deserialize_failures:
        log({'stage': 'warn', 'message': 'Some messages failed to publish', 'errors': deserialize_failures})

    log({'stage': 'done', 'message': 'Playback finished', 'frames_played': played})
    alog('info', 'mcap_player', 'player.done', meta={'frames_played': played, 'total': total}, **ids)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
