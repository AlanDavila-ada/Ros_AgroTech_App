"""Tiny event-logger shim used by mcap_recorder.py / camera_node.py / mcap_player.py.

Events are POSTed to the local AgroTech bridge at http://localhost:4500/api/log.
Failures are silent (the bridge may be momentarily down on boot) — every event is
also written to stderr as JSON so journald keeps a copy.
"""
import json, os, sys, time
import urllib.request

BRIDGE = os.environ.get('AGROTECH_LOG_URL', 'http://localhost:4500/api/log')


def _post(events):
    try:
        body = json.dumps({'events': events}).encode('utf-8')
        req = urllib.request.Request(BRIDGE, data=body, headers={'Content-Type': 'application/json'}, method='POST')
        urllib.request.urlopen(req, timeout=2).read()
    except Exception:
        pass


def log(level, source, event, **fields):
    """Emit a single event. `fields` may include customer/device/patrol/recording/meta."""
    e = {
        'ts': time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime()) + '.{:03d}Z'.format(int((time.time() % 1) * 1000)),
        'level': level,
        'source': source,
        'event': event,
    }
    for k in ('customer', 'device', 'patrol', 'recording'):
        if fields.get(k):
            e[k] = fields[k]
    if fields.get('meta'):
        e['meta'] = fields['meta']
    # Stderr copy for journald.
    try:
        sys.stderr.write(json.dumps(e) + '\n')
        sys.stderr.flush()
    except Exception:
        pass
    _post([e])
