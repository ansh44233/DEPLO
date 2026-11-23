import { Github, Search } from "lucide-react";
import type { SignedInUser, GitHubAppStatus, Project, Setter } from "@/lib/dashboard/types";

export function TopBar({ goHome, authLoading, signedInUser, activeNav, selected, setPaletteQuery, setPaletteOpen, githubAppStatus, githubAppStatusLoading, signOut }: { goHome: () => void; authLoading: boolean; signedInUser: SignedInUser | null; activeNav: "home" | "project"; selected: Project; setPaletteQuery: Setter<string>; setPaletteOpen: Setter<boolean>; githubAppStatus: GitHubAppStatus | null; githubAppStatusLoading: boolean; signOut: () => Promise<void> }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="logo" onClick={goHome} aria-label="DEPLO projects">
          <img src="/deplo-mark.svg" alt="" width={22} height={22} />
          <span>deplo</span>
        </button>
        <span className="crumb-sep" aria-hidden="true">/</span>
        {authLoading ? <span className="crumb muted">…</span> : signedInUser ? (
          <button className="crumb" onClick={goHome}>
            {signedInUser.avatarUrl ? <img className="avatar" src={signedInUser.avatarUrl} alt="" /> : <span className="avatar avatar-fallback">{signedInUser.login[0]?.toUpperCase()}</span>}
            {signedInUser.login}
          </button>
        ) : <span className="crumb muted">Guest</span>}
        {activeNav === "project" && selected.id !== undefined && <>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb crumb-current">{selected.name}</span>
        </>}
        {activeNav === "project" && !selected.id && selected.name !== "No project selected" && <>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb crumb-current">{selected.name}</span>
        </>}
      </div>
      <div className="topbar-right">
        <button className="kbd-trigger" onClick={() => { setPaletteQuery(""); setPaletteOpen(true); }} aria-label="Open command menu">
          <Search size={14} /><span>Search</span><kbd>Ctrl K</kbd>
        </button>
        {signedInUser && <a className="btn btn-ghost btn-sm" href="/api/auth/github/install" title="Lets DEPLO read private repositories and redeploy on push">
          <span className={"dot " + (githubAppStatus?.connected ? "dot-ready" : "dot-idle")} />
          {githubAppStatusLoading ? "Checking GitHub App" : githubAppStatus?.connected ? "GitHub App connected" : "Connect GitHub App"}
        </a>}
        {authLoading ? null : signedInUser
          ? <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out</button>
          : <a className="btn btn-primary btn-sm" href="/api/auth/github"><Github size={15} /> Sign in with GitHub</a>}
      </div>
    </header>
  );
}
