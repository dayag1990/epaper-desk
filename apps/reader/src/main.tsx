import { render } from "preact";
import { App } from "./App";
import "@epaper/theme/theme.css";
import "./style.css";

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}
