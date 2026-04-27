#!/usr/bin/env python3
"""Extract camera frames from an AgroTech recording's cameras.mcap.

Usage:
    extract_frames.py <recording_dir> [--topic TOPIC] [--every N] [--out OUT_DIR]

Defaults:
    - extracts all camera topics found in the file
    - every 1 frame (use --every 5 to subsample)
    - writes to <recording_dir>/frames/<topic_slug>/frame_NNNNN.jpg

camera_node.py writes raw JPEG bytes directly to MCAP messages (no CDR header),
so each message body is already a complete JPEG file.

Uses StreamReader (forward-only) so partial/truncated mcap files still extract
whatever messages the file actually contains, without needing a valid footer.
"""
import argparse, sys
from pathlib import Path
from mcap.stream_reader import StreamReader

CAMERA_TYPE = 'sensor_msgs/msg/CompressedImage'


def slug(topic):
    return topic.strip('/').replace('/', '_')


def extract(rec_dir, topic_filter, every, out_root):
    mcap_path = rec_dir / 'cameras.mcap'
    if not mcap_path.is_file():
        print(f'No cameras.mcap in {rec_dir}', file=sys.stderr)
        return 1

    schemas = {}     # id -> Schema
    channels = {}    # id -> Channel
    counts = {}      # topic -> written
    saw = {}         # topic -> seen total
    out_dirs = {}    # topic -> Path
    fatal = None

    with open(mcap_path, 'rb') as f:
        sr = StreamReader(f)
        try:
            for rec in sr.records:
                cn = rec.__class__.__name__
                if cn == 'Schema':
                    schemas[rec.id] = rec
                    continue
                if cn == 'Channel':
                    channels[rec.id] = rec
                    continue
                if cn != 'Message':
                    continue
                ch = channels.get(rec.channel_id)
                if ch is None:
                    continue
                sch = schemas.get(ch.schema_id) if ch.schema_id else None
                if sch is None or sch.name != CAMERA_TYPE:
                    continue
                topic = ch.topic
                if topic_filter and topic != topic_filter:
                    continue
                saw[topic] = saw.get(topic, 0) + 1
                if (saw[topic] - 1) % every != 0:
                    continue
                if topic not in out_dirs:
                    d = out_root / slug(topic)
                    d.mkdir(parents=True, exist_ok=True)
                    out_dirs[topic] = d
                    counts[topic] = 0
                idx = counts[topic]
                fpath = out_dirs[topic] / f'frame_{idx:05d}.jpg'
                with open(fpath, 'wb') as imgf:
                    imgf.write(rec.data)
                counts[topic] += 1
                if counts[topic] % 200 == 0:
                    print(f'  {topic}: {counts[topic]} frames written', file=sys.stderr)
        except Exception as e:
            fatal = e

    print('')
    print(f'Output root: {out_root}')
    for t in sorted(saw):
        print(f'  {t}: saw {saw[t]}, wrote {counts.get(t, 0)}')
    if fatal:
        print(f'(stream ended early — file likely truncated: {type(fatal).__name__})', file=sys.stderr)
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument('recording_dir', type=Path, help='Path to a recording dir containing cameras.mcap')
    p.add_argument('--topic', default=None, help='Only extract this camera topic')
    p.add_argument('--every', type=int, default=1, help='Keep 1 of every N frames (default 1 = all)')
    p.add_argument('--out', type=Path, default=None, help='Output root (default: <rec>/frames/)')
    args = p.parse_args()

    rec = args.recording_dir.resolve()
    if not rec.is_dir():
        print(f'Not a directory: {rec}', file=sys.stderr)
        sys.exit(1)
    out = args.out or (rec / 'frames')
    out.mkdir(parents=True, exist_ok=True)
    sys.exit(extract(rec, args.topic, max(1, args.every), out))


if __name__ == '__main__':
    main()
