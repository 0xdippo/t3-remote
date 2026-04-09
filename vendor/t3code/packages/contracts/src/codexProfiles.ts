import { Schema } from "effect";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas";

const TrimmedString = TrimmedNonEmptyString;

export const CodexProfileId = TrimmedString;
export type CodexProfileId = typeof CodexProfileId.Type;

export const CodexProfileSummary = Schema.Struct({
  id: CodexProfileId,
  label: TrimmedString,
  homePath: TrimmedString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
  lastAuthLabel: Schema.NullOr(TrimmedString),
  lastAuthType: Schema.NullOr(TrimmedString),
  managed: Schema.Boolean,
});
export type CodexProfileSummary = typeof CodexProfileSummary.Type;

export const CodexProfileLockInfo = Schema.Struct({
  reason: TrimmedString,
  runningThreads: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      title: TrimmedString,
    }),
  ),
});
export type CodexProfileLockInfo = typeof CodexProfileLockInfo.Type;

export const CodexProfileState = Schema.Struct({
  activeProfileId: Schema.NullOr(CodexProfileId),
  profiles: Schema.Array(CodexProfileSummary),
  switchLocked: Schema.Boolean,
  lockInfo: Schema.NullOr(CodexProfileLockInfo),
});
export type CodexProfileState = typeof CodexProfileState.Type;

export const CodexProfileReauthResult = Schema.Struct({
  state: CodexProfileState,
  logoutOutput: Schema.NullOr(Schema.String),
  instructions: Schema.Array(Schema.String),
});
export type CodexProfileReauthResult = typeof CodexProfileReauthResult.Type;

export const CodexProfileAddInput = Schema.Struct({
  label: TrimmedString,
});
export type CodexProfileAddInput = typeof CodexProfileAddInput.Type;

export const CodexProfileRemoveInput = Schema.Struct({
  profileId: CodexProfileId,
});
export type CodexProfileRemoveInput = typeof CodexProfileRemoveInput.Type;

export const CodexProfileSwitchInput = Schema.Struct({
  profileId: CodexProfileId,
});
export type CodexProfileSwitchInput = typeof CodexProfileSwitchInput.Type;

export const CodexProfileReauthInput = Schema.Struct({
  profileId: CodexProfileId,
});
export type CodexProfileReauthInput = typeof CodexProfileReauthInput.Type;

export class CodexProfilesError extends Schema.TaggedErrorClass<CodexProfilesError>()(
  "CodexProfilesError",
  {
    message: Schema.String,
    code: Schema.Literals([
      "profile-not-found",
      "profile-in-use",
      "switch-locked",
      "invalid-label",
      "command-failed",
      "not-supported",
    ]),
    details: Schema.optional(Schema.Unknown),
  },
) {}
