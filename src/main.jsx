import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { Board, Form, SignIn, statuses, TaskDetail, TaskForm } from './components.jsx';
import './style.css';

const roleNames = { agency_admin:'Agency admin', agency_member:'Agency member', client_user:'Client portal' };

function AdminTools({ project, staff, refresh, reload, clients }) {
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const clientOptions = clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>);
  return <div className="admin-tools">
    <details><summary>Project team</summary>
      {staff.map(person => <div className="team-row" key={person.person_id}>
        <div><strong>{person.email}</strong><small>{roleNames[person.role]}</small></div>
        <button onClick={async () => {
          setNotice('');
          try {
            await api('/projects/' + project.id + '/staff/' + person.person_id,person.assigned ? 'DELETE' : 'PUT');
            await refresh();
          } catch (error) { setNotice(error.message); }
        }}>{person.assigned ? 'Remove' : 'Add to project'}</button>
      </div>)}
      <p className="muted">Removing someone clears their assignments on this project.</p>
      {notice && <p className="error" role="alert">{notice}</p>}
    </details>
    <details><summary>Invite a client</summary>
      <Form label="Create invitation" onSave={async data => {
        setLink('');
        const invite = await api('/invites','POST',Object.fromEntries(data));
        setLink(new URL(invite.path,location.origin).href);
      }}>
        <label>Client<select name="client_id" required>{clientOptions}</select></label>
        <label>Email<input type="email" name="email" required/></label>
      </Form>
      {link && <label className="invite-link">Share this link privately<input readOnly value={link} onFocus={e=>e.target.select()}/></label>}
    </details>
    <details><summary>Add a client or project</summary>
      <Form label="Add client" onSave={async data => { await api('/clients','POST',Object.fromEntries(data)); await reload(); }}>
        <label>Client name<input name="name" required maxLength="120"/></label>
      </Form>
      <Form label="Add project" onSave={async data => { await api('/projects','POST',Object.fromEntries(data)); await reload(); }}>
        <label>Project name<input name="name" required maxLength="120"/></label>
        <label>Client<select name="client_id" required>{clientOptions}</select></label>
      </Form>
    </details>
  </div>;
}

function Project({ project, actor, reload, clients }) {
  const client = actor.role === 'client_user';
  const base = '/projects/' + project.id;
  const [summary,setSummary] = useState(null);
  const [tasks,setTasks] = useState(null);
  const [staff,setStaff] = useState([]);
  const [search,setSearch] = useState('');
  const [status,setStatus] = useState('');
  const [selected,setSelected] = useState(null);
  const [detail,setDetail] = useState(null);
  const [revision,setRevision] = useState(0);
  const [boardError,setBoardError] = useState('');
  const [detailError,setDetailError] = useState('');
  const [showForm,setShowForm] = useState(false);

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({q:search});
    if (status) query.set('status',status);
    api(base + '/tasks?' + query).then(result => {
      if (current) { setTasks(result); setBoardError(''); }
    }).catch(error => {
      if (current) { setTasks(null); setBoardError(error.message); }
    });
    return () => { current = false; };
  },[base,search,status,revision]);

  useEffect(() => {
    let current = true;
    Promise.all([api(base+'/summary'),client ? [] : api(base+'/staff')]).then(([stats,people]) => {
      if (current) { setSummary(stats); setStaff(people); }
    }).catch(error => {
      if (current) { setSummary(null); setBoardError(error.message); }
    });
    return () => { current = false; };
  },[base,client,revision]);

  useEffect(() => {
    if (!selected) return;
    let current = true;
    api('/tasks/' + selected).then(result => {
      if (current) { setDetail(result); setDetailError(''); }
    }).catch(error => {
      if (current) { setDetail(null); setDetailError(error.message); }
    });
    return () => { current = false; };
  },[selected,revision]);

  function select(id) { setDetail(null); setDetailError(''); setSelected(id); }
  const refresh = () => setRevision(value=>value+1);
  async function mutate(path, method, data) { await api(path, method, data); refresh(); }

  return <>
    <div className="project-heading">
      <div><div className="eyebrow">{project.client_name.toUpperCase()}</div><h1>{project.name}</h1>
        <p className="muted">{client ? 'Track progress, leave feedback and review files.' : 'Manage tasks, time and client approvals.'}</p></div>
      {!client && <button className="primary" onClick={()=>setShowForm(!showForm)} aria-expanded={showForm}>{showForm?'Close form':'+ New task'}</button>}
    </div>
    {summary && <section className="metrics" aria-label="Project summary">
      {Object.entries(statuses).map(([key,label]) => <div key={key}>
        <span><i className={'dot '+key}/>{label}</span><strong>{summary.counts[key]}</strong>
      </div>)}
      <div><span>{client ? 'Shared hours' : 'Hours logged'}</span><strong>{Number(summary.hours.toFixed(2))}<small> h</small></strong></div>
    </section>}
    {showForm && <section className="panel"><h2>New task</h2><TaskForm staff={staff} onSave={async data => {
      await mutate(base+'/tasks','POST',data);
      setShowForm(false);
    }}/></section>}
    <section aria-label="Task board">
      <div className="board-head"><h2>Task board</h2>
        <div className="filters"><input aria-label="Search tasks" placeholder="Search tasks…" value={search} maxLength="120" onChange={e=>setSearch(e.target.value)}/>
          <select aria-label="Filter status" value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(statuses).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
          </select></div>
      </div>
      {boardError ? <p className="error" role="alert">{boardError}</p> :
        tasks ? <Board tasks={tasks} select={select} staff={staff} client={client}/> : <p className="muted">Loading tasks…</p>}
    </section>
    {actor.role==='agency_admin' && <AdminTools project={project} staff={staff} refresh={refresh} reload={reload} clients={clients}/>}
    {selected && <TaskDialog onClose={()=>select(null)}>
      {detail ? <TaskDetail key={detail.task.id} detail={detail} client={client} staff={staff} mutate={mutate}/> :
        <p className={detailError ? 'error' : 'muted'} role="status">{detailError || 'Loading task…'}</p>}
    </TaskDialog>}
  </>;
}

