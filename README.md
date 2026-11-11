# AgencyDesk

AgencyDesk is a multi-tenant workspace for agency project boards, time, files, approvals, and client feedback. It uses React, Node.js with Express, and PostgreSQL. The assignment specifies Python. This implementation uses Node.js per the requested stack.

## Run the demo

Use Node.js 22.12+ or 24 and npm. This setup uses embedded PostgreSQL and requires no Docker daemon. Run these commands from the repository root.

```sh
unset DATABASE_URL
npm ci && npm run seed && npm run build && npm start
```

Open [AgencyDesk on localhost](http://127.0.0.1:3000). The default uses PGlite, an embedded PostgreSQL engine, and stores data in `data/`. Use one server process per embedded database. The seed command creates the demo records if absent, and it can run again after the server stops. For frontend development, leave the API running on port 3000 and run `npm run dev` in a second terminal.

| Agency slug | Portal | Email | Role |
| --- | --- | --- | --- |
| northstar | Agency staff | admin@northstar.test | Admin |
| northstar | Agency staff | member@northstar.test | Assigned project member |
| northstar | Client portal | alex@example.test | Willow client |
| fieldwork | Agency staff | alex@example.test | Admin |

All demo accounts use `agencydesk-demo`. The sign-in screen has buttons to prefill each account.

## Optional standalone PostgreSQL

To use the included PostgreSQL 17 container, start Docker Desktop and wait until `docker info` succeeds.

```sh
(
  set -e
  docker compose up -d --wait
  export DATABASE_URL=postgresql://agencydesk:agencydesk@127.0.0.1:5434/agencydesk
  npm ci
  npm run seed
  npm run build
  npm start
)
```

If Docker reports a missing socket or AgencyDesk reports `ECONNREFUSED 127.0.0.1:5434`, return to the embedded setup above. Run `unset DATABASE_URL` in the same terminal to clear any earlier export. You can also point `DATABASE_URL` at a reachable standalone PostgreSQL 17 database.

The server and seed command apply the tracked SQL migration automatically. The bundled data and compose credentials are for local evaluation. For a hosted environment, use TLS with `SECURE_COOKIES=1`, configure database credentials, and provision memberships without the demo seed.

## Review guide

- Sign in as **Northstar admin** and open **Website launch**. The board has three tasks and 3.5 hours. Open **Review homepage concepts** to see an internal note and file alongside shared material. You can create tasks, update status, assign staff, log time, and upload attachments.
- Switch to **Willow client**. The same project has two visible tasks and 2 shared hours. Search for “margin” to check that the internal task stays hidden. Open **Review homepage concepts** to download the shared file, request changes or approve it, and post a comment.
- Sign in as **Fieldwork admin** using the same email as Willow. You should see only the Fieldwork project.
- In **Project team**, remove the Northstar member. Their assignments become unassigned and their existing session loses access to that project on its next request.
- In **Invite a client**, pick a client and enter an email. Share the generated link privately and open it in another browser session. A resend keeps the same active link. A new identity creates a password and an existing identity uses its current password. The demo surfaces the link in the admin UI for manual delivery.

## Tests

```sh
npm test
```

The suite uses a fresh in-memory PostgreSQL instance and exercises the real HTTP API. It covers cross-tenant reads and writes, the schema's foreign keys, client visibility, shared identity, invitation replay and concurrent submissions, file actions, and project staff removal. For a native PostgreSQL run, point `TEST_DATABASE_URL` at a separate empty database and run the same command.

Read [DESIGN.md](DESIGN.md) for authorization and concurrency decisions. See the accompanying **AgencyDesk walkthrough.mp4** for the app and schema walkthrough.
