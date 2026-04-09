import {
  CodexProfileAddInput,
  CodexProfileReauthInput,
  CodexProfileReauthResult,
  CodexProfileRemoveInput,
  CodexProfileState,
  CodexProfileSwitchInput,
  CodexProfilesError,
} from "@t3tools/contracts";
import { ServerConfig } from "../config";
import { ServerSettingsService } from "../serverSettings";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine";
import { ProviderRegistry } from "./Services/ProviderRegistry";
import { Effect, Layer, Option, Ref, ServiceMap } from "effect";
import * as Semaphore from "effect/Semaphore";
import path from "node:path";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import {
  detailFromResult,
  spawnAndCollect,
} from "./providerSnapshot";
import { ChildProcess } from "effect/unstable/process";
import type { CodexProfileSummary } from "@t3tools/contracts";

interface StoredProfile extends CodexProfileSummary {}

interface ProfilesFileData {
  activeProfileId: string | null;
  profiles: StoredProfile[];
}

export interface CodexProfilesServiceShape {
  getState: () => Effect.Effect<CodexProfileState, CodexProfilesError>;
  addProfile: (
    input: CodexProfileAddInput,
  ) => Effect.Effect<CodexProfileState, CodexProfilesError>;
  removeProfile: (
    input: CodexProfileRemoveInput,
  ) => Effect.Effect<CodexProfileState, CodexProfilesError>;
  switchProfile: (
    input: CodexProfileSwitchInput,
  ) => Effect.Effect<CodexProfileState, CodexProfilesError>;
  reauthProfile: (
    input: CodexProfileReauthInput,
  ) => Effect.Effect<CodexProfileReauthResult, CodexProfilesError>;
}

export class CodexProfilesService extends ServiceMap.Service<
  CodexProfilesService,
  CodexProfilesServiceShape
>()("t3/provider/CodexProfilesService") {}

const STATE_FILENAME = "profiles.json";

const fail = (code: CodexProfilesError["code"], message: string, details?: unknown) =>
  Effect.fail(
    new CodexProfilesError({
      code,
      message,
      ...(details ? { details } : {}),
    }),
  );

const nowIso = () => new Date().toISOString();

const sanitizeLabel = (label: string) => label.trim();

const resolveDefaultCodexHomePath = (configuredPath: string | undefined) =>
  configuredPath?.trim()?.length ? configuredPath : path.join(os.homedir(), ".codex");

const createProfileRecord = (input: {
  id?: string;
  label: string;
  homePath: string;
  managed: boolean;
}): StoredProfile => {
  const createdAt = nowIso();
  return {
    id: input.id ?? crypto.randomUUID(),
    label: input.label,
    homePath: input.homePath,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: createdAt,
    lastAuthLabel: null,
    lastAuthType: null,
    managed: input.managed,
  };
};

const normalizeHomePath = (candidate: string) => {
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : trimmed;
};

const mkdirRecursive = (targetPath: string) =>
  Effect.tryPromise({
    try: () => fs.mkdir(targetPath, { recursive: true }),
    catch: (cause) =>
      new CodexProfilesError({
        code: "command-failed",
        message: `Failed to create ${targetPath}.`,
        details: cause,
      }),
  });

const removePath = (targetPath: string) =>
  Effect.tryPromise({
    try: () => fs.rm(targetPath, { recursive: true, force: true }),
    catch: (cause) =>
      new CodexProfilesError({
        code: "command-failed",
        message: `Failed to remove ${targetPath}.`,
        details: cause,
      }),
  });

const updateProfileAuthInfo = (
  profile: StoredProfile,
  authLabel: string | null,
  authType: string | null,
): StoredProfile => {
  if (profile.lastAuthLabel === authLabel && profile.lastAuthType === authType) {
    return profile;
  }
  return {
    ...profile,
    lastAuthLabel: authLabel,
    lastAuthType: authType,
    updatedAt: nowIso(),
  };
};

