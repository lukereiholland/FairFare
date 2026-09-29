// Large selectable option card used throughout the quiz (single- or multi-select; the caller decides).
import type { ReactNode } from "react";
import { Check } from "lucide-react";

interface QuizOptionProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}

export default function QuizOption({ selected, onClick, children }: QuizOptionProps) {
  return (
    <button type="button" className={`opt${selected ? " sel" : ""}`} onClick={onClick} aria-pressed={selected}>
      <span>{children}</span>
      {selected && <Check className="ic" aria-hidden="true" />}
    </button>
  );
}
