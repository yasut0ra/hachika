# Birth record: <individual-id> / <name>

## Identity

- Analysis ID: `<A-or-B>`
- Name: `<name>`
- Condition: `<warm-or-quiet>`
- Born at: `<ISO-8601-with-time-zone>`
- Data root: `<HACHIKA_DATA_DIR>`
- Daily event seed: `<HACHIKA_INDIVIDUAL_ID>`

## Frozen implementation

- Git tag: `v3-life-1`
- Git revision: `<full-git-sha>`
- Snapshot schema: `34`
- Experiment config: `docs/lab-notes/experiment-config.json`
- Config fingerprint: `sha256:<npm-run-experiment-check-output>`
- Node.js: `<node-version>`
- Host: `<host-name-and-os>`

## Birth snapshot

- Snapshot path: `<data-root>/hachika-state.json`
- Snapshot revision: `<actual-revision-before-first-turn>`
- Snapshot SHA-256: `<sha256>`
- Initial archive: `<data-root>/archive-snapshots/<YYYY-MM-DD>.json`
- Initial metrics date: `<YYYY-MM-DD>`

## Runtime configuration

- Time zone: `<IANA-time-zone>`
- Loop interval: `<milliseconds>`
- Clock mode: `wall-clock`
- LLM provider/base URL: `<provider-and-non-secret-base-url>`
- Default model: `<model>`
- Role overrides: `<none-or-map>`

## Life protocol

<Paste the exact warm or quiet contact protocol from docs/plan-2026-h2.md.>

## Day 0 verification

- [ ] `npm run experiment:check` succeeded
- [ ] resident lock is owned by exactly one process
- [ ] heartbeat is fresh
- [ ] first metrics row uses the frozen revision and time zone
- [ ] initial daily archive exists
- [ ] no reset or pre-birth interaction occurred

## Notes and deviations

None.
