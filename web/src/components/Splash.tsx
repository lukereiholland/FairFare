import { Leaf } from "lucide-react";
import { APP_NAME } from "../format";

/** Full-screen opening card shown for about a second on every launch, before the quiz or the plan. */
export default function Splash() {
  return (
    <div className="splash" role="status" aria-label={`${APP_NAME} is opening`}>
      <div className="splash__mark">
        <Leaf className="ic" aria-hidden="true" />
      </div>
      <h1 className="splash__name">{APP_NAME}</h1>
      <p className="splash__line">Meals that fit your SNAP</p>
    </div>
  );
}
