# Mac mini launchd operations

This directory contains the frozen host definitions for the 2026 life experiment.
The two resident jobs keep the Web UI and resident loop alive through
`/usr/bin/caffeinate -is`. The maintenance jobs create the daily archive and
check heartbeat health at 00:10 in `Asia/Tokyo`.

Do not install or bootstrap these jobs before the configured birth date. Each
resident definition has `RunAtLoad`, so loading it starts that individual.

## Day 0: 2026-08-01

Run these steps from `/Users/yasut0ra/dev/hachika` in this order:

1. Keep this checkout at the frozen revision for the duration of the experiment:
   `git switch --detach v3-life-1`.
2. Verify dependencies and the freeze: `npm ci`, `npm run build`, `npm test`,
   then `npm run experiment:check`.
3. Create both revision-0 snapshots and immutable birth records in one command:
   `npm run experiment:birth -- --individual A --individual B`.
4. Copy all four plist files to `~/Library/LaunchAgents/`.
5. Load the resident jobs, then the daily maintenance jobs:

   ```sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hachika.life.a.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hachika.life.b.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hachika.life.a.maintenance.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hachika.life.b.maintenance.plist
   ```

6. Wait at least 30 seconds, then run maintenance once for both individuals:

   ```sh
   HACHIKA_DATA_DIR=individuals/a npm run maintain
   HACHIKA_DATA_DIR=individuals/b npm run maintain
   ```

7. Confirm both UIs at `http://127.0.0.1:3042` and
   `http://127.0.0.1:3043`. Complete the remaining checkboxes in both generated
   birth records and commit those records as the first experiment observation.

The project `.env` remains the only secret-bearing file. The launchd jobs set
individual-specific values, while the process loads the common LLM credentials
and frozen model configuration from `.env` in the working directory.

## Health and logs

Inspect a job with `launchctl print gui/$(id -u)/com.hachika.life.a` (replace the
label for the other jobs). Runtime and maintenance logs live under the matching
`individuals/a` or `individuals/b` data root. If
`HACHIKA_MONITOR_WEBHOOK_URL` is present in `.env`, an unhealthy maintenance run
also sends the configured alert.

Do not switch, pull, or rebuild this checkout while the experiment is running.
Use a separate worktree for later development. Do not load the same individual
from a second shell: the resident lock will reject it, but repeated attempts make
the operating history harder to audit.

## Stop or uninstall

Stop jobs with `launchctl bootout`, using the same four plist paths. This stops
their processes but preserves all individual data. Removing a plist does not
delete snapshots. Never reset an individual to recover from an operational
problem; document the outage and restore from the daily archive only when the
current snapshot is unreadable.
