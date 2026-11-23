import type { ScreenProps } from "../App";
import { useLoad } from "../ui";

const WORDS: Record<string, string> = { login: "signed in", create: "created", update: "changed", delete: "removed", sync: "started a fetch for", publish: "published", rollback: "rolled back", approve: "approved", approve_all: "approved all pages of", hide: "hid", unhide: "brought back", "ai.on": "turned AI on for", "ai.off": "turned AI off for", revoke: "revoked", test: "tested", autoplan: "auto-planned", "member.set": "set the role of", "member.role": "changed the role of", "member.remove": "removed" };

export function Activity({ api }: ScreenProps) {
  const { data, error, reload } = useLoad(() => api.audit(), []);
  return (
    <>
      <div className="head"><h2>Activity</h2><button onClick={reload}>Refresh</button></div>
      {error && <div className="flash bad" role="alert">{error}</div>}
      <ul className="list">
        {data?.items.map((r) => <li key={r.id} className="card" data-testid="audit"><strong>{r.who}</strong> {WORDS[r.action] ?? r.action} {r.entity.replace("_", " ")} <span className="muted">· {r.at.slice(0, 16).replace("T", " ")} UTC</span></li>)}
        {data?.items.length === 0 && <li className="muted">Nothing has happened yet.</li>}
      </ul>
    </>
  );
}
