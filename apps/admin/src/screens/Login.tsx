import { useState } from "react";
import type { Api } from "../api";
import type { Me } from "../types";
import { ApiError } from "../lib/words";
import { FlashBar, useAction } from "../ui";

export function Login({ api, onIn }: { api: Api; onIn: (m: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [paper, setPaper] = useState("");
  const { flash, busy, run, setFlash } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      try { await api.login(email.trim(), password, paper.trim() || undefined); }
      catch (err) {
        if (err instanceof ApiError && err.status === 401) throw new ApiError(401, "bad_login", "That email and password do not match.");
        throw err;
      }
      return api.me();
    });
    if (ok) onIn(ok); else setPassword("");
    void setFlash;
  };
  return (
    <form className="login card" onSubmit={submit} aria-label="Sign in">
      <h1>E-Paper Desk</h1>
      <p className="muted">Sign in to run your paper.</p>
      <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <label>Paper <span className="muted">(only if you work on more than one)</span><input value={paper} onChange={(e) => setPaper(e.target.value)} placeholder="paper address, for example daily-demo" /></label>
      <FlashBar flash={flash} />
      <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
