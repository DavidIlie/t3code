import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { Effect, Layer } from "effect";

import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";

import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CLAUDE_TIMEOUT_MS = 60_000;

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }
  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

/**
 * Resolve the path to the system-installed `claude` CLI binary.
 * Returns undefined if not found.
 */
function resolveClaudeBinary(): string | undefined {
  try {
    const result = (
      execFileSync("which", ["claude"], { encoding: "utf8", timeout: 2000 }) as string
    ).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch {
    // claude not on PATH
  }
  return undefined;
}

/**
 * Run a prompt through the claude CLI and return the raw text output.
 */
function runClaudePrompt(
  operation: string,
  cwd: string,
  prompt: string,
): Effect.Effect<string, TextGenerationError> {
  return Effect.tryPromise({
    try: async () => {
      const claudePath = resolveClaudeBinary();
      if (!claudePath) {
        throw new Error("Claude CLI (`claude`) is not installed or not on PATH.");
      }
      return new Promise<string>((resolve, reject) => {
        const child = execFile(
          claudePath,
          ["-p", "--output-format", "json", "--no-session-persistence", prompt],
          {
            cwd,
            timeout: CLAUDE_TIMEOUT_MS,
            maxBuffer: 4 * 1024 * 1024,
            env: {
              ...process.env,
              CLAUDECODE: undefined,
              CLAUDE_CODE_ENTRYPOINT: undefined,
            },
          },
          (error, stdout, stderr) => {
            if (error) {
              const detail = stderr?.trim() || error.message;
              reject(new Error(`Claude CLI failed: ${detail}`));
              return;
            }
            resolve(stdout);
          },
        );
        child.stdin?.end();
      });
    },
    catch: (error) =>
      new TextGenerationError({
        operation,
        detail: error instanceof Error ? error.message : "Unknown error running claude CLI",
        cause: error,
      }),
  });
}

/**
 * Extract the text result from Claude CLI's --output-format json envelope.
 *
 * The CLI returns a JSON object like:
 *   {"type":"result","subtype":"success","result":"...text...","..."}
 * The actual model response is in the `result` string field.
 */
function extractTextFromClaudeJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    // --output-format json returns { type: "result", result: "..." }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).result === "string"
    ) {
      return (parsed as { result: string }).result;
    }
    if (typeof parsed === "string") return parsed;
  } catch {
    // Not JSON — return raw text
  }
  return raw;
}

/**
 * Strip markdown code fences and parse raw JSON from Claude's text output.
 */
function parseRawJson(
  operation: string,
  text: string,
): Effect.Effect<Record<string, unknown>, TextGenerationError> {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  return Effect.try({
    try: () => {
      const parsed = JSON.parse(cleaned) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object");
      }
      return parsed as Record<string, unknown>;
    },
    catch: (cause) =>
      new TextGenerationError({
        operation,
        detail: `Claude returned invalid structured output: ${cleaned.slice(0, 200)}`,
        cause,
      }),
  });
}

const makeClaudeTextGeneration = (() => {
  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;
    const userInstructions = (input as any).commitMessageInstructions?.trim() ?? "";

    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return ONLY a JSON object with keys: subject, body, branch. No other text."
        : "Return ONLY a JSON object with keys: subject, body. No other text.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      ...(userInstructions.length > 0
        ? ["", "Additional user instructions:", limitSection(userInstructions, 2_000)]
        : []),
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    return runClaudePrompt("generateCommitMessage", input.cwd, prompt).pipe(
      Effect.map(extractTextFromClaudeJson),
      Effect.flatMap((text) => parseRawJson("generateCommitMessage", text)),
      Effect.map((obj) => {
        const subject = typeof obj.subject === "string" ? obj.subject : "";
        const body = typeof obj.body === "string" ? obj.body : "";
        const branch = typeof obj.branch === "string" ? obj.branch : undefined;
        return {
          subject: sanitizeCommitSubject(subject),
          body: body.trim(),
          ...(wantsBranch && branch ? { branch: sanitizeFeatureBranchName(branch) } : {}),
        } satisfies CommitMessageGenerationResult;
      }),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return ONLY a JSON object with keys: title, body. No other text.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n");

    return runClaudePrompt("generatePrContent", input.cwd, prompt).pipe(
      Effect.map(extractTextFromClaudeJson),
      Effect.flatMap((text) => parseRawJson("generatePrContent", text)),
      Effect.map((obj) => {
        const title = typeof obj.title === "string" ? obj.title : "";
        const body = typeof obj.body === "string" ? obj.body : "";
        return {
          title: sanitizePrTitle(title),
          body: body.trim(),
        } satisfies PrContentGenerationResult;
      }),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (
    input: BranchNameGenerationInput,
  ) => {
    const prompt = [
      "You generate concise git branch names.",
      "Return ONLY a JSON object with key: branch. No other text.",
      "Rules:",
      "- Branch should describe the requested work from the user message.",
      "- Keep it short and specific (2-6 words).",
      "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
      "",
      "User message:",
      limitSection(input.message, 8_000),
    ].join("\n");

    return runClaudePrompt("generateBranchName", input.cwd, prompt).pipe(
      Effect.map(extractTextFromClaudeJson),
      Effect.flatMap((text) => parseRawJson("generateBranchName", text)),
      Effect.map((obj) => {
        const branch = typeof obj.branch === "string" ? obj.branch : "";
        return {
          branch: sanitizeBranchFragment(branch),
        } satisfies BranchNameGenerationResult;
      }),
    );
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
  } satisfies TextGenerationShape;
})();

export const ClaudeTextGenerationLive = Layer.succeed(TextGeneration, makeClaudeTextGeneration);
