import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import server

class PublicDataTests(unittest.TestCase):
    def test_pool_estimate_and_no_addresses(self):
        data = {'sidechain': {'consensus': {'block_time':30}, 'difficulty':3000, 'window':{'miners':5,'blocks':10,'uncles':2},'height':42,'timestamp':100,'effort':{'current':23}}, 'mainchain':{'height':15}}
        normalized = server.normalize('info',data)
        self.assertEqual(normalized['hashrate'],100)
        data['sidechain']['consensus']['block_time']=0
        with self.assertRaises(ValueError): server.normalize('info',data)

    def test_reward_keeps_atomic_units_without_miner_fields(self):
        raw = [{'main_block': {'height':1,'timestamp':100,'reward':623641680000,'id':'a'*64,'coinbase_private_key':'excluded'},'window_outputs':49,'miner_address':'excluded'}]
        value=server.normalize('blocks',raw)
        self.assertEqual(value[0]['reward_atomic']/1e12,0.62364168)
        self.assertNotIn('excluded',json.dumps(value))

    def test_failure_retains_timestamp_and_marks_stale(self):
        old={'data':[{'height':1}], 'fetched_at':10,'error':None}
        with patch.dict(server.SNAPSHOT['main'],{'shares':old}), patch('urllib.request.urlopen',side_effect=TimeoutError):
            _,_,value=server.fetch('main','shares')
        self.assertEqual(value['fetched_at'],10)
        self.assertEqual(value['data'],old['data'])
        self.assertIsNotNone(value['error'])

    def test_bad_response_rejected(self):
        with self.assertRaises(ValueError):server.normalize('shares',{})
        with self.assertRaises(ValueError):server.number(float('nan'))
        with self.assertRaises(ValueError):server.number(-1)
        with self.assertRaises(ValueError):server.number(True)

    def test_payout_totals_and_privacy(self):
        raw=[{'index':1,'value':20,'miner_address':'excluded'}, {'index':0,'value':10}]
        block={'outputs':2,'reward_atomic':30}
        result=server.normalize_payouts(raw,block)
        self.assertEqual(result,[{'index':0,'amount_atomic':10},{'index':1,'amount_atomic':20}])
        self.assertNotIn('excluded',json.dumps(result))
        with self.assertRaises(ValueError):server.normalize_payouts(raw,dict(block,reward_atomic=31))
        with self.assertRaises(ValueError):server.normalize_payouts(raw[:1],block)
        with self.assertRaises(ValueError):server.normalize_payouts([raw[0],raw[0]],block)

    def test_unknown_payout_block_is_not_fetched(self):
        with patch('urllib.request.urlopen') as request:
            status,_=server.get_payouts('main','a'*64)
            self.assertEqual(status,404)
            request.assert_not_called()

    def test_stats_use_private_upstream_without_public_fallback(self):
        with patch.dict(server.UPSTREAMS, {'main':'http://127.0.0.1:28801'}), patch('urllib.request.urlopen',side_effect=TimeoutError) as request:
            server.fetch('main','info')
        self.assertEqual(request.call_count,1)
        self.assertEqual(request.call_args.args[0].full_url,'http://127.0.0.1:28801/api/pool_info')

    def test_payouts_use_private_upstream(self):
        block={'id':'b'*64,'outputs':1,'reward_atomic':10,'height':1}
        with patch.dict(server.SNAPSHOT['main'],{'blocks':{'data':[block]}}), patch.dict(server.UPSTREAMS,{'main':'http://127.0.0.1:28801'}), patch('urllib.request.urlopen',side_effect=TimeoutError) as request:
            status,_=server.get_payouts('main','b'*64)
        self.assertEqual(status,502)
        self.assertEqual(request.call_count,1)
        self.assertEqual(request.call_args.args[0].full_url,'http://127.0.0.1:28801/api/block_by_id/'+('b'*64)+'/coinbase')

    def test_chain_routes_and_unchanged_homepage(self):
        import threading
        import urllib.request
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        worker = threading.Thread(target=http.serve_forever, daemon=True)
        worker.start()
        try:
            base = f'http://127.0.0.1:{http.server_port}'
            with urllib.request.urlopen(base + '/') as response:
                self.assertEqual(response.read(), (server.ROOT/'index.html').read_bytes())
            for chain in server.POOLS:
                for suffix in ['', '/']:
                    with urllib.request.urlopen(base + '/' + chain + suffix) as response:
                        page = response.read().decode()
                    self.assertEqual(page.count('class="chain-dashboard"'), 1)
                    self.assertEqual(page.count('<details class="payouts">'), 1)
                    self.assertIn(f'id="chain-{chain}"', page)
                    self.assertIn(f'href="https://p2pool.monero.love/{chain}"', page)
                    self.assertIn(f'.onion/{chain}"', page)
                    for other in set(server.POOLS) - {chain}:
                        self.assertNotIn(f'id="chain-{other}"', page)
                        self.assertNotIn(f'id="rate-{other}"', page)
        finally:
            http.shutdown()
            http.server_close()
            worker.join()

    def test_standalone_page(self):
        page=(server.ROOT/'index.html').read_text()
        self.assertNotIn('<header',page)
        self.assertNotIn('<footer',page)
        self.assertNotIn('<form',page)
        self.assertIn('https://p2pool.monero.love/',page)
        self.assertEqual(page.count('<details class="payouts">'),3)
        self.assertEqual(page.count('</details>'),3)

if __name__=='__main__':unittest.main()
