/** Project-aware draft screen that creates an OpenCode session on first submit. */

import { useAtom, useAtomValue, useStore } from "jotai";
import { FolderGit2, GitBranch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PalotProject, PalotSession } from "../../shared";
import { defaultWorktreeBaseAtom, defaultWorkspaceModeAtom } from "../atoms/ui";
import { approvalPresetRules } from "../lib/session-permissions";
import { createSessionInWorkspace, type WorkspaceSelection } from "../lib/new-session-workspace";
import { runtimeAtom } from "../atoms/workspace";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { assertNewTaskOwner, type NewTaskDestination } from "../lib/new-task-destination";
import { orderProjects, projectLocation, projectName, visibleProjects } from "../lib/view-models";
import { useVcsBranches, useVcsInfo } from "../hooks/use-vcs-info";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { palot } from "../services/palot";
import { Composer, type NewSessionComposerOptions } from "./composer";
import { ConnectionDestination } from "./connection-destination";
import { PalotBeacon } from "./palot-beacon";
import { ComposerPicker, type ComposerPickerSection } from "./ui/composer-picker";

const EMPTY_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};

function selectableProjects(projects: PalotProject[]): PalotProject[] {
  const local = visibleProjects(projects).filter((project) => {
    const directory = projectLocation(project);
    return directory && directory !== "/";
  });
  return local.length > 0 ? local : projects;
}

const WORKSPACE_SECTIONS: ComposerPickerSection<WorkspaceSelection["type"]>[] = [
  {
    key: "workspaces",
    options: [
      {
        key: "create",
        value: "create",
        label: "新工作树",
        description: "从当前 HEAD 分离启动",
      },
      {
        key: "current",
        value: "current",
        label: "当前检出",
        description: "直接使用项目文件夹",
      },
    ],
  },
];

