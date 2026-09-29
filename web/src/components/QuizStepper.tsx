// Labeled 0..max stepper, used for the school-breakfast / school-lunch kid counts on Quiz Q1.
interface QuizStepperProps {
  label: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
}

export default function QuizStepper({ label, value, max, min = 0, onChange }: QuizStepperProps) {
  return (
    <div className="row row--between">
      <span className="small">{label}</span>
      <div className="stepper">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Fewer — ${label}`}
        >
          −
        </button>
        <span>{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`More — ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
