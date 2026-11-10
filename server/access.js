// All project and task queries take the same authenticated scope parameters.
export const projectScope = `
  p.agency_id = $1 AND (
    $3 = 'agency_admin' OR
    ($3 = 'agency_member' AND EXISTS (
      SELECT 1 FROM project_staff s WHERE s.agency_id = p.agency_id
      AND s.project_id = p.id AND s.person_id = $2
    )) OR
    ($3 = 'client_user' AND p.client_id = $4)
  )`;

export const taskScope = `${projectScope} AND ($3 <> 'client_user' OR t.visible)`;
export const taskJoin = 'tasks t JOIN projects p ON (p.agency_id,p.id) = (t.agency_id,t.project_id)';
export const scope = (actor) => [actor.agency_id, actor.person_id, actor.role, actor.client_id];
