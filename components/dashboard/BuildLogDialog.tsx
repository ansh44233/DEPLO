import { X } from "lucide-react";
import type { Setter } from "@/lib/dashboard/types";

export function BuildLogDialog({ message, log, setBuildLogOpen, setNotice }: { message: string; log: string; setBuildLogOpen: Setter<boolean>; setNotice: (message: string) => void }) {
  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setBuildLogOpen(false); }}>
            <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="build-log-title">
              <div className="dialog-head">
                <div><h2 id="build-log-title">Build log</h2><span className="muted">{message}</span></div>
                <div className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(log ?? ""); setNotice("Build log copied."); }}>Copy</button>
                  <button className="icon-btn" onClick={() => setBuildLogOpen(false)} aria-label="Close build log"><X size={18} /></button>
                </div>
              </div>
              <div className="terminal">{log.split("\n").map((line, index) => <div className={"log-line log-line-plain " + (line.startsWith("$ ") ? "log-cmd" : /error|ERR!|failed/i.test(line) ? "log-err" : "")} key={index}><code>{line || " "}</code></div>)}</div>
            </section>
          </div>
  );
}