function WorkspacePicker({
  project,
  selection,
  onSelect,
}: {
  project: PalotProject;
  selection: WorkspaceSelection;
  onSelect(selection: WorkspaceSelection): void;
}) {
  const label = selection.type === "create" ? "新工作树" : "当前检出";
  return (
    <ComposerPicker<WorkspaceSelection["type"]>
      size="context"
      label={selection.type === "create" ? "新工作树" : "检出"}
      ariaLabel={`工作于：${label}`}
      icon={<FolderGit2 className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      triggerClassName="max-w-48"
      triggerProps={{ title: label }}
      side="bottom"
      title="工作于"
      description="选择 OpenCode 创建此任务的位置。"
      listLabel="工作区"
      sections={WORKSPACE_SECTIONS}
      selectedKey={selection.type}
      errorTitle="无法更改工作区"
      onSelect={(option) =>
        onSelect(
          option.value === "create"
            ? { type: "create" }
            : { type: "current", directory: project.canonical },
        )
      }
    />
  );
}

function BranchPicker({
  branches,
  value,
  search,
  onSearchChange,
  onSelect,
}: {
  branches: string[];
  value: string;
  search: string;
  onSearchChange(value: string): void;
  onSelect(branch: string): void;
}) {
  const sections = useMemo<ComposerPickerSection<string>[]>(
    () => [
      {
        key: "branches",
        options: branches.map((branch) => ({ key: branch, value: branch, label: branch })),
      },
    ],
    [branches],
  );
  return (
    <ComposerPicker<string>
      size="context"
      label={value}
      ariaLabel={`源分支：${value}`}
      icon={<GitBranch className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      triggerClassName="max-w-52"
      side="bottom"
      title="源分支"
      description="选择新分离工作树的引用。"
      listLabel="分支"
      // The server searches branches; the picker shows its results as they arrive.
      search={{
        label: "搜索分支",
        placeholder: "搜索分支…",
        query: search,
        onQueryChange: onSearchChange,
        filter: false,
      }}
      sections={sections}
      selectedKey={value}
      emptyLabel="无匹配分支"
      errorTitle="无法更改源分支"
      onSelect={(option) => onSelect(option.value)}
    />
  );
}

export function NewTask({
  profileID,
  projectID: selectedProjectID = null,
  onProjectChange,
  onDestinationChange,
  onSessionCreated,
}: {
  projectID?: string | null;
  profileID?: string;
  onProjectChange?(projectID: string): void;
  onDestinationChange?(destination: NewTaskDestination): void;
  onSessionCreated?(sessionID: string): void;
} = {}) {
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const taskProjects = useMemo(
    () => selectableProjects(orderProjects(projects, sessions)),
    [projects, sessions],
  );
  const cacheSession = useCacheSession();
  const store = useStore();
  const runtime = useAtomValue(runtimeAtom);
  const disabledProfiles = useAtomValue(disabledProfileIDsAtom);
  const ownsCatalog = !profileID || profileID === runtime?.profileID;
  const defaultWorktreeBase = useAtomValue(defaultWorktreeBaseAtom);
  const [defaultWorkspaceMode, setDefaultWorkspaceMode] = useAtom(defaultWorkspaceModeAtom);
  const selectedProject = ownsCatalog
    ? selectedProjectID
      ? (projects.find((project) => project.id === selectedProjectID) ?? null)
      : (taskProjects[0] ?? null)
    : null;
  const projectIdentity = selectedProject ? `${runtime?.profileID}\0${selectedProject.id}` : "";
  const workspaceIdentity = selectedProject ? `${projectIdentity}\0${defaultWorkspaceMode}` : "";
  const [workspaceOverride, setWorkspaceOverride] = useState<{
    identity: string;
    selection: WorkspaceSelection;
  } | null>(null);
  const workspaceSelection = useMemo<WorkspaceSelection>(
    () =>
      workspaceOverride?.identity === workspaceIdentity
        ? workspaceOverride.selection
        : defaultWorkspaceMode === "current" && selectedProject
          ? { type: "current", directory: selectedProject.canonical }
          : { type: "create" },
    [defaultWorkspaceMode, selectedProject, workspaceIdentity, workspaceOverride],
  );
  const [creationErrorState, setCreationErrorState] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  const creationError =
    creationErrorState?.identity === workspaceIdentity ? creationErrorState.message : null;
  const [draftCreatedAt] = useState(() => Date.now());
  const [branchSearch, setBranchSearch] = useState("");
  const sourceBranchQuery = useVcsInfo(
    selectedProject ? { directory: selectedProject.canonical } : null,
  );
  const currentBranch = sourceBranchQuery.data?.currentBranch ?? null;
  const sourceBranch =
    defaultWorktreeBase === "repository-default"
      ? (sourceBranchQuery.data?.defaultBranch ?? currentBranch)
      : (currentBranch ?? sourceBranchQuery.data?.defaultBranch ?? null);
  const branchesQuery = useVcsBranches(
    selectedProject ? { directory: selectedProject.canonical } : null,
    branchSearch,
  );
  const branches = branchesQuery.data ?? [];
  const selectedSourceBranch =
    workspaceSelection.type === "create"
      ? (workspaceSelection.branch ?? sourceBranch)
      : sourceBranch;
  const branchOptions = selectedSourceBranch
    ? [selectedSourceBranch, ...branches.filter((branch) => branch !== selectedSourceBranch)]
    : branches;

  useEffect(() => {
    if (
      selectedProject &&
      !selectedProjectID &&
      runtime?.connected &&
      !disabledProfiles.includes(runtime.profileID)
    ) {
      // NewTask canonicalizes a missing or invalid project selection in the owning route.
      // eslint-disable-next-line react-doctor/no-pass-data-to-parent
      onProjectChange?.(selectedProject.id);
    }
  }, [onProjectChange, selectedProject, selectedProjectID, runtime, disabledProfiles]);

  const draftSession = useMemo<PalotSession | null>(() => {
    if (!selectedProject) return null;
    return {
      id: `new:${runtime?.profileID}:${selectedProject.id}`,
      parentID: null,
      projectID: selectedProject.id,
      title: null,
      agent: null,
      model: null,
      location: { directory: selectedProject.canonical },
      createdAt: draftCreatedAt,
      updatedAt: draftCreatedAt,
      archivedAt: null,
      cost: null,
      tokens: EMPTY_TOKENS,
    };
  }, [draftCreatedAt, selectedProject, runtime?.profileID]);

  const createSession = useCallback(
    async ({ approvalMode, agent, model }: NewSessionComposerOptions) => {
      if (!selectedProject || !draftSession) return null;
      const assertConnection = () => {
        const current = store.get(runtimeAtom);
        assertNewTaskOwner(runtime, current, profileID, store.get(disabledProfileIDsAtom));
      };
      assertConnection();
      setCreationErrorState(null);
      let created: PalotSession | null;
      try {
        created = await createSessionInWorkspace({
          project: selectedProject,
          selection:
            workspaceSelection.type === "create" && selectedSourceBranch
              ? { type: "create", branch: selectedSourceBranch }
              : workspaceSelection,
          createCopy: (projectID, directory, branch) => {
            assertConnection();
            return palot.createProjectCopy(projectID, directory, branch, runtime?.connectionID);
          },
          createSession: (directory) => {
            assertConnection();
            return palot.createSession(
              directory,
              undefined,
              runtime?.connectionID,
              approvalPresetRules(approvalMode),
            );
          },
        });
      } catch (error) {
        setCreationErrorState({
          identity: workspaceIdentity,
          message: error instanceof Error ? error.message : "无法创建此任务。",
        });
        throw error;
      }
      if (!created) return null;
      assertConnection();
      cacheSession(created);
      try {
        if (agent) {
          await palot.switchAgent({ sessionID: created.id, agent });
          created = { ...created, agent };
          cacheSession(created);
          assertConnection();
        }
        if (model) {
          await palot.switchModel({ sessionID: created.id, model });
          created = { ...created, model };
          cacheSession(created);
          assertConnection();
        }
      } catch (error) {
        setCreationErrorState({
          identity: workspaceIdentity,
          message:
            error instanceof Error ? error.message : "无法应用此任务的选择。",
        });
        // Keep the draft intact. Returning a session here would submit with the wrong selection.
        throw error;
      }
      onSessionCreated?.(created.id);
      return created;
    },
    [
      draftSession,
      store,
      runtime?.connectionID,
      runtime?.profileID,
      profileID,
      selectedProject,
      onSessionCreated,
      cacheSession,
      selectedSourceBranch,
      workspaceSelection,
      workspaceIdentity,
    ],
  );

  if (!selectedProject || !draftSession) {
    return (
      <main className="flex size-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <PalotBeacon className="mx-auto mb-6" />
          <h1 className="text-lg font-semibold">选择任务目标</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedProjectID
              ? "此项目在所选服务器上不可用。请重新连接或选择其他目标。"
              : "请在下方选择一个项目和服务器。你可以从侧栏添加项目文件夹。"}
          </p>
          <div className="mt-4 flex justify-center">
            <ConnectionDestination
              destination={{
                profileID: profileID ?? runtime?.profileID ?? "local-default",
                projectID: selectedProjectID,
              }}
              projects={projects}
              onDestinationChange={onDestinationChange}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="palot-main-surface @container/new-task relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      aria-label="新建任务"
      data-palot-new-task
    >
      <div className="palot-main-surface-header window-drag h-(--shell-header-height) shrink-0 border-b bg-background/90" />
      <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center px-6 pb-16 @max-[720px]/new-task:px-2 @max-[720px]/new-task:pb-8">
        <div className="flex w-full min-w-0 flex-col items-center gap-9">
          <PalotBeacon />
          <h1 className="flex max-w-full flex-wrap items-center justify-center gap-x-[0.3em] text-center text-hero/tight font-normal tracking-[-0.035em] max-[720px]:text-2xl">
            <span>我们要在</span>
            {/* Keep "?" attached to the name; the flex gap belongs only between word groups. */}
            <span className="flex min-w-0 max-w-full">
              <span className="truncate">{projectName(selectedProject)}</span>
              <span className="shrink-0">中构建什么？</span>
            </span>
          </h1>
          <Composer
            key={draftSession.id}
            session={draftSession}
            messages={[]}
            isWorking={false}
            onCreateSession={createSession}
            onCreateSessionError={(error) =>
              setCreationErrorState({
                identity: workspaceIdentity,
                message: error instanceof Error ? error.message : "无法创建此任务。",
              })
            }
            contextBarMode="compact"
            contextBar={
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
                <ConnectionDestination
                  destination={{
                    profileID: profileID ?? runtime?.profileID ?? "local-default",
                    projectID: selectedProject.id,
                  }}
                  projects={projects}
                  onDestinationChange={onDestinationChange}
                />
                <WorkspacePicker
                  project={selectedProject}
                  selection={workspaceSelection}
                  onSelect={(selection) => {
                    const mode = selection.type === "current" ? "current" : "worktree";
                    setWorkspaceOverride({
                      identity: `${projectIdentity}\0${mode}`,
                      selection,
                    });
                    setDefaultWorkspaceMode(mode);
                  }}
                />
                {workspaceSelection.type === "create" && branchOptions.length > 0 ? (
                  <BranchPicker
                    branches={branchOptions}
                    value={selectedSourceBranch ?? branchOptions[0]!}
                    search={branchSearch}
                    onSearchChange={setBranchSearch}
                    onSelect={(branch) => {
                      setWorkspaceOverride({
                        identity: `${projectIdentity}\0worktree`,
                        selection: { type: "create", branch },
                      });
                      setCreationErrorState(null);
                    }}
                  />
                ) : null}
                {workspaceSelection.type !== "create" || branchOptions.length === 0 ? (
                  <div
                    className="ml-auto flex h-6 min-w-0 items-center gap-1 px-1.5 text-meta leading-none text-muted-foreground max-[560px]:ml-0"
                    title={
                      workspaceSelection.type === "create"
                        ? "OpenCode 在当前检出的 HEAD 提交处创建分离工作树"
                        : "当前检出的分支"
                    }
                  >
                    <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {workspaceSelection.type === "create" ? "从" : "在"}{" "}
                      {selectedSourceBranch ?? "当前 HEAD"}
                    </span>
                  </div>
                ) : null}
                {creationError ? (
                  <span
                    className="basis-full truncate px-2 pt-0.5 text-xs text-destructive"
                    role="alert"
                  >
                    {creationError}
                  </span>
                ) : null}
              </div>
            }
          />
        </div>
      </section>
    </main>
  );
}
