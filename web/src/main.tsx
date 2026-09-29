import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/fairfare.css";
import "./styles/app.css";
import "./styles/meals.css";
import "./styles/home.css";
import "./styles/week.css";
import "./styles/pantry.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
