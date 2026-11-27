import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Api } from "./api";
import { EditionPicker } from "./PaperBits";
import { loadConfig } from "./config";
import { IdbDrafts } from "./draft";
import { EditorStore } from "./store";
import "@epaper/theme/theme.css";
import "./style.css";

const cfg = loadConfig();
const api = new Api({ base: cfg.apiBase, mockUser: cfg.mockUser });
const store = new EditorStore(api, new IdbDrafts(), cfg);
const root = createRoot(document.getElementById("root")!);
if (!cfg.edition) {
  root.render(<EditionPicker api={api} />);
} else {
  void store.load(cfg.edition, new URLSearchParams(location.search).get("page"));
  root.render(<App store={store} api={api} cfg={cfg} />);
}
(window as unknown as { __store: EditorStore }).__store = store; // for tests and the ops desk
