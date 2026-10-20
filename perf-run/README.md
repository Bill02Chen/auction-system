# Benchmark runs

This directory holds the load-test scripts, the environment fingerprint and the
raw logs behind the numbers in the top-level README. It is kept in the repository
so the results can be checked, not just quoted.

## Requirements

- MySQL container from `docker-compose.yml` (name `auction-master-mysql`)
- Redis reachable at the address in `backend/.env`
- backend running on `http://localhost:3002`
- `MYSQL_PASSWORD` set to the MySQL root password

```sh
export MYSQL_PASSWORD=your-password
bash perf-run/run-loadtest.sh paced 1000 3 50
bash perf-run/run-loadtest.sh burst 1000 3 0
```

## Scripts

| File | Purpose |
| --- | --- |
| `run-loadtest.sh` | orchestrator: environment fingerprint → reset auction → reset metrics → run client → capture metrics |
| `env-fingerprint.sh` | OS, CPU, Node, Redis instance (pid/port/version), MySQL version, container list |
| `verify-ranking-recovery.sh` | Redis outage / ranking rebuild drill |
| `verify-price-no-rollback.sh` | price monotonicity check |
| `run-drill.sh`, `run-drill2.sh` | outage drills |
| `keysampler2.sh`, `keysampler3.sh` | sample auction keys during a drill |
| `test-300u.js` | smaller 300-user client used as a control |

The load client itself is `backend/test-high-concurrency.js`; it reads
`CONCURRENT_USERS`, `BIDS_PER_USER`, `PACE_MS` and `SERVER_URL`.

## Key logs

| Log | What it shows |
| --- | --- |
| `logs/20261011-005757-paced-lua-final-1000u-x3.log` | final paced run: 3000/3000, 9.32 ms avg, P99 49 ms |
| `logs/20261011-005706-burst-lua-bidder-1000u-x3.log` | final same-ms burst: 3000/3000, 199.59 ms avg, 7,000 broadcast messages |
| `logs/20261011-005619-burst-lua-1000u-x3.log` | Lua without bidder-only broadcast: 1564/3000, 3,018,000 messages |
| `logs/20261011-002220-burst-1000u-x3-pace0.log` | original lock engine: 0/3000 in the same-ms burst |
| `logs/20261011-000226-baseline-fixed-1000u-x3.log` | post-fix paced run: 2692/2700, 9.31 ms |
| `logs/20261011-000639-baseline-fixed-r2-1000u-x3.log` | post-fix paced run: 2714/2715, 8.68 ms |

The client count can drift when connections time out; the logs report both the
planned total and the actual bids. Compare runs using the same denominator.

## What these numbers are not

- Not a production SLA. Single machine, client-side latency, one Node client.
- Not a Redis cluster or multi-instance test.
- The original 98.40% failure sample was "failed to acquire the distributed
  lock"; later reruns did not reproduce the 1.6% loss. Both values are kept in
  the README instead of replacing one with the other.
