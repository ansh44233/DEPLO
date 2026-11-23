import type { Project, ProjectTab, Setter } from "@/lib/dashboard/types";
import { PROJECT_TABS } from "@/lib/dashboard/constants";

export function ProjectTabsNav({ projectTab, setProjectTab, hasActiveBuildJob }: { projectTab: ProjectTab; setProjectTab: Setter<ProjectTab>; hasActiveBuildJob: boolean }) {
  return (
    <nav className="tabs" aria-label="Project sections">
            <div className="tabs-inner">
              {PROJECT_TABS.map((tab) => (
                <button key={tab.id} className={"tab " + (projectTab === tab.id ? "tab-active" : "")} aria-current={projectTab === tab.id ? "page" : undefined} onClick={() => setProjectTab(tab.id)}>
                  {tab.label}
                  {tab.id === "builds" && hasActiveBuildJob && <span className="dot dot-building" />}
                </button>
              ))}
            </div>
          </nav>
  );
}
