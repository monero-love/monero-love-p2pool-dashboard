#!/usr/bin/env python3
"""Public P2Pool observer cache. No wallet or miner-specific endpoints."""
import argparse
import concurrent.futures
import json
import math
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import time
import urllib.request

ROOT = Path(__file__).parent / 'static'
POOLS = {'main': 'https://p2pool.observer', 'mini': 'https://mini.p2pool.observer', 'nano': 'https://nano.p2pool.observer'}
UPSTREAMS = {p: os.environ.get(f'P2POOL_{p.upper()}_URL', f'http://127.0.0.1:{28801+i}').rstrip('/') for i, p in enumerate(POOLS)}
ENDPOINTS = {'info': '/api/pool_info', 'shares': '/api/shares?limit=60', 'blocks': '/api/found_blocks?limit=60'}
SNAPSHOT = {p: {'source': url, 'data_source': 'Monero Love'} for p, url in POOLS.items()}
LOCK = threading.Lock()
PAYOUT_CACHE = {}
PAYOUT_LOCK = threading.Lock()
PAYOUT_SLOTS = threading.BoundedSemaphore(3)

def normalize_payouts(data, block):
    if not isinstance(data, list) or not data or len(data) > 3000:
        raise ValueError('Invalid output list')
    outputs = []
    for item in data:
        index, amount = number(item['index']), number(item['value'])
        if not isinstance(index, int) or not isinstance(amount, int):
            raise ValueError('Expected atomic integer amounts and indices')
        outputs.append({'index': index, 'amount_atomic': amount})
    outputs.sort(key=lambda o: o['index'])
    if [o['index'] for o in outputs] != list(range(len(outputs))):
        raise ValueError('Incomplete output indices')
    if len(outputs) != block['outputs'] or sum(o['amount_atomic'] for o in outputs) != block['reward_atomic']:
        raise ValueError('Payout totals do not match block')
    return outputs

def get_payouts(pool, block_id):
    with LOCK:
        blocks = SNAPSHOT.get(pool, {}).get('blocks', {}).get('data') or []
        block = next((dict(b) for b in blocks if b['id'] == block_id), None)
    if block is None:
        return 404, {'error': 'Block is outside the recent observed blocks. Refresh the dashboard.'}
    key = (pool, block_id)
    with PAYOUT_LOCK:
        cached = PAYOUT_CACHE.get(key)
        if cached and time.time() - cached['fetched_at'] < 300:
            return 200, cached
    if not PAYOUT_SLOTS.acquire(blocking=False):
        return 503, {'error': 'Payout requests are busy. Please try again.'}
    try:
        url = UPSTREAMS[pool] + '/api/block_by_id/' + block_id + '/coinbase'
        request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'MoneroLove-P2Pool/1.0 (+https://p2pool.monero.love)'})
        with urllib.request.urlopen(request, timeout=12) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Response too large')
            outputs = normalize_payouts(json.loads(raw), block)
        result = {'block': block_id, 'height': block['height'], 'reward_atomic': block['reward_atomic'],
                  'outputs': outputs, 'fetched_at': int(time.time())}
        with PAYOUT_LOCK:
            if len(PAYOUT_CACHE) >= 180:
                del PAYOUT_CACHE[min(PAYOUT_CACHE, key=lambda k: PAYOUT_CACHE[k]['fetched_at'])]
            PAYOUT_CACHE[key] = result
        return 200, result
    except Exception:
        return 502, {'error': 'Could not verify the complete payout list. Please try again.'}
    finally:
        PAYOUT_SLOTS.release()

def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError('Invalid numeric field')
    return value

