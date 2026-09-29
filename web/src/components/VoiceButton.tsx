// Mic button for the pantry composer: record audio in the browser, send it to POST /pantry/voice,
// and hand back the server's transcript + detected PantryItems (levels only, same as typed text).
// On insecure origins (the plain-http phone URL) mediaDevices is undefined: the button stays visible
// but dimmed, and tapping it explains why instead of doing nothing.
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api, ApiError } from "../api";
import type { PantryItem } from "../types";

const MAX_SECONDS = 30;
const MIN_BLOB_BYTES = 1000;
const MSG_UNSUPPORTED = "Voice input needs the secure (https) version of the app — or just type what you have.";
const MSG_PERMISSION = "Microphone permission was blocked. Type what you have instead.";
const MSG_TOO_SHORT = "We didn't catch that. Try again closer to the mic.";
const MSG_GENERIC = "Couldn't hear that. Try again, or type what you have.";

type Phase = "idle" | "recording" | "busy";

function formatElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceButton({
  onResult,
  onError,
  disabled,
}: {
  onResult: (transcript: string, items: PantryItem[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const supported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const mounted = useRef(true);

  // Always call the latest callbacks (the parent recreates them each render).
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current = onError;

  function clearTimers() {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimers();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  /** onstop: release the mic, then either bail (too short) or send the clip to the API. */
  async function finishRecording(recorder: MediaRecorder, stream: MediaStream) {
    stream.getTracks().forEach((t) => t.stop());
    if (streamRef.current === stream) streamRef.current = null;
    if (recorderRef.current === recorder) recorderRef.current = null;
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (!mounted.current) return;
    if (blob.size < MIN_BLOB_BYTES) {
      onErrorRef.current(MSG_TOO_SHORT);
      setPhase("idle");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(",");
      const audio_b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const res = await api.pantryVoice({ audio_b64, mime_type: blob.type || "audio/webm" });
      if (!mounted.current) return;
      onResultRef.current(res.transcript, res.items);
    } catch (err) {
      if (!mounted.current) return;
      onErrorRef.current(err instanceof ApiError ? err.detail : MSG_GENERIC);
    } finally {
      if (mounted.current) setPhase("idle");
    }
  }

  async function startRecording() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onErrorRef.current(MSG_PERMISSION);
      return;
    }
    if (!mounted.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    let recorder: MediaRecorder;
    try {
      try {
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      } catch {
        recorder = new MediaRecorder(stream); // browser default (e.g. Safari's audio/mp4)
      }
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      onErrorRef.current(MSG_GENERIC);
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void finishRecording(recorder, stream);
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setPhase("recording");
    tickRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    stopTimerRef.current = window.setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
  }

  function stopRecording() {
    clearTimers();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      setPhase("busy");
      rec.stop(); // finishRecording runs from onstop
    } else {
      setPhase("idle");
    }
  }

  function handleClick() {
    if (disabled) return;
    if (!supported) {
      onErrorRef.current(MSG_UNSUPPORTED);
      return;
    }
    if (phase === "recording") stopRecording();
    else if (phase === "idle") void startRecording();
    // busy: ignore taps until the API answers
  }

  const recording = phase === "recording";
  const busy = phase === "busy";
  const cls = [
    "voice-btn",
    recording ? "voice-btn--rec" : "",
    !supported || disabled ? "voice-btn--off" : "",
    busy ? "loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="voice-wrap">
      <button
        type="button"
        className={cls}
        aria-label={recording ? "Stop recording" : "Speak what's in your pantry"}
        aria-pressed={recording}
        disabled={disabled}
        onClick={handleClick}
      >
        {busy ? "…" : recording ? <Square className="ic" aria-hidden="true" /> : <Mic className="ic" aria-hidden="true" />}
      </button>
      {recording && (
        <span className="voice-timer" aria-hidden="true">
          {formatElapsed(elapsed)}
        </span>
      )}
    </span>
  );
}
