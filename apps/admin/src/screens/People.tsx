import { useState } from "react";
import type { ScreenProps } from "../App";
import type { Role } from "../types";
import { ROLE_WORDS } from "../lib/roles";
import { FlashBar, useAction, useConfirm, useLoad } from "../ui";

const ROLES: Role[] = ["owner", "editor", "sub", "designer", "viewer"];

export function People({ api }: ScreenProps) {
  const { data, error, reload } = useLoad(() => api.members(), []);
  const { flash, busy, run } = useAction();
  const { ask, node } = useConfirm();
  const [f, setF] = useState({ email: "", name: "", password: "", role: "editor" as Role });
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password.length < 12) return void run(async () => { throw new Error("The password needs at least 12 characters."); });
    if (await run(() => api.addMember({ ...f, email: f.email.trim(), name: f.name.trim() }), "Person added.")) { setF({ email: "", name: "", password: "", role: "editor" }); reload(); }
  };
  return (
    <>
      <div className="head"><h2>People</h2></div>
      {error && <div className="flash bad" role="alert">{error}</div>}
      <FlashBar flash={flash} />
      <ul className="list">
        {data?.items.map((m) => (
          <li key={m.user_id} className="card" data-testid="member">
            <div className="row between wrap"><span><strong>{m.name}</strong> <span className="muted">{m.email}{m.you ? " (you)" : ""}</span></span>
              <span className="row">
                <select aria-label={`Role for ${m.name}`} value={m.role} disabled={busy} onChange={async (e) => { const role = e.target.value as Role; if (role !== m.role && (await ask(`Change ${m.name} to ${role}? ${ROLE_WORDS[role]}.`, "Change role"))) { await run(() => api.setRole(m.user_id, role), "Role changed."); } reload(); }}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {!m.you && <button className="danger" disabled={busy} onClick={async () => { if (await ask(`Remove ${m.name} from this paper? They are signed out straight away.`, "Remove")) { if (await run(() => api.removeMember(m.user_id), "Removed.")) reload(); } }}>Remove</button>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <form className="card" onSubmit={add} aria-label="Add a person">
        <h3>Add a person</h3>
        <div className="grid2">
          <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label>First password (12 or more characters)<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></label>
          <label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_WORDS[r]}</option>)}</select></label>
        </div>
        <button className="primary" disabled={busy}>Add person</button>
      </form>
      {node}
    </>
  );
}
