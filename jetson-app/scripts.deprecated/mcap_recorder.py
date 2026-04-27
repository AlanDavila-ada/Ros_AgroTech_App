#!/usr/bin/env python3
"""Generic MCAP recorder — records all ROS2 topics into a single combined.mcap."""
import argparse, json, os, signal, sys, time, threading, yaml
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from rclpy.serialization import serialize_message
from rosidl_runtime_py.utilities import get_message
from mcap.writer import Writer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from agrotech_log import log as alog
except Exception:
    def alog(*args, **kwargs): pass


def log(data):
    print(json.dumps(data), flush=True)


def read_calib_profile():
    info = {}
    for cid in [0, 1]:
        path = os.path.expanduser(f"~/cam{cid}.yaml")
        if os.path.isfile(path):
            try:
                with open(path) as f:
                    c = yaml.safe_load(f)
                K = c.get("camera_matrix", {}).get("data", [])
                D = c.get("distortion_coefficients", {}).get("data", [])
                info[f"cam{cid}"] = {
                    "fx": round(K[0], 2) if len(K) > 0 else None,
                    "fy": round(K[4], 2) if len(K) > 4 else None,
                    "cx": round(K[2], 2) if len(K) > 2 else None,
                    "cy": round(K[5], 2) if len(K) > 5 else None,
                    "distortion": [round(d, 6) for d in D],
                    "model": c.get("distortion_model", "unknown"),
                }
            except:
                pass
    return info if info else None


def parse_topics_arg(arg):
    """Parse 'topic1:type1,topic2:type2' or 'topic1,topic2' (legacy)."""
    result = []
    for entry in arg.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if ":" in entry:
            parts = entry.split(":", 1)
            t = parts[1].strip()
            if "/msg/" not in t and "/" in t:
                pkg, name = t.split("/", 1)
                t = f"{pkg}/msg/{name}"
            result.append((parts[0].strip(), t))
        else:
            result.append((entry, None))
    return result


