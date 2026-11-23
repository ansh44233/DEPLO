import { Search } from "lucide-react";
import type { Setter } from "@/lib/dashboard/types";
import type { PaletteItem } from "@/lib/dashboard/palette";

export function CommandPalette({ setPaletteOpen, paletteQuery, setPaletteQuery, runPalette, paletteMatches }: { setPaletteOpen: Setter<boolean>; paletteQuery: string; setPaletteQuery: Setter<string>; runPalette: (item: PaletteItem | undefined) => void; paletteMatches: PaletteItem[] }) {
  return (
    <div className="overlay overlay-top" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
            <div className="palette" role="dialog" aria-modal="true" aria-label="Command menu">
              <label className="palette-input">
                <Search size={16} aria-hidden="true" />
                <input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runPalette(paletteMatches[0]); }} placeholder="Search projects and actions" aria-label="Search projects and actions" />
                <kbd>Esc</kbd>
              </label>
              <div className="palette-list" role="listbox">
                {paletteMatches.length === 0 ? <p className="muted palette-empty">Nothing matches “{paletteQuery}”.</p>
                  : paletteMatches.map((item, index) => <button key={item.id} role="option" aria-selected={index === 0} className={"palette-item " + (index === 0 ? "palette-item-first" : "")} onClick={() => runPalette(item)}>
                    <span>{item.label}</span>{item.hint && <span className="muted">{item.hint}</span>}
                  </button>)}
              </div>
            </div>
          </div>
  );
}
