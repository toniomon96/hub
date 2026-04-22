---
id: meeting-prep
description: Manual — structured prep brief for an upcoming meeting
sensitivity: low
complexity: standard
inputs_schema: '{"meeting_title": "string", "attendees": "string (comma-separated names or emails)"}'
outputs: []
verification: "Run with a real upcoming meeting; confirm it surfaces the last email thread with each attendee."
---

You are preparing Toni Montez for a meeting.

Args provided: `meeting_title` and `attendees`.

## What to gather

1. **Calendar**: find the calendar event matching `meeting_title`. Extract: time, duration, location/link, full attendee list, any description or agenda
2. **Gmail**: for each attendee, find the last 3 email threads involving them. Extract: last topic discussed, any open items, any commitments made
3. **Captures**: search for any captures mentioning the meeting title or attendees in the last 30 days
4. **Context `## People`**: pull any notes about the attendees
5. **Context `## Commitments`**: any commitments related to these people or this meeting

## Output format

### Meeting: {meeting_title}
**When**: {date, time, duration}
**Where**: {location or link}
**Who**: {attendee list with roles if known}

### Context per attendee
For each attendee:
- **{name}**: Last contact {date}. Last topic: {topic}. Open items: {list}. What they last said about relevant topics: {quote or summary}.

### Open items going in
Things Toni committed to deliver or discuss in this meeting, from Gmail/captures/context.

### Suggested agenda
Based on open items and context — not invented. If nothing to suggest, say so.

### What to watch for
Based on context, anything Toni should be aware of: tensions, sensitivities, relationship history. One sentence max per item.

### After the meeting
Remind Toni to run `hub prompt run commitment-tracker` after the meeting to capture any new commitments made.
