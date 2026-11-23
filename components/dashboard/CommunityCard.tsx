import { Github, X } from "lucide-react";

export function CommunityCard({ dismissCommunity }: { dismissCommunity: () => void }) {
  return (
    <aside className="community" aria-label="DEPLO is open source">
            <button className="icon-btn community-close" onClick={dismissCommunity} aria-label="Dismiss"><X size={15} /></button>
            <div className="community-art" aria-hidden="true">
              <img src="/deplo-mark.svg" alt="" width={28} height={28} />
              <span className="community-trail" />
            </div>
            <strong>Built in the open.</strong>
            <p className="muted">DEPLO is open source. Star the repo, report a bug, or send a pull request.</p>
            <div className="community-actions">
              <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO" target="_blank" rel="noreferrer" onClick={dismissCommunity}><Github size={14} /> Star</a>
              <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO/issues/new" target="_blank" rel="noreferrer">Report a bug</a>
            </div>
          </aside>
  );
}
