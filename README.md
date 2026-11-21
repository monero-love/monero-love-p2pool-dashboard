# Monero Love P2Pool web dashboard

Standalone Python and browser application from the workspace implementation described in [A public dashboard for P2Pool shares and payouts](https://monero.love/news/p2pool-dashboard/) and [How we collect P2Pool statistics and verify payouts](https://monero.love/news/how-we-collect-p2pool-statistics-and-verify-payouts/).

This is the web application, not a Grafana dashboard. It shows Main, Mini and Nano, with single-chain routes at `/main`, `/mini` and `/nano`, recent shares, block rewards and verified payout output totals. The companion [P2Pool Grafana repository](https://git.hyve.sh/baz/monero-love-p2pool-monitoring) monitors local daemon metrics instead.

## Run locally

Python 3.10 or newer is required. The server uses the standard library and listens on 127.0.0.1:8792. Node.js is needed only for JavaScript checks.

Configure three compatible P2Pool observer APIs, one for each sidechain. The example loopback ports are placeholders for your own observer endpoints or authenticated SSH forwards. This repository does not establish SSH tunnels, create observers or provide database credentials.

```sh
set -a
. ./p2pool-dashboard.env.example
set +a
python3 server.py --port 8792
```

Open `http://127.0.0.1:8792/`. Without reachable observer APIs, the application shows unavailable data. There is no public-observer fallback.

Each observer must implement `/api/pool_info`, `/api/shares?limit=60`, `/api/found_blocks?limit=60` and `/api/block_by_id/BLOCK_ID/coinbase` with the schemas consumed by `server.py`. See the [upstream observer API](https://git.gammaspectra.live/P2Pool/observer). A monerod RPC endpoint is not a substitute for this API.

## Optional systemd installation

Install the application and static directory under `/opt/p2pool-dashboard`. Copy the edited environment example to `/etc/p2pool-dashboard.env`, install `p2pool-dashboard.service` in `/etc/systemd/system`, reload systemd and start the service after confirming observer connectivity. The service uses a dynamic unprivileged account. Place your own TLS reverse proxy in front of the loopback listener when public access is needed. Production proxy and SSH configuration are intentionally not included.

The copied static HTML retains Monero Love branding, canonical links and onion links. Replace these with your own identity before publishing a separate site. This repository does not deploy or modify monero.love. Displayed timestamps have been adapted to UTC.

## Checks and limits

```sh
python3 -m unittest -v test_server.py
node --check static/app.js
```

`test_app.cjs` accepts an API snapshot as its first argument and optionally `main`, `mini` or `nano` as its second. The packaging checks use a synthetic snapshot with 60 shares and 20 blocks per chain. Backend tests use synthetic fixtures and mocked upstream failures. These checks do not establish live observer compatibility or browser layout correctness.

`SOURCE.json` records original workspace file hashes and packaged hashes. Deployment scripts, SSH material, internal host inventories, historical reports and production secrets are not included.
