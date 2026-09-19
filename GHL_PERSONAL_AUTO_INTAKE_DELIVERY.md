# GHL Personal Auto intake delivery — September 19, 2026

This closes the personal-auto conversion-funnel gap where completed requests from `https://pinnacleriskad.com/auto-quote.html` did not have a verified, published path into the Personal Lines pipeline. No page URL, tracking tag, phone number, EmailJS configuration, or commercial landing page was changed in this phase.

## Production configuration

- GoHighLevel workflow: `PL - Netlify Website Intake`
- Workflow ID: `d2e08cd6-f936-49e1-9b9b-a36359c6f410`
- Status: published
- Intake transport: the existing Netlify personal-lines webhook configured through `GHL_PERSONAL_LINES_WEBHOOK_URL`; no webhook secret or URL is stored in this repository.
- Scope gate: only payloads whose `form_type` is `personal_auto` continue through this workflow. Homeowners and umbrella payloads exit without an opportunity or task here.
- Partial request: creates or updates the contact and adds `source-website`, then exits. It does not create an opportunity, note, or task.
- Completed request: creates or updates the contact, adds `source-website`, saves the completed quote as a contact note, and searches for an existing opportunity for that contact in `PERSONAL LINES - QUOTE TO BIND`.
- Existing opportunity found: the workflow exits after saving the new quote note. It does not reset stage, status, owner, or value and does not create another call task.
- No opportunity found: creates one open opportunity in `New PL Lead`, source `Website Quote Form`, assigns the opportunity to Derrick Brown, and creates one call task assigned to Derrick Brown.
- Future task title: `AUTO WEB LEAD: Call {{contact.name}}`
- Future task instruction: `Call promptly. Review full quote in contact Notes.`
- Future task due date: same day at 9:00 AM. GHL may show it as immediately overdue when a lead arrives after 9:00 AM.

The quote note stores the submission ID, submission state, submitted time, source, page, and the form-generated secure detail block. That block includes the household garaging address, every per-vehicle garaging address, driver name/DOB/license information, VIN and decoded/manual-review vehicle details, coverage selections, and customer comments.

## Live verification

Marked synthetic contact: `TEST ONLY PL Intake`, reserved phone `(202) 555-0187`, and `personal-auto-intake-test@example.invalid`. SMS consent remained unchecked, and no customer SMS or email was sent.

1. The production form completed all five steps and displayed `Your auto quote request is in.`
2. The initial partial capture created the contact and applied `source-website` without creating an opportunity or task.
3. The completed capture followed the Personal Auto and Complete branches. GHL executed the contact update, tag, completed-quote note, opportunity lookup, opportunity creation, opportunity-owner assignment, and one call task.
4. The saved note contained both synthetic addresses: `123 Test Street, Unit 2, Atlanta, GA 30339` and `456 Sample Avenue, Apt 9, Miami, FL 33101`. It also contained DOB `1990-01-15`, GA license `TESTPL123`, and manual-review VIN `TESTPL123`.
5. The resulting opportunity was open in `PERSONAL LINES - QUOTE TO BIND` → `New PL Lead`, source `Website Quote Form`, and assigned to Derrick Brown.
6. A second completed request using the same fictional contact and submission ID returned HTTP 200. The execution ended after `Find opportunity`; it did not execute Create opportunity, Add owner, or the task action.
7. After the repeat, GHL showed one matching opportunity, one call task, and two quote notes. The opportunity remained open in `New PL Lead` and retained its owner.
8. The first live task was created before the task-copy correction and therefore retains the previous wording and next-day due date. The published workflow now shows the corrected future title, instruction, assignee, and same-day due setting. Workflow edits do not retroactively rewrite an existing task.

The production form continues to call the existing EmailJS agency notification after a successful CRM submission. Code inspection and the successful browser submission verify that behavior was preserved, but inbox delivery and the rendered EmailJS template were not independently rechecked in this phase.

## Known limits

- Repeat completed requests intentionally append a new timestamped contact note while reusing the opportunity and call task.
- The duplicate guard is a workflow lookup followed by conditional creation. It prevents normal sequential repeats but is not a database-level uniqueness constraint; two truly simultaneous first submissions could still race.
- Homeowners and personal-umbrella automation remains outside this Personal Auto change and needs its own reviewed routing before publication.
- The workflow's inbound trigger is a premium GoHighLevel action and may incur GHL execution charges under the agency's current plan. No plan or billing setting was changed.

## Rollback

The fastest safe rollback is to open `PL - Netlify Website Intake` and switch Publish to Draft. That immediately stops this workflow without changing the website, Netlify environment, Personal Lines pipeline, or other automations.

For a configuration rollback, use GHL's Recent Changes/version history for workflow `d2e08cd6-f936-49e1-9b9b-a36359c6f410`. If a manual rollback is required, keep the workflow in Draft while removing the two If/Else gates, completed-quote note, opportunity lookup, and opportunity-owner action, then move Create opportunity and the original task back to the main path. Do not republish the old unresolved webhook mapping; select a valid request sample and confirm all contact variables resolve before publishing.

The synthetic contact, opportunity, notes, and task were retained as an audit trail and are clearly marked `TEST ONLY`. They can be archived or deleted manually after acceptance; this phase did not delete production CRM data.
