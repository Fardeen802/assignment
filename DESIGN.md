# AgencyDesk design

**Tenant isolation.** Tenant-owned records carry an `agency_id`. Composite foreign keys enforce that a project and its client, a task and its assignee, and child records and their parents belong to the same tenant. The API gets the tenant and role from the signed-in session and applies that scope to queries. A guessed ID outside the session’s scope returns 404.

**Client visibility.** A client session can access only its own client’s projects and shared tasks. Comments and files must also be shared individually. Search, downloads, approvals, and reports use the same access rules. Reports show only shared time on visible tasks and keep time-entry notes private.

**One email across agencies.** The `people` table stores one credential per email. Each agency membership holds its own role and client association. Sign-in selects the agency and portal, then binds the session to that membership.

**Invite and removal edge cases.** An invite is unique per agency and normalized email. Resending reuses the active invite, and accepting locks the invite row so retries can’t create a second membership. Project writes lock the project and recheck access. Removing a team member clears their task assignments while keeping the tasks and their history.
