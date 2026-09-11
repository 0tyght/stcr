# Node-RED durable delivery for GR and TTN

The production source computers are the factory computers at GR and TTN. The
development computer is not a factory source and must not be treated as one.

## Delivery contract

1. Node-RED reads each factory sensor and validates the source values.
2. Every outgoing payload receives a unique `_stcr_message_id`.
3. Node-RED writes the complete payload to a local SQLite outbox before MQTT.
4. The oldest pending row is published with MQTT QoS 1.
5. The server validates `companyId`, topic, oven mapping, and payload values.
6. The server writes the accepted data to MySQL.
7. Only after the database write succeeds, the server publishes an application
   ACK to `stcr/ack/gr` or `stcr/ack/ttn`.
8. The factory marks the SQLite row as sent only after receiving that ACK.

If MQTT, the network, API, or MySQL is unavailable, rows remain in SQLite and
are replayed FIFO after recovery. An inflight row without a database ACK is
returned to pending after 30 seconds. Sent rows are retained locally for seven
days; pending rows are never removed by cleanup.

The server also uses a persistent MQTT session with a stable client ID. This
allows the broker to retain subscribed QoS 1 messages while the API process is
temporarily offline. The factory SQLite outbox remains the authoritative retry
mechanism.

## Factory deployment

- GR: import `output/node-red/gr-production-complete-v9.json` after running
  `npm run node-red:gr:db-ack`.
- TTN: import `output/node-red/ttn-production-complete-v10.json`.
- Install `node-red-node-sqlite` on each factory computer.
- Configure each factory with its own MQTT account and company-scoped topics.
- Do not import either production flow on the development computer as a
  substitute for factory deployment.

Generated Node-RED exports are ignored by Git because they can contain broker
or LINE credentials. The transformation and verification scripts are versioned.

## Acceptance test at each factory

1. Confirm new rows appear in the local SQLite outbox before publishing.
2. Disconnect the network for at least five minutes while sensors continue.
3. Confirm pending rows increase and no pending row is deleted.
4. Reconnect and confirm rows replay oldest first.
5. Stop the API while leaving the broker running; confirm rows are not marked
   sent until the API returns and MySQL acknowledges them.
6. Compare message IDs and timestamps in SQLite, MQTT processing logs, and
   MySQL to verify no loss and no cross-company routing.

Run the static flow check with:

```powershell
npm run node-red:delivery:verify
```