const makeCodexProfilesService = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const orchestrationEngine = yield* Effect.serviceOption(OrchestrationEngineService);
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry);

  const profilesDir = path.join(config.baseDir, "codex-profiles");
  const statePath = path.join(profilesDir, STATE_FILENAME);

  const semaphore = yield* Semaphore.make(1);
  const profilesRef = yield* Ref.make<ProfilesFileData | null>(null);

  const readProfilesFromDisk = Effect.tryPromise({
    try: () => fs.readFile(statePath, "utf8"),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((raw) => JSON.parse(raw) as ProfilesFileData),
    Effect.catch((cause) => {
      if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
        return Effect.succeed<ProfilesFileData | null>(null);
      }
      return fail("command-failed", "Failed to read Codex profiles.", cause);
    }),
  );

  const writeProfilesToDisk = (data: ProfilesFileData) =>
    Effect.tryPromise({
      try: async () => {
        await fs.mkdir(profilesDir, { recursive: true });
        await fs.writeFile(statePath, JSON.stringify(data, null, 2), "utf8");
      },
      catch: (cause) =>
        new CodexProfilesError({
          code: "command-failed",
          message: "Failed to persist Codex profiles.",
          details: cause,
        }),
    }).pipe(Effect.asVoid);

  const loadProfiles = Effect.gen(function* () {
    const cached = yield* Ref.get(profilesRef);
    if (cached) {
      return cached;
    }
    const fromDisk = yield* readProfilesFromDisk.pipe(
      Effect.catch(() => Effect.succeed<ProfilesFileData | null>(null)),
    );
    if (fromDisk) {
      yield* Ref.set(profilesRef, fromDisk);
      return fromDisk;
    }
    const settings = yield* serverSettings.getSettings;
    const homePath = normalizeHomePath(
      resolveDefaultCodexHomePath(settings.providers.codex.homePath),
    );
    const managed =
      homePath.startsWith(path.join(profilesDir, path.sep)) ||
      homePath.startsWith(profilesDir);
    const profile = createProfileRecord({
      label: "Personal",
      homePath,
      managed,
    });
    const initial: ProfilesFileData = {
      activeProfileId: profile.id,
      profiles: [profile],
    };
    yield* writeProfilesToDisk(initial);
    yield* Ref.set(profilesRef, initial);
    return initial;
  });

  const saveProfiles = (data: ProfilesFileData) =>
    writeProfilesToDisk(data).pipe(Effect.tap(() => Ref.set(profilesRef, data)));

  const withLock = <T>(effect: Effect.Effect<T, CodexProfilesError>) =>
    Semaphore.withPermits(semaphore, 1)(effect);

  const getRunningThreads = () =>
    Option.match(orchestrationEngine, {
      onSome: (engine) =>
        engine.getReadModel().pipe(
          Effect.map((snapshot) =>
            snapshot.threads.filter(
              (thread) =>
                thread.session?.status === "running" ||
                thread.session?.status === "starting" ||
                thread.session?.status === "connecting",
            ),
          ),
        ),
      onNone: () => Effect.succeed([]),
    });

  const getCodexProvider = () =>
    Option.match(providerRegistry, {
      onSome: (registry) =>
        registry.getProviders().pipe(
          Effect.map((providers) => providers.find((provider) => provider.provider === "codex") ?? null),
        ),
      onNone: () => Effect.succeed(null),
    });

  const resolveState = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    const desiredHomePath = normalizeHomePath(
      resolveDefaultCodexHomePath(settings.providers.codex.homePath),
    );
    let current = yield* loadProfiles;
    const existing = current.profiles.find(
      (profile) => profile.homePath === desiredHomePath,
    );
    if (!existing) {
      const importedProfile = {
        ...createProfileRecord({
          label: "Imported Codex Profile",
          homePath: desiredHomePath,
          managed: desiredHomePath.startsWith(profilesDir),
        }),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      current = {
        activeProfileId: importedProfile.id,
        profiles: [...current.profiles, importedProfile],
      };
      yield* saveProfiles(current);
    } else if (current.activeProfileId !== existing.id) {
      current = {
        ...current,
        activeProfileId: existing.id,
      };
      yield* saveProfiles(current);
    }

    const runningThreads = yield* getRunningThreads();
    const lockInfo =
      runningThreads.length > 0
        ? {
            reason: `Codex is busy with ${runningThreads.length} running thread(s).`,
            runningThreads: runningThreads.map((thread) => ({
              threadId: thread.id,
              title: thread.title,
            })),
          }
        : null;

    const codexProvider = yield* getCodexProvider();
    if (codexProvider) {
      const activeProfile =
        current.profiles.find((profile) => profile.id === current.activeProfileId) ?? null;
      if (activeProfile) {
        const refreshedProfile = updateProfileAuthInfo(
          activeProfile,
          codexProvider.auth.label ?? null,
          codexProvider.auth.type ?? null,
        );
        if (refreshedProfile !== activeProfile) {
          current = {
            ...current,
            profiles: current.profiles.map((profile) =>
              profile.id === refreshedProfile.id ? refreshedProfile : profile,
            ),
          };
          yield* saveProfiles(current);
        }
      }
    }

    const state: CodexProfileState = {
      activeProfileId: current.activeProfileId,
      profiles: current.profiles,
      switchLocked: Boolean(lockInfo),
      lockInfo,
    };
    return state;
  });

  const ensureProfile = (profileId: string, data: ProfilesFileData) => {
    const profile = data.profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      return Effect.fail(
        new CodexProfilesError({
          code: "profile-not-found",
          message: "Codex profile not found.",
        }),
      );
    }
    return Effect.succeed(profile);
  };

  const addProfile = (input: CodexProfileAddInput) =>
    withLock(
      Effect.gen(function* () {
        const label = sanitizeLabel(input.label);
        if (!label) {
          return yield* fail("invalid-label", "Profile name cannot be empty.");
        }
        let current = yield* loadProfiles;
        if (
          current.profiles.some(
            (profile) => profile.label.toLowerCase() === label.toLowerCase(),
          )
        ) {
          return yield* fail(
            "invalid-label",
            "Another profile already uses that label.",
          );
        }
        const profileId = crypto.randomUUID();
        const homePath = path.join(profilesDir, profileId);
        yield* mkdirRecursive(homePath);
        const profile = {
          ...createProfileRecord({ id: profileId, label, homePath, managed: true }),
          lastUsedAt: null,
        };
        current = {
          ...current,
          profiles: [...current.profiles, profile],
        };
        yield* saveProfiles(current);
        return yield* resolveState;
      }),
    );

  const removeProfile = (input: CodexProfileRemoveInput) =>
    withLock(
      Effect.gen(function* () {
        let current = yield* loadProfiles;
        if (current.activeProfileId === input.profileId) {
          return yield* fail("profile-in-use", "Cannot delete the active profile.");
        }
        const profile = current.profiles.find(
          (entry) => entry.id === input.profileId,
        );
        if (!profile) {
          return yield* fail("profile-not-found", "Codex profile not found.");
        }
        current = {
          ...current,
          profiles: current.profiles.filter((entry) => entry.id !== profile.id),
        };
        yield* saveProfiles(current);
        if (profile.managed) {
          yield* removePath(profile.homePath);
        }
        return yield* resolveState;
      }),
    );

  const switchProfile = (input: CodexProfileSwitchInput) =>
    withLock(
      Effect.gen(function* () {
        const busy = (yield* getRunningThreads()).length > 0;
        if (busy) {
          return yield* fail(
            "switch-locked",
            "Switching is disabled while Codex is busy.",
          );
        }
        const data = yield* loadProfiles;
        const profile = yield* ensureProfile(input.profileId, data);
        yield* serverSettings.updateSettings({
          providers: {
            codex: {
              homePath: profile.homePath,
            },
          },
        });
        const next: ProfilesFileData = {
          ...data,
          activeProfileId: profile.id,
          profiles: data.profiles.map((entry) =>
            entry.id === profile.id
              ? { ...entry, lastUsedAt: nowIso(), updatedAt: nowIso() }
              : entry,
          ),
        };
        yield* saveProfiles(next);
        return yield* resolveState;
      }),
    );

  const reauthProfile = (input: CodexProfileReauthInput) =>
    withLock(
      Effect.gen(function* () {
        const data = yield* loadProfiles;
        const profile = yield* ensureProfile(input.profileId, data);
        const settings = yield* serverSettings.getSettings;
        const codexSettings = settings.providers.codex;
        const command = ChildProcess.make(codexSettings.binaryPath, ["logout"], {
          env: {
            ...process.env,
            CODEX_HOME: profile.homePath,
          },
        });
        const result = yield* spawnAndCollect(codexSettings.binaryPath, command).pipe(
          Effect.catch((cause) =>
            fail("command-failed", "Failed to logout Codex profile.", cause),
          ),
        );
        const instructions = [
          "Open a terminal on the Studio host.",
          `Run: CODEX_HOME="${profile.homePath}" ${codexSettings.binaryPath} login`,
          "Return to this window after the login completes.",
        ];
        return {
          state: yield* resolveState,
          logoutOutput: detailFromResult(result) ?? null,
          instructions,
        };
      }),
    );

  return {
    getState: () => withLock(resolveState),
    addProfile,
    removeProfile,
    switchProfile,
    reauthProfile,
  } satisfies CodexProfilesServiceShape;
});

export const CodexProfilesLive = Layer.effect(CodexProfilesService, makeCodexProfilesService);
