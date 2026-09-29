import TopActions from "../components/TopActions";
// F3: what's already in the kitchen, so the solver only buys the gap. One task top to bottom:
// speak, type or scan -> review the "On hand" chips (the chip is the confirmation step) -> "Update my plan".
// Levels only, never grams claimed from a photo; grams come back from POST /pantry/grams and land in
// household.pantry, then we re-solve and return the user to the plan.
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Camera, Check } from "lucide-react";
import { useApp } from "../state";
import { api, ApiError } from "../api";
import StapleChips from "../components/StapleChips";
import PantryChecklist from "../components/PantryChecklist";
import VoiceButton from "../components/VoiceButton";
import type { PantryItem } from "../types";

const MAX_DIM = 1024;

function mergeItems(base: PantryItem[], incoming: PantryItem[]): PantryItem[] {
  const byId = new Map(base.map((p) => [p.ingredient_id, p]));
  for (const item of incoming) byId.set(item.ingredient_id, item);
  return Array.from(byId.values());
}

/** Downscale to at most MAX_DIM px on the long side and return base64 JPEG, no data-url prefix. */
async function fileToBase64Jpeg(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode failed"));
    image.src = dataUrl;
  });
  let { width, height } = img;
  if (width > height && width > MAX_DIM) {
    height = Math.round((height * MAX_DIM) / width);
    width = MAX_DIM;
  } else if (height >= width && height > MAX_DIM) {
    width = Math.round((width * MAX_DIM) / height);
    height = MAX_DIM;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(img, 0, 0, width, height);
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  const comma = jpeg.indexOf(",");
  return comma >= 0 ? jpeg.slice(comma + 1) : jpeg;
}

const NOTHING_RECOGNIZED = "Nothing from our list matched. Try other words, or tap Add item.";
const COMPOSER_DEFAULT = "Tap the mic and say it, or type items, comma separated.";
const PHOTO_FAILED = "Couldn't read that photo. Try more light, or type what you have.";

export default function Pantry() {
  const { household, ingredients, pantryItems, setPantryItems, setHousehold, resolveNow, navigate } = useApp();

  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);

  const [textValue, setTextValue] = useState("");
  const [textLoading, setTextLoading] = useState(false);
  const [textMsg, setTextMsg] = useState<string | null>(null);

  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState(false);

  // Don't navigate from a stale promise if the user already left this screen.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Wait for the household update (pantry grams) to land before forcing a solve, so resolveNow
  // reads the fresh household rather than a stale ref from before this render committed.
  useEffect(() => {
    if (!pendingUpdate) return;
    setPendingUpdate(false);
    void resolveNow().then(() => {
      if (!alive.current) return;
      setUpdating(false);
      navigate("/plan");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUpdate, household]);

  if (!household) return null;

  async function handlePhotoFile(file: File) {
    setPhotoLoading(true);
    setPhotoMsg(null);
    try {
      const image_b64 = await fileToBase64Jpeg(file);
      const detected = await api.pantryDetect({ image_b64 });
      if (detected.length === 0) {
        setPhotoMsg(NOTHING_RECOGNIZED);
      } else {
        setPantryItems(mergeItems(pantryItems, detected));
      }
    } catch {
      setPhotoMsg(PHOTO_FAILED);
    } finally {
      setPhotoLoading(false);
    }
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handlePhotoFile(file);
  }

  async function handleTextDetect() {
    const text = textValue.trim();
    if (!text) return;
    setTextLoading(true);
    setTextMsg(null);
    try {
      const detected = await api.pantryDetect({ text });
      if (detected.length === 0) {
        setTextMsg(NOTHING_RECOGNIZED);
      } else {
        setPantryItems(mergeItems(pantryItems, detected));
        setTextValue("");
      }
    } catch {
      setTextMsg("Couldn't read that note. Try again, or tap Add item.");
    } finally {
      setTextLoading(false);
    }
  }

  /** Voice result: merge detected items like typed text; keep the transcript as the hint line. */
  function handleVoiceResult(transcript: string, items: PantryItem[]) {
    if (items.length > 0) {
      setPantryItems(mergeItems(pantryItems, items));
      setTextMsg(transcript ? `Heard: "${transcript}"` : null);
    } else if (transcript) {
      setTextMsg(`Heard: "${transcript}" — nothing from our list matched. Try other words, or tap Add item.`);
    } else {
      setTextMsg(NOTHING_RECOGNIZED);
    }
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleTextDetect();
    }
  }

  async function handleUpdatePlan() {
    if (!household || updating) return;
    setUpdating(true);
    setUpdateMsg(null);
    try {
      const grams = await api.pantryGrams(pantryItems);
      setHousehold({ pantry: grams, assume_staples: household.assume_staples });
      setPendingUpdate(true);
    } catch (err) {
      setUpdating(false);
      setUpdateMsg(err instanceof ApiError ? err.detail : "Couldn't save your pantry. Try again.");
    }
  }

  const applied = Object.keys(household.pantry).length > 0;
  const hasStaples = Object.values(ingredients).some((i) => i.staple);
  const hasItems = pantryItems.some((p) => p.source !== "staple");
  const composerHint = textLoading ? "Reading your note…" : (textMsg ?? COMPOSER_DEFAULT);

  return (
    <div className="screen pantry">
      <div className="topbar screen-head screen-head--pantry">
        <h2>Your Pantry</h2>
        <TopActions />
      </div>
      <p className="subnote pantry-lede">We only buy what you don't have. Amounts are estimates.</p>

      <section className="composer">
        <div className="composer-row">
          <VoiceButton onResult={handleVoiceResult} onError={setTextMsg} disabled={textLoading} />
          <input
            type="text"
            placeholder="Type items, comma separated"
            aria-label="Type items, comma separated"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <button
            type="button"
            className="composer-add"
            disabled={textLoading || !textValue.trim()}
            onClick={() => void handleTextDetect()}
          >
            Add
          </button>
        </div>
        <p className="composer-hint" aria-live="polite">{composerHint}</p>
      </section>

      <label className="scan-btn">
        <Camera className="ic" aria-hidden="true" />
        <strong>Scan your pantry</strong>
        <span>Snap a photo and we'll spot what you've got.</span>
        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFileChange} />
      </label>
      {(photoLoading || photoMsg) && (
        <p className="composer-hint pantry-scan-msg" aria-live="polite">
          {photoLoading ? "Reading your photo…" : photoMsg}
        </p>
      )}

      <section className="pantry-onhand">
        <div className="pantry-onhand__head">
          <h3 className="section-title section-title--sm">On hand</h3>
          {applied && (
            <span className="subnote pantry-onhand__applied">
              <Check className="ic" aria-hidden="true" />
              Applied to your plan
            </span>
          )}
        </div>
        <p className="subnote pantry-onhand__hint">
          Tap a staple you're out of. Tap an item to change how much you have.
        </p>
        <div className="plist">
          <StapleChips />
          <PantryChecklist />
        </div>
        {!hasStaples && !hasItems && (
          <p className="subnote pantry-empty">Nothing here yet. Type or scan what you have.</p>
        )}
      </section>

      <div className="cta-pinned pantry-cta">
        <button type="button" className="btn-primary" disabled={updating} onClick={() => void handleUpdatePlan()}>
          {updating ? "Updating…" : "Update my plan"}
        </button>
      </div>
      {updateMsg && <p className="composer-hint pantry-update-msg">{updateMsg}</p>}
      <p className="disclaim center pantry-disclaim">Estimated from package sizes. The planner uses what you have first.</p>
    </div>
  );
}
