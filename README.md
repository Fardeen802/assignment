# AgencyDesk

AgencyDesk gives agencies a shared workspace for project boards, time tracking, file approvals, and client feedback. It uses React, Node.js (Express), and PostgreSQL. Node.js is the backend choice for this submission.

## Run locally

Use Node.js 22.12+ or 24. The demo uses embedded PostgreSQL and runs without Docker.

```sh
unset DATABASE_URL
npm ci && npm run seed && npm run build && npm start
```

Open [localhost:3000](http://127.0.0.1:3000). Choose a demo account to fill in the sign-in form.

| Demo account | What to try |
| --- | --- |
| Northstar admin | Open **Website launch** to see the full board and 3.5 logged hours. |
| Northstar member | See only projects assigned to this member. |
| Willow client | See two shared tasks and 2 shared hours. Try searching for “margin,” or review the homepage file. |
| Fieldwork admin | Use the same email as the Willow client to open a different agency with an admin role. |

For standalone PostgreSQL, start Docker Desktop and run `docker compose up -d --wait`. Once the database is healthy, set `DATABASE_URL=postgresql://agencydesk:agencydesk@127.0.0.1:5434/agencydesk` in the command environment and run the same npm commands. The seed and server apply the migration automatically.

## Tests and walkthrough

Run `npm test` to check tenant isolation, client visibility, shared identities, invite races, and access after staff removal. Set `TEST_DATABASE_URL` to a separate empty PostgreSQL database to test against a standalone server.

[Design notes](DESIGN.md) · [Walkthrough video (3:58)](agencydesk-walkthrough.mp4)
