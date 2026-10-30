import React from "react";
import ReactDOM from "react-dom/client";
import About from "./About";
import Panel from "./Panel";
import Viewer from "./Viewer";
import { applyWindowLook, page } from "./native";

// Why: the tray panel, the viewer and the About window load the same page; the address (#panel, #viewer or #about)
// picks what it shows.
document.documentElement.dataset.window = page;
applyWindowLook();
const Page = page === "about" ? About : page === "viewer" ? Viewer : Panel;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>,
);
