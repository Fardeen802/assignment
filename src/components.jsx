import React, { useState } from 'react';
import { api, readFile } from './api.js';

export const statuses = { todo: 'To do', doing: 'In progress', done: 'Done' };
const decisions = { pending: 'Awaiting review', approved: 'Approved', needs_changes: 'Needs changes' };
const dateLabel = (value) => value ? new Intl.DateTimeFormat('en', {
  month:'short', day:'numeric', timeZone:'UTC',
}).format(new Date(value)) : 'No due date';
const today = () => new Date().toLocaleDateString('sv-SE');

export function Form({ children, onSave, label, reset = true, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setBusy(true);
    try {
      await onSave(new FormData(form));
      if (reset) form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <form className={className} onSubmit={submit}>
    <fieldset disabled={busy}>{children}<button className="primary" type="submit">{busy ? 'Working…' : label}</button></fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function Visibility({ label = 'Share with client' }) {
  return <label className="check"><input type="checkbox" name="visible"/> {label}</label>;
}
const isVisible = (data) => data.has('visible');

function Assignee({ staff, value }) {
  return <label>Assignee<select name="assignee_id" defaultValue={value ?? ''}>
    <option value="">Unassigned</option>
    {staff.filter(person => person.assigned).map(person =>
      <option key={person.person_id} value={person.person_id}>{person.email}</option>)}
  </select></label>;
}
function Status({ value }) {
  return <label>Status<select name="status" defaultValue={value}>
    {Object.entries(statuses).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
  </select></label>;
}

export function TaskForm({ staff, onSave }) {
  return <Form label="Create task" onSave={data => onSave({ ...Object.fromEntries(data), visible:isVisible(data) })}>
    <label>Task title<input name="title" required maxLength="160"/></label>
    <div className="fields"><Status value="todo"/>
      <label>Priority<select name="priority" defaultValue="normal">
        <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
      </select></label>
      <label>Due date<input name="due_date" type="date"/></label>
      <Assignee staff={staff}/>
    </div>
    <Visibility/>
  </Form>;
}

export function Board({ tasks, select, staff, client }) {
  return <div className="board">
    {Object.entries(statuses).map(([key, label]) => {
      const lane = tasks.filter(task => task.status === key);
      return <section className="lane" key={key} aria-label={label}>
        <header><span className={'dot ' + key}/><h3>{label}</h3><span className="count">{lane.length}</span></header>
        {lane.map(task => <button className="task-card" key={task.id} onClick={() => select(task.id)}>
          <span className={'priority ' + task.priority}>{task.priority} priority</span>
          <strong>{task.title}</strong>
          <span className="task-meta">{dateLabel(task.due_date)}{!client && <> · {task.visible ? 'Client-visible' : 'Internal'}</>}</span>
          {!client && <small>{staff.find(person => person.person_id === task.assignee_id)?.email ?? 'Unassigned'}</small>}
        </button>)}
        {!lane.length && <p className="empty-lane">No tasks here.</p>}
      </section>;
    })}
  </div>;
}

export function TaskDetail({ detail, staff, client, mutate }) {
  const { task, comments, files, entries } = detail;
  const path = '/tasks/' + task.id;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(id, decision) {
    setBusy(true);
    setError('');
    try { await mutate(path + '/files/' + id, 'PATCH', { decision }); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="eyebrow">TASK DETAILS</div>
    <h2>{task.title}</h2>
    <p className="muted">{statuses[task.status]} · {task.priority} priority · {dateLabel(task.due_date)}</p>
    {!client && <section className="detail-section">
      <h3>Task settings</h3>
      <Form key={task.status + task.assignee_id + task.visible} label="Save changes" reset={false}
        onSave={data => mutate(path, 'PATCH', { ...Object.fromEntries(data), visible:isVisible(data) })}>
        <div className="fields"><Status value={task.status}/><Assignee staff={staff} value={task.assignee_id}/></div>
        <label className="check"><input type="checkbox" name="visible" defaultChecked={task.visible}/> Share with client</label>
      </Form>
    </section>}
    <section className="detail-section">
      <h3>Files & approvals</h3>
      {files.length === 0 && <p className="muted">No files attached.</p>}
      {files.map(file => <div className="record" key={file.id}>
        <a href={'/api' + path + '/files/' + file.id}>{file.name}</a>
        <small>{decisions[file.decision]}{!client && ' · ' + (file.visible ? 'Client-visible' : 'Internal')}</small>
        {client && <div className="actions">
          <button type="button" disabled={busy || file.decision === 'approved'} onClick={() => decide(file.id,'approved')}>Approve</button>
          <button type="button" disabled={busy || file.decision === 'needs_changes'} onClick={() => decide(file.id,'needs_changes')}>Needs changes</button>
        </div>}
      </div>)}
      {error && <p className="error" role="alert">{error}</p>}
      {!client && <Form label="Upload file" onSave={async data => {
        const file = data.get('file');
        await mutate(path + '/files','POST',{name:file.name,base64:await readFile(file),visible:isVisible(data)});
      }}>
        <label>Attachment (up to 5 MB)<input name="file" type="file" required/></label><Visibility/>
      </Form>}
    </section>
    <section className="detail-section">
      <h3>Comments</h3>
      {comments.length === 0 && <p className="muted">No comments yet.</p>}
      {comments.map(comment => <div className="record" key={comment.id}>
        <small>{comment.author} · {dateLabel(comment.created_at)}{!comment.visible && ' · Internal'}</small>
        <p>{comment.body}</p>
      </div>)}
      <Form label="Post comment" onSave={data => mutate(path + '/comments','POST',{body:data.get('body'),visible:isVisible(data)})}>
        <label>Your comment<textarea name="body" required maxLength="4000" rows="3"/></label>
        {!client && <Visibility/>}
      </Form>
    </section>
    {!client && <section className="detail-section">
      <h3>Time entries</h3>
      {entries.map(entry => <div className="record" key={entry.id}>
        <small>{entry.minutes} min · {dateLabel(entry.logged_on)} · {entry.visible ? 'Shared in report' : 'Internal'}</small>
        <p>{entry.note}</p>
      </div>)}
      <Form label="Log time" onSave={data => mutate(path + '/time','POST',{
        minutes:Number(data.get('minutes')), note:data.get('note'),logged_on:data.get('logged_on'),visible:isVisible(data),
      })}>
        <div className="fields">
          <label>Minutes<input name="minutes" type="number" min="1" max="1440" required/></label>
          <label>Date<input name="logged_on" type="date" defaultValue={today()} required/></label>
        </div>
        <label>Note<input name="note" maxLength="2000"/></label>
        <Visibility label="Include duration in client report"/>
      </Form>
    </section>}
  </>;
}

export function SignIn({ onLogin }) {
  const [portal,setPortal] = useState('staff');
  const [slug,setSlug] = useState('');
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [invite,setInvite] = useState(() => new URLSearchParams(location.search).get('invite'));
  const [notice,setNotice] = useState('');
  function useDemo(workspace, address, entry) {
    setSlug(workspace);
    setEmail(address);
    setPortal(entry);
    setPassword('agencydesk-demo');
  }
  return <main className="login">
    <div className="login-brand"><span className="logo">A</span> AgencyDesk</div>
    <section className="login-card">
      <div className="eyebrow">AGENCY WORKSPACE</div>
      <h1>{invite ? 'Accept your invitation' : 'Welcome back'}</h1>
      {notice && <p className="success" role="status">{notice}</p>}
      {invite ? <>
        <p className="muted">Create a password, or enter your current password if you already use AgencyDesk.</p>
        <Form label="Accept invitation" onSave={async data => {
          const result = await api('/invites/accept','POST',{token:invite,password:data.get('password')});
          history.replaceState(null,'','/');
          setInvite(null);
          setSlug(result.slug);
          setPortal('client');
          setNotice('Invitation accepted. Sign in with your invited email.');
        }}>
          <label>Password<input name="password" type="password" autoComplete="new-password" minLength="10" maxLength="128" required/></label>
        </Form>
      </> : <>
        <div className="tabs" aria-label="Sign-in portal">
          <button aria-pressed={portal==='staff'} onClick={()=>setPortal('staff')}>Agency staff</button>
          <button aria-pressed={portal==='client'} onClick={()=>setPortal('client')}>Client portal</button>
        </div>
        <Form label="Sign in" onSave={async () => {
          await api('/login','POST',{slug,email,password,portal});
          await onLogin();
        }}>
          <label>Agency slug<input name="agency" value={slug} onChange={e=>setSlug(e.target.value)} placeholder="northstar" required maxLength="80"/></label>
          <label>Email<input type="email" name="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        </Form>
        <details className="demo" open>
          <summary>Try a demo account</summary>
          <div className="actions">
            <button onClick={()=>useDemo('northstar','admin@northstar.test','staff')}>Northstar admin</button>
            <button onClick={()=>useDemo('northstar','member@northstar.test','staff')}>Northstar member</button>
            <button onClick={()=>useDemo('northstar','alex@example.test','client')}>Willow client</button>
            <button onClick={()=>useDemo('fieldwork','alex@example.test','staff')}>Fieldwork admin</button>
          </div>
        </details>
      </>}
    </section>
    <p className="login-foot">Projects, feedback and approvals in one workspace.</p>
  </main>;
}
