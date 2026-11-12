import React from "react";
import ReactDOM from "react-dom/client";
import Panel from "./Panel";
import Settings from "./Settings";
import Update from "./Update";
import Viewer from "./Viewer";
import { applyWindowLook, page } from "./native";

// Why: every window loads the same page; the address (#viewer, #panel, #settings or #update) picks what it shows.
document.documentElement.dataset.window = page;
applyWindowLook();
const Page = page === "panel" ? Panel : page === "settings" ? Settings : page === "update" ? Update : Viewer;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
