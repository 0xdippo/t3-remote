import {
  CodexProfileAddInput,
  CodexProfileReauthInput,
  CodexProfileRemoveInput,
  CodexProfileState,
  CodexProfileSwitchInput,
  CodexProfileReauthResult,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureLocalApi } from "../localApi";
import { toastManager } from "../components/ui/toast";

const QUERY_KEY = ["codex-profiles-state"] as const;

async function fetchState(): Promise<CodexProfileState> {
  const api = ensureLocalApi();
  return api.codexProfiles.getState();
}

export function useCodexProfilesQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchState,
    refetchOnWindowFocus: false,
  });
}

export function useCodexProfilesMutations() {
  const queryClient = useQueryClient();
  const api = ensureLocalApi();

  const applyState = (state: CodexProfileState) => {
    queryClient.setQueryData(QUERY_KEY, state);
  };

  const addProfile = useMutation({
    mutationFn: (input: CodexProfileAddInput) => api.codexProfiles.addProfile(input),
    onSuccess: (state, variables) => {
      applyState(state);
      toastManager.add({
        type: "success",
        title: "Profile added",
        description: `Saved Codex profile “${variables.label}”.`,
      });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not add profile",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const removeProfile = useMutation({
    mutationFn: (input: CodexProfileRemoveInput) => api.codexProfiles.removeProfile(input),
    onSuccess: (state) => {
      applyState(state);
      toastManager.add({
        type: "success",
        title: "Profile removed",
        description: "Codex profile deleted.",
      });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not remove profile",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const switchProfile = useMutation({
    mutationFn: (input: CodexProfileSwitchInput) => api.codexProfiles.switchProfile(input),
    onSuccess: (state) => {
      applyState(state);
      toastManager.add({
        type: "success",
        title: "Codex account switched",
        description: "Start a new thread for the new account.",
      });
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not switch account",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const reauthProfile = useMutation({
    mutationFn: (input: CodexProfileReauthInput) => api.codexProfiles.reauthProfile(input),
    onSuccess: (result: CodexProfileReauthResult) => {
      applyState(result.state);
      toastManager.add({
        type: "info",
        title: "Finish Codex login",
        description: result.instructions.join("\n"),
      });
      if (result.logoutOutput) {
        toastManager.add({
          type: "default",
          title: "codex logout",
          description: result.logoutOutput,
        });
      }
    },
    onError: (error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not re-authenticate",
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return {
    addProfile,
    removeProfile,
    switchProfile,
    reauthProfile,
  };
}
