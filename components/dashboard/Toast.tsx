import { X } from "lucide-react";

export function Toast({ notice, setNotice }: { notice: string; setNotice: (message: string) => void }) {
  return (
    <div className="toast" role="status" aria-live="polite">
            <span>{notice}</span>
            <button className="icon-btn" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button>
          </div>
  );
}