def normalize(kind, data):
    if kind == 'info':
        s, m = data['sidechain'], data['mainchain']
        cadence = number(s['consensus']['block_time'])
        if cadence == 0:
            raise ValueError('Invalid cadence')
        return {'hashrate': number(s['difficulty']) / cadence,
                'miners': number(s['window']['miners']), 'shares': number(s['window']['blocks']),
                'uncles': number(s['window']['uncles']), 'height': number(s['height']),
                'timestamp': number(s['timestamp']), 'block_time': cadence,
                'effort': number(s['effort']['current']) if s.get('found', 1) else None, 'main_height': number(m['height'])}
    if not isinstance(data, list):
        raise ValueError('Expected list')
    result = []
    for item in data[:60]:
        if kind == 'shares':
            result.append({'height': number(item['side_height']), 'timestamp': number(item['timestamp']),
                           'difficulty': number(item['difficulty']), 'id': item['template_id']})
        else:
            block = item['main_block']
            result.append({'height': number(block['height']), 'timestamp': number(block['timestamp']),
                           'reward_atomic': number(block['reward']), 'outputs': number(item['window_outputs']),
                           'id': block['id']})
    for item in result:
        if not isinstance(item['id'], str) or len(item['id']) != 64 or any(c not in '0123456789abcdef' for c in item['id']):
            raise ValueError('Invalid block ID')
    return sorted(result, key=lambda x: x['timestamp'], reverse=True)

def fetch(pool, kind):
    url = UPSTREAMS[pool] + ENDPOINTS[kind]
    try:
        request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'MoneroLove-P2Pool/1.0 (+https://p2pool.monero.love)'})
        with urllib.request.urlopen(request, timeout=12) as response:
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError('Response too large')
            data = normalize(kind, json.loads(raw))
        result = {'data': data, 'fetched_at': int(time.time()), 'error': None}
    except Exception:
        with LOCK:
            result = dict(SNAPSHOT[pool].get(kind, {'data': None, 'fetched_at': None}))
        result['error'] = 'Observer request failed'
    return pool, kind, result

def collect():
    with concurrent.futures.ThreadPoolExecutor(max_workers=9) as executor:
        results = list(executor.map(lambda pair: fetch(*pair), [(p, k) for p in POOLS for k in ENDPOINTS]))
    with LOCK:
        for pool, kind, result in results:
            SNAPSHOT[pool][kind] = result

def poll():
    while True:
        collect()
        time.sleep(30)

def chain_page(chain):
    """Render a single chain from the shared homepage without changing that page."""
    page = (ROOT / 'index.html').read_text()
    page = re.sub(r'<section class="chain-dashboard" id="chain-(main|mini|nano)".*?(?=<section class="chain-dashboard"|<noscript>)',
                  lambda m: m.group(0) if m.group(1) == chain else '', page, flags=re.S)
    page = re.sub(r'<a href="#chain-(main|mini|nano)">.*?</a>\n',
                  lambda m: m.group(0) if m.group(1) == chain else '', page)
    page = page.replace('<body>', f'<body data-chain="{chain}">')
    page = page.replace('<title>P2Pool Live', f'<title>P2Pool {chain.title()} Live')
    page = page.replace('statistics for Main, Mini and Nano.', f'statistics for the {chain.title()} sidechain.')
    page = page.replace('href="https://p2pool.monero.love/"', f'href="https://p2pool.monero.love/{chain}"')
    page = re.sub(r'(class="onion-link" href="http://[^"/]+/)', r'\g<1>' + chain, page)
    return page.encode()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        status = 200
        if match := re.fullmatch(r'/api/payouts/(main|mini|nano)/([0-9a-f]{64})', path):
            status, result = get_payouts(*match.groups())
            body, mime = json.dumps(result).encode(), 'application/json'
        elif path == '/api/stats':
            with LOCK:
                body = json.dumps({'now': int(time.time()), 'pools': SNAPSHOT}, allow_nan=False).encode()
            mime = 'application/json'
        elif match := re.fullmatch(r'/(main|mini|nano)/?', path):
            body, mime = chain_page(match.group(1)), 'text/html; charset=utf-8'
        elif path in ['/', '/app.js', '/style.css', '/favicon.svg', '/robots.txt']:
            file = ROOT / ('index.html' if path == '/' else path[1:])
            body = file.read_bytes()
            mime = {'/': 'text/html; charset=utf-8', '/app.js': 'text/javascript; charset=utf-8', '/style.css': 'text/css; charset=utf-8', '/favicon.svg': 'image/svg+xml', '/robots.txt': 'text/plain'}[path]
        else:
            status, body, mime = 404, b'Not found', 'text/plain'
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if path.startswith('/api/') else 'public, max-age=60')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8792)
    args = parser.parse_args()
    threading.Thread(target=poll, daemon=True).start()
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
