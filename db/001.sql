CREATE TABLE agencies (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL
);
CREATE TABLE people (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL CHECK (email = lower(trim(email))),
  password_hash text NOT NULL
);
CREATE TABLE clients (
  agency_id uuid REFERENCES agencies, id uuid NOT NULL, name text NOT NULL,
  PRIMARY KEY (agency_id, id)
);
CREATE TABLE memberships (
  agency_id uuid REFERENCES agencies, person_id uuid REFERENCES people,
  role text NOT NULL CHECK (role IN ('agency_admin','agency_member','client_user')),
  client_id uuid,
  PRIMARY KEY (agency_id, person_id),
  UNIQUE (agency_id, person_id, role),
  FOREIGN KEY (agency_id, client_id) REFERENCES clients,
  CHECK ((role = 'client_user') = (client_id IS NOT NULL))
);
CREATE TABLE projects (
  agency_id uuid NOT NULL, id uuid NOT NULL, client_id uuid NOT NULL, name text NOT NULL,
  PRIMARY KEY (agency_id,id), FOREIGN KEY (agency_id,client_id) REFERENCES clients
);
CREATE TABLE project_staff (
  agency_id uuid NOT NULL, project_id uuid NOT NULL, person_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('agency_admin','agency_member')),
  PRIMARY KEY (agency_id,project_id,person_id),
  FOREIGN KEY (agency_id,project_id) REFERENCES projects ON DELETE CASCADE,
  FOREIGN KEY (agency_id,person_id,role) REFERENCES memberships (agency_id,person_id,role) ON DELETE CASCADE
);
CREATE TABLE tasks (
  agency_id uuid NOT NULL, project_id uuid NOT NULL, id uuid NOT NULL,
  title text NOT NULL, status text NOT NULL CHECK (status IN ('todo','doing','done')),
  priority text NOT NULL CHECK (priority IN ('low','normal','high')),
  due_date date, assignee_id uuid, visible boolean NOT NULL DEFAULT false,
  PRIMARY KEY (agency_id,id),
  FOREIGN KEY (agency_id,project_id) REFERENCES projects ON DELETE CASCADE,
  FOREIGN KEY (agency_id,project_id,assignee_id) REFERENCES project_staff
    ON DELETE SET NULL (assignee_id)
);
CREATE INDEX tasks_project ON tasks (agency_id,project_id);
CREATE TABLE comments (
  agency_id uuid NOT NULL, task_id uuid NOT NULL, id uuid NOT NULL,
  author_id uuid NOT NULL, body text NOT NULL, visible boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id,task_id,id),
  FOREIGN KEY (agency_id,task_id) REFERENCES tasks ON DELETE CASCADE,
  FOREIGN KEY (agency_id,author_id) REFERENCES memberships
);
CREATE TABLE files (
  agency_id uuid NOT NULL, task_id uuid NOT NULL, id uuid NOT NULL,
  name text NOT NULL, data bytea NOT NULL, visible boolean NOT NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','needs_changes')),
  PRIMARY KEY (agency_id,task_id,id),
  FOREIGN KEY (agency_id,task_id) REFERENCES tasks ON DELETE CASCADE,
  CHECK (octet_length(data) BETWEEN 1 AND 5242880)
);
CREATE TABLE time_entries (
  agency_id uuid NOT NULL, task_id uuid NOT NULL, id uuid NOT NULL,
  author_id uuid NOT NULL, minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  note text NOT NULL, logged_on date NOT NULL, visible boolean NOT NULL DEFAULT false,
  PRIMARY KEY (agency_id,task_id,id),
  FOREIGN KEY (agency_id,task_id) REFERENCES tasks ON DELETE CASCADE,
  FOREIGN KEY (agency_id,author_id) REFERENCES memberships
);
CREATE TABLE invites (
  agency_id uuid REFERENCES agencies, email text NOT NULL, client_id uuid NOT NULL,
  id uuid UNIQUE NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz,
  PRIMARY KEY (agency_id,email),
  FOREIGN KEY (agency_id,client_id) REFERENCES clients
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY, agency_id uuid NOT NULL, person_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (agency_id,person_id) REFERENCES memberships ON DELETE CASCADE
);
