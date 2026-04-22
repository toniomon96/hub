# Apple Shortcuts — Hub Bridge

Connects Apple Reminders and iPhone Notes to Hub via the `/webhooks/manual` endpoint.
No server code required — Hub already handles the `manual` webhook source.

## Prerequisites

- Hub server running and reachable (Railway URL or local)
- `HUB_WEBHOOK_SECRET` set in Railway variables (check `hub doctor` output)
- Shortcuts app installed on iPhone and Mac

---

## Shortcut 1 — Apple Reminders → Hub (Mac, daily 06:00)

Runs daily at 06:00 on your Mac. Fetches all reminders due today or overdue, formats them as a single capture, and POSTs to Hub. They appear in captures and surface in the daily brief.

### Setup steps

1. Open **Shortcuts** on Mac → **New Shortcut**
2. Name it: `Hub: Sync Reminders`
3. Add these actions in order:

**Action 1 — Get Reminders**

- Action: `Find Reminders`
- Filter: `Due Date is before or on Today` AND `Completed is false`
- Sort by: Due Date (ascending)
- Limit: off

**Action 2 — Format as text**

- Action: `Repeat with each item in Reminders`
- Inside the repeat, add: `Combine Text` → `• [Reminder.Title] (due: [Reminder.Due Date])` with newline separator
- End Repeat

**Action 3 — Build JSON body**

- Action: `Text`

```
{"text": "Reminders due today:\n[Repeat Result]", "ref": "apple-reminders://sync"}
```

Replace `[Repeat Result]` with the variable from step 2.

**Action 4 — POST to Hub**

- Action: `Get Contents of URL`
- URL: `https://hubserver-production-0cd1.up.railway.app/webhooks/manual`
- Method: POST
- Headers:
  - `x-hub-secret`: `<your HUB_WEBHOOK_SECRET value>`
  - `content-type`: `application/json`
- Request Body: JSON body from Action 3

4. Save the shortcut
5. Go to **Shortcuts → Details → Add to Menu Bar** (optional, for manual trigger)
6. Set automation: **Shortcut → Automations → New Automation → Time of Day → 06:00 → Daily → Run Shortcut → Hub: Sync Reminders**
   - Uncheck "Ask Before Running"

### Result

Reminders appear in Hub captures as source `manual`, classified by Ollama. They surface in the daily brief under captured context.

---

## Shortcut 2 — iPhone Notes → Hub (Share Sheet)

Send any note to Hub directly from the Notes app share sheet.

### Setup steps

1. Open **Shortcuts** on iPhone → **New Shortcut**
2. Name it: `Send to Hub`
3. Enable: **Show in Share Sheet** (Shortcut Details → Show in Share Sheet → on)
4. Input type: **Text** and **Rich Text** (accept both)
5. Add these actions:

**Action 1 — Receive input**

- Action: `Receive [Text] from Share Sheet`

**Action 2 — Build JSON body**

- Action: `Text`

```
{"text": "[Shortcut Input]", "ref": "apple-notes://share"}
```

Replace `[Shortcut Input]` with the Share Sheet input variable.

**Action 3 — POST to Hub**

- Action: `Get Contents of URL`
- URL: `https://hubserver-production-0cd1.up.railway.app/webhooks/manual`
- Method: POST
- Headers:
  - `x-hub-secret`: `<your HUB_WEBHOOK_SECRET value>`
  - `content-type`: `application/json`
- Request Body: JSON body from Action 2

6. Save the shortcut

### Using it

Open any note in Notes → tap Share → `Send to Hub`. The note text is captured, classified, and appears in the Captures list within seconds.

---

## Shortcut 3 — Quick Voice Capture (iPhone, optional)

For quick voice captures without Superwhisper. Uses Siri to dictate and sends directly to Hub.

1. Open **Shortcuts** → **New Shortcut**
2. Name it: `Quick Hub Capture`
3. Add to Siri: say "Hey Siri, quick Hub capture"
4. Actions:

**Action 1 — Dictate text**

- Action: `Dictate Text`
- Language: Default

**Action 2 — Build JSON**

- Action: `Text`

```
{"text": "[Dictated Text]", "ref": "siri://dictate"}
```

**Action 3 — POST to Hub**

- Same URL and headers as above

---

## Verifying a shortcut works

After running, open Hub web UI → **Captures** — the new entry should appear with:

- `source: manual`
- `status: classified` (after a few seconds)
- `classifiedDomain` and `classifiedType` populated by Ollama

Or via CLI: `hub captures --limit 5`

---

## Webhook payload reference

All three shortcuts POST to the same endpoint:

```
POST /webhooks/manual
Headers:
  x-hub-secret: <HUB_WEBHOOK_SECRET>
  content-type: application/json

Body:
  { "text": "<capture text>", "ref": "<source reference URI>" }
```

The `ref` field is stored as `rawContentRef` in the capture row — useful for tracing back to the original source.
