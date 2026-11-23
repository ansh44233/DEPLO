import { Github, X } from "lucide-react";

export function CommunityCard({ dismissCommunity }: { dismissCommunity: () => void }) {
  return (
    <aside className="community" aria-label="DEPLO is open source">
            <button className="icon-btn community-close" onClick={dismissCommunity} aria-label="Dismiss"><X size={15} /></button>
            <div className="community-art">
              <img src="/community-campfire.webp" alt="Three small friends roasting marshmallows around a campfire" width={618} height={370} loading="lazy" />
            </div>
            <strong>Pull up a log.</strong>
            <p className="muted">There&rsquo;s a seat by the fire. Star DEPLO, report a bug, or send a pull request.</p>
            <div className="community-actions">
              <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO" target="_blank" rel="noreferrer" onClick={dismissCommunity}><Github size={14} /> Star</a>
              <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO/issues/new" target="_blank" rel="noreferrer">Report a bug</a>
            </div>
          </aside>
  );
}