function TaskDialog({ onClose, children }) {
  const ref = React.useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label="Task details">
    <button className="close" onClick={onClose} aria-label="Close task details">×</button>{children}
  </dialog>;
}

function Workspace({ actor, signOut }) {
  const [projects,setProjects] = useState(null);
  const [clients,setClients] = useState([]);
  const [active,setActive] = useState(null);
  const [error,setError] = useState('');
  const admin = actor.role==='agency_admin';
  async function reload() {
    const [list,customerList] = await Promise.all([api('/projects'),admin ? api('/clients') : []]);
    setProjects(list);
    setClients(customerList);
    setActive(current=>list.some(p=>p.id===current) ? current : (list.find(p=>p.name==='Website launch') ?? list[0])?.id);
    setError('');
  }
  useEffect(() => { reload().catch(e=>setError(e.message)); }, []);
  const project = projects?.find(p=>p.id===active);
  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><span className="logo">A</span><strong>AgencyDesk</strong></div>
      <div className="workspace-name">{actor.agency_name}<small>{roleNames[actor.role]}</small></div>
      <nav aria-label="Projects"><div className="nav-title">PROJECTS</div>
        {projects?.map(p=><button key={p.id} aria-current={p.id===active?'page':undefined} onClick={()=>setActive(p.id)}>{p.name}</button>)}
      </nav>
      <div className="profile"><small>{actor.email}</small><button onClick={()=>signOut().catch(e=>setError(e.message))}>Sign out</button></div>
    </aside>
    <main className="workspace">
      {error && <p className="error" role="alert">{error}</p>}
      {project ? <Project key={project.id} project={project} actor={actor} reload={reload} clients={clients}/> :
        <><h1>{projects ? 'No projects yet' : 'Loading workspace…'}</h1>
          {projects && admin && <div className="panel">
            <Form label="Add client" onSave={async data=>{ await api('/clients','POST',Object.fromEntries(data)); await reload(); }}>
              <label>Client name<input name="name" required maxLength="120"/></label>
            </Form>
            {clients.length>0 && <Form label="Add project" onSave={async data=>{ await api('/projects','POST',Object.fromEntries(data)); await reload(); }}>
              <label>Project name<input name="name" required maxLength="120"/></label>
              <label>Client<select name="client_id" required>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            </Form>}
          </div>}
        </>}
    </main>
  </div>;
}

function App() {
  const [actor,setActor] = useState(undefined);
  const [error,setError] = useState('');
  async function load() {
    try { setActor(await api('/me')); }
    catch (error) {
      if (error.status === 401) setActor(null);
      else throw error;
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).has('invite')) setActor(null);
    else load().catch(e=>setError(e.message));
  },[]);
  if (error) return <main className="login"><p role="alert" className="error">{error}</p><button onClick={()=>location.reload()}>Retry</button></main>;
  if (actor === undefined) return <main className="login">Loading AgencyDesk…</main>;
  return actor ? <Workspace actor={actor} signOut={async () => { await api('/logout','POST'); setActor(null); }}/> :
    <SignIn onLogin={load}/>;
}

createRoot(document.getElementById('root')).render(<App/>);
