import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Api } from "./api";
import "@epaper/theme/theme.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App api={new Api("")} />);
