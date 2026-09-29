import { useEffect, useState } from "react";
import { StateProvider, useApp } from "./state";
import TabBar from "./components/TabBar";
import PlanBar from "./components/PlanBar";
import Toast from "./components/Toast";
import Splash from "./components/Splash";
import Quiz from "./screens/Quiz";
import Plan from "./screens/Plan";
import Recipes from "./screens/Recipes";
import Cookbook from "./screens/Cookbook";
import Pantry from "./screens/Pantry";
import Profile from "./screens/Profile";
import List from "./screens/List";
import Register from "./screens/Register";

/** One direct flow: Quiz -> Plan -> Shopping list -> Register. Recipes, Cookbook and Pantry change the plan and lead back to it. */
const SPLASH_MS = 1100;

function Shell() {
  const { path, apiOk } = useApp();
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setSplash(false), SPLASH_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (splash) return <Splash />;

  const bare = path === "/quiz" || path === "/register";
  // Pantry has its own pinned "Update my plan" button, so it does not get the bar.
  const withPlanBar = path === "/recipes" || path === "/cookbook" || path === "/profile";
  let screen;
  switch (path) {
    case "/quiz":
      screen = <Quiz />;
      break;
    case "/recipes":
      screen = <Recipes />;
      break;
    case "/cookbook":
      screen = <Cookbook />;
      break;
    case "/pantry":
      screen = <Pantry />;
      break;
    case "/profile":
      screen = <Profile />;
      break;
    case "/list":
      screen = <List />;
      break;
    case "/register":
      screen = <Register />;
      break;
    default:
      screen = <Plan />;
  }
  return (
    <div className={`app${bare ? " app--bare" : ""}${withPlanBar ? " has-planbar" : ""}`}>
      {apiOk === false && (
        <div className="warnbox" style={{ marginBottom: 16 }}>
          Can't reach the planner. Check that the API is running and this device is on the same hotspot.
        </div>
      )}
      {screen}
      {withPlanBar && <PlanBar />}
      {!bare && <Toast />}
      {!bare && <TabBar />}
    </div>
  );
}

export default function App() {
  return (
    <StateProvider>
      <Shell />
    </StateProvider>
  );
}
