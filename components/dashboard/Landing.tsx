import { Cpu, GitBranch, Github, Globe, KeyRound, RotateCcw, ShieldCheck } from "lucide-react";
import type { Setter, Modal } from "@/lib/dashboard/types";
import { DeployDemo, EmberField, Sparks } from "@/app/fx";

const FEATURES = [
  { icon: GitBranch, title: "Git, ZIP or HTML", text: "Pick a repo from your GitHub, drop a ZIP, or paste a single page. Private repos work once you sign in." },
  { icon: Cpu, title: "Real builds", text: "Vite, React, CRA and static Next.js build in a throwaway Vercel Sandbox microVM. Your code never shares a box with ours." },
  { icon: KeyRound, title: "Encrypted env", text: "Per-project variables, sealed with AES-256-GCM and handed only to the build. Paste a whole .env at once." },
  { icon: Globe, title: "Edge hosting", text: "Every site gets its own Cloudflare Pages project and a URL that never changes between deploys." },
  { icon: RotateCcw, title: "Instant rollback", text: "Every production deploy is kept. Switch back in one click; nothing is rebuilt." },
  { icon: ShieldCheck, title: "Safe by default", text: "Zip-slip, symlink and archive-bomb checks. .env files and keys are stripped before anything goes public." },
];

const STEPS = [
  { title: "Fetch", text: "Clone the branch, or unpack your upload into a private workspace." },
  { title: "Decide", text: "Plain HTML ships as-is. Framework projects get a build plan." },
  { title: "Build", text: "Install and build inside an isolated microVM with your variables." },
  { title: "Ship", text: "Hash and upload only changed files, then go live on the edge." },
];

export function Landing({ setModal }: { setModal: Setter<Modal> }) {
  return (
    <>
      <section className="hero">
        <EmberField />
        <Sparks />
        <img className="hero-mark" src="/deplo-mark.svg" alt="" width={56} height={56} />
        <p className="kicker">Open source · Builds in a microVM · Yours to host</p>
        <h1>Your code, <em>live</em> in a minute.</h1>
        <p className="hero-lede">Pick a GitHub repo, drop a ZIP, or paste one HTML file. DEPLO installs, builds and ships it to Cloudflare&rsquo;s edge, then hands you a URL that stays put.</p>
        <p className="hero-tagline mono">github · zip · html → build → edge</p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href="/api/auth/github"><Github size={16} /> Continue with GitHub</a>
          <button className="btn btn-secondary btn-lg" onClick={() => setModal("github")}>Try without signing in</button>
          <a className="btn btn-secondary btn-lg" href="https://github.com/ansh44233/DEPLO" target="_blank" rel="noreferrer">Read the source</a>
        </div>
        <DeployDemo />
      </section>

      <section className="block">
        <p className="kicker">What it does</p>
        <div className="tiles tiles-3">
          {FEATURES.map((feature) => <div className="tile" key={feature.title}>
            <feature.icon size={20} aria-hidden="true" />
            <h3 className="kicker">{feature.title}</h3>
            <p>{feature.text}</p>
          </div>)}
        </div>
      </section>

      <section className="block">
        <p className="kicker">How a deploy runs</p>
        <ol className="tiles tiles-4 steps">
          {STEPS.map((step, index) => <li className="tile" key={step.title}>
            <span className="step-number mono">{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>)}
        </ol>
      </section>
    </>
  );
}