class GenericRecorder(Node):
    def __init__(self, out_dir, topic_pairs, identity=None):
        super().__init__("mcap_recorder")
        self.out_dir = out_dir
        self.identity = identity or {}
        self.lock = threading.Lock()
        self.start_time = time.time()
        self.start_iso = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        self.topic_info = {}
        self._total = 0

        # Single combined MCAP file
        os.makedirs(out_dir, exist_ok=True)
        self.mcap_path = os.path.join(out_dir, "combined.mcap")
        self.mcap_fh = open(self.mcap_path, "wb")
        self.writer = Writer(self.mcap_fh)
        self.writer.start(profile="ros2", library="agrotech-recorder")

        qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=10,
            durability=DurabilityPolicy.VOLATILE,
        )

        graph_types = dict(self.get_topic_names_and_types())

        for topic, type_str in topic_pairs:
            if not type_str:
                types = graph_types.get(topic)
                if types:
                    type_str = types[0]
                else:
                    log({"stage": "warn", "message": f"Topic {topic} not on graph, skipping"})
                    continue

            try:
                msg_class = get_message(type_str)
            except Exception as e:
                log({"stage": "warn", "message": f"Cannot load {type_str} for {topic}: {e}"})
                continue

            schema_id = self.writer.register_schema(
                name=type_str, encoding="ros2msg", data=type_str.encode()
            )
            channel_id = self.writer.register_channel(
                schema_id=schema_id, topic=topic, message_encoding="cdr"
            )

            self.topic_info[topic] = {
                "channel_id": channel_id,
                "count": 0,
                "type_str": type_str,
                "msg_class": msg_class,
            }

            self.create_subscription(
                msg_class, topic, lambda msg, t=topic: self._cb(t, msg), qos
            )
            self.get_logger().info(f"Recording {topic} [{type_str}]")

        if not self.topic_info:
            log({"stage": "error", "message": "No valid topics to record"})
            return

        log({
            "stage": "recording",
            "message": f"Recording {len(self.topic_info)} topics -> {self.mcap_path}",
            "topics": {t: i["type_str"] for t, i in self.topic_info.items()},
        })

    def _cb(self, topic, msg):
        with self.lock:
            info = self.topic_info[topic]
            t_ns = self.get_clock().now().nanoseconds
            data = serialize_message(msg)
            self.writer.add_message(
                channel_id=info["channel_id"],
                log_time=t_ns,
                publish_time=t_ns,
                data=data,
            )
            info["count"] += 1
            self._total += 1
            if self._total % 500 == 0:
                log({
                    "stage": "recording",
                    "counts": {t: i["count"] for t, i in self.topic_info.items()},
                    "total": self._total,
                })

    def finish(self):
        end_time = time.time()
        end_iso = time.strftime("%Y-%m-%dT%H:%M:%S%z")
        # Embed metadata in MCAP
        with self.lock:
            topic_meta = {}
            for topic, info in self.topic_info.items():
                topic_meta[topic] = json.dumps({"type": info["type_str"], "count": info["count"]})
            recording_meta = {
                "start_time": self.start_iso,
                "end_time": end_iso,
                "duration_sec": str(round(end_time - self.start_time, 2)),
            }
            # MCAP metadata values must be strings — serialize anything non-string.
            for k, v in (self.identity or {}).items():
                recording_meta[k] = "" if v is None else str(v)
            self.writer.add_metadata(name="recording", data=recording_meta)
            self.writer.add_metadata(name="topics", data=topic_meta)
            self.writer.finish()
            self.mcap_fh.close()

        meta = {
            **(self.identity or {}),
            "start_time": self.start_iso,
            "end_time": end_iso,
            "duration_sec": round(end_time - self.start_time, 2),
            "topics": {},
            "calibration_profile": read_calib_profile(),
        }
        for topic, info in self.topic_info.items():
            meta["topics"][topic] = {
                "type": info["type_str"],
                "frames": info["count"],
            }

        with open(os.path.join(self.out_dir, "sensors_metadata.json"), "w") as f:
            json.dump(meta, f, indent=2)

        log({
            "stage": "done",
            "message": f"Saved {sum(i['count'] for i in self.topic_info.values())} total messages to combined.mcap",
            "counts": {t: i["count"] for t, i in self.topic_info.items()},
        })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--patrol", required=True)
    parser.add_argument("--recording", required=True)
    parser.add_argument("--topics", required=True)
    parser.add_argument("--comment", default="")
    parser.add_argument("--base", default="/AgroTech_recordings")
    args = parser.parse_args()

    topic_pairs = parse_topics_arg(args.topics)
    out_dir = os.path.join(args.base, args.company, args.device, args.patrol, args.recording)
    os.makedirs(out_dir, exist_ok=True)

    identity = {
        "customer_id": args.company,
        "device_id": args.device,
        "patrol_id": args.patrol,
        "recording_id": args.recording,
        "comment": args.comment,
    }

    rclpy.init()
    node = GenericRecorder(out_dir, topic_pairs, identity=identity)

    if not node.topic_info:
        alog('error', 'mcap_recorder', 'recorder.no_topics',
             customer=identity['customer_id'], device=identity['device_id'],
             patrol=identity['patrol_id'], recording=identity['recording_id'])
        node.destroy_node()
        rclpy.shutdown()
        return

    alog('info', 'mcap_recorder', 'recorder.started',
         customer=identity['customer_id'], device=identity['device_id'],
         patrol=identity['patrol_id'], recording=identity['recording_id'],
         meta={'topics': len(node.topic_info), 'comment': identity.get('comment') or ''})

    stop = threading.Event()

    def handler(sig, frame):
        log({"stage": "stopping", "message": "Stopping recorder..."})
        stop.set()

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)

    try:
        while not stop.is_set():
            rclpy.spin_once(node, timeout_sec=0.1)
    except Exception as e:
        alog('error', 'mcap_recorder', 'recorder.crash',
             customer=identity['customer_id'], device=identity['device_id'],
             patrol=identity['patrol_id'], recording=identity['recording_id'],
             meta={'error': repr(e)})
        raise
    finally:
        node.finish()
        total = sum(i['count'] for i in node.topic_info.values())
        alog('info', 'mcap_recorder', 'recorder.stopped',
             customer=identity['customer_id'], device=identity['device_id'],
             patrol=identity['patrol_id'], recording=identity['recording_id'],
             meta={'total_messages': total})
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
