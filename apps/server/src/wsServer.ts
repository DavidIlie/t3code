/**
 * Server - HTTP/WebSocket server service interface.
 *
 * Owns startup and shutdown lifecycle of the HTTP server, static asset serving,
 * and WebSocket request routing.
 *
 * @module Server
 */
import http from "node:http";
import type { Duplex } from "node:stream";

import Mime from "@effect/platform-node/Mime";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ClientOrchestrationCommand,
  type OrchestrationCommand,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  ProjectId,
  ThreadId,
  WS_CHANNELS,
  WS_METHODS,
  WebSocketRequest,
  type WsResponse as WsResponseMessage,
  WsResponse,
  type WsPushEnvelopeBase,
} from "@t3tools/contracts";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  Cause,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Ref,
  Result,
  Schema,
  Scope,
  ServiceMap,
  Stream,
  Struct,
} from "effect";
import { WebSocketServer, type WebSocket } from "ws";

import { createLogger } from "./logger";
import { GitManager } from "./git/Services/GitManager.ts";
import { TerminalManager } from "./terminal/Services/Manager.ts";
import { Keybindings } from "./keybindings";
import { searchWorkspaceEntries } from "./workspaceEntries";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { OrchestrationReactor } from "./orchestration/Services/OrchestrationReactor";
import { ProviderService } from "./provider/Services/ProviderService";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { clamp } from "effect/Number";
import { Open, resolveAvailableEditors } from "./open";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore.ts";
import { tryHandleProjectFaviconRequest, tryHandleProjectIconRequest } from "./projectFaviconRoute";
import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { parseBase64DataUrl } from "./imageMime.ts";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService.ts";
import { expandHomePath } from "./os-jank.ts";
import { makeServerPushBus } from "./wsServer/pushBus.ts";
import { makeServerReadiness } from "./wsServer/readiness.ts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";
import { fetchProviderUsage } from "./providerUsage.ts";

/**
 * ServerShape - Service API for server lifecycle control.
 */
export interface ServerShape {
  /**
   * Start HTTP and WebSocket listeners.
   */
  readonly start: Effect.Effect<
    http.Server,
    ServerLifecycleError,
    Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >;

  /**
   * Wait for process shutdown signals.
   */
  readonly stopSignal: Effect.Effect<void, never>;
}

/**
 * Server - Service tag for HTTP/WebSocket lifecycle management.
 */
export class Server extends ServiceMap.Service<Server, ServerShape>()("t3/wsServer/Server") {}

const isServerNotRunningError = (error: Error): boolean => {
  const maybeCode = (error as NodeJS.ErrnoException).code;
  return (
    maybeCode === "ERR_SERVER_NOT_RUNNING" || error.message.toLowerCase().includes("not running")
  );
};

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      "\r\n" +
      message,
  );
}

function websocketRawToString(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  if (Array.isArray(raw)) {
    const chunks: string[] = [];
    for (const chunk of raw) {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        continue;
      }
      if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk).toString("utf8"));
        continue;
      }
      if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(new Uint8Array(chunk)).toString("utf8"));
        continue;
      }
      return null;
    }
    return chunks.join("");
  }
  return null;
}

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function resolveWorkspaceWritePath(params: {
  workspaceRoot: string;
  relativePath: string;
  path: Path.Path;
}): Effect.Effect<{ absolutePath: string; relativePath: string }, RouteRequestError> {
  const normalizedInputPath = params.relativePath.trim();
  if (params.path.isAbsolute(normalizedInputPath)) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must be relative to the project root.",
      }),
    );
  }

  const absolutePath = params.path.resolve(params.workspaceRoot, normalizedInputPath);
  const relativeToRoot = toPosixRelativePath(
    params.path.relative(params.workspaceRoot, absolutePath),
  );
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === "." ||
    relativeToRoot.startsWith("../") ||
    relativeToRoot === ".." ||
    params.path.isAbsolute(relativeToRoot)
  ) {
    return Effect.fail(
      new RouteRequestError({
        message: "Workspace file path must stay within the project root.",
      }),
    );
  }

  return Effect.succeed({
    absolutePath,
    relativePath: relativeToRoot,
  });
}

function stripRequestTag<T extends { _tag: string }>(body: T) {
  return Struct.omit(body, ["_tag"]);
}

const encodeWsResponse = Schema.encodeEffect(Schema.fromJsonString(WsResponse));
const decodeWebSocketRequest = decodeJsonResult(WebSocketRequest);

export type ServerCoreRuntimeServices =
  | OrchestrationEngineService
  | ProjectionSnapshotQuery
  | CheckpointDiffQuery
  | OrchestrationReactor
  | ProviderService
  | ProviderHealth;

export type ServerRuntimeServices =
  | ServerCoreRuntimeServices
  | GitManager
  | GitCore
  | TerminalManager
  | Keybindings
  | Open
  | AnalyticsService;

export class ServerLifecycleError extends Schema.TaggedErrorClass<ServerLifecycleError>()(
  "ServerLifecycleError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

class RouteRequestError extends Schema.TaggedErrorClass<RouteRequestError>()("RouteRequestError", {
  message: Schema.String,
}) {}

export const createServer = Effect.fn(function* (): Effect.fn.Return<
  http.Server,
  ServerLifecycleError,
  Scope.Scope | ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
> {
  const serverConfig = yield* ServerConfig;
  const {
    port,
    cwd,
    keybindingsConfigPath,
    staticDir,
    devUrl,
    authToken,
    host,
    logWebSocketEvents,
    autoBootstrapProjectFromCwd,
  } = serverConfig;
  const availableEditors = resolveAvailableEditors();

  const gitManager = yield* GitManager;
  const terminalManager = yield* TerminalManager;
  const keybindingsManager = yield* Keybindings;
  const providerHealth = yield* ProviderHealth;
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const providerStatuses = yield* providerHealth.getStatuses;

  const clients = yield* Ref.make(new Set<WebSocket>());
  const logger = createLogger("ws");
  const readiness = yield* makeServerReadiness;

  function logOutgoingPush(push: WsPushEnvelopeBase, recipients: number) {
    if (!logWebSocketEvents) return;
    logger.event("outgoing push", {
      channel: push.channel,
      sequence: push.sequence,
      recipients,
      payload: push.data,
    });
  }

  const pushBus = yield* makeServerPushBus({
    clients,
    logOutgoingPush,
  });
  yield* readiness.markPushBusReady;
  yield* keybindingsManager.start.pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "keybindingsRuntimeStart", cause }),
    ),
  );
  yield* readiness.markKeybindingsReady;

  const normalizeDispatchCommand = Effect.fnUntraced(function* (input: {
    readonly command: ClientOrchestrationCommand;
  }) {
    const normalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (workspaceRoot: string) {
      const normalizedWorkspaceRoot = path.resolve(yield* expandHomePath(workspaceRoot.trim()));
      const workspaceStat = yield* fileSystem
        .stat(normalizedWorkspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!workspaceStat) {
        return yield* new RouteRequestError({
          message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
        });
      }
      if (workspaceStat.type !== "Directory") {
        return yield* new RouteRequestError({
          message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
        });
      }
      return normalizedWorkspaceRoot;
    });

    if (input.command.type === "project.create") {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      return {
        ...input.command,
        workspaceRoot: yield* normalizeProjectWorkspaceRoot(input.command.workspaceRoot),
      } satisfies OrchestrationCommand;
    }

    if (input.command.type !== "thread.turn.start") {
      return input.command as OrchestrationCommand;
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          const parsed = parseBase64DataUrl(attachment.dataUrl);
          if (!parsed || !parsed.mimeType.startsWith("image/")) {
            return yield* new RouteRequestError({
              message: `Invalid image attachment payload for '${attachment.name}'.`,
            });
          }

          const bytes = Buffer.from(parsed.base64, "base64");
          if (bytes.byteLength === 0 || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
            return yield* new RouteRequestError({
              message: `Image attachment '${attachment.name}' is empty or too large.`,
            });
          }

          const attachmentId = createAttachmentId(turnStartCommand.threadId);
          if (!attachmentId) {
            return yield* new RouteRequestError({
              message: "Failed to create a safe attachment id.",
            });
          }

          const persistedAttachment = {
            type: "image" as const,
            id: attachmentId,
            name: attachment.name,
            mimeType: parsed.mimeType.toLowerCase(),
            sizeBytes: bytes.byteLength,
          };

          const attachmentPath = resolveAttachmentPath({
            stateDir: serverConfig.stateDir,
            attachment: persistedAttachment,
          });
          if (!attachmentPath) {
            return yield* new RouteRequestError({
              message: `Failed to resolve persisted path for '${attachment.name}'.`,
            });
          }

          yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true }).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to create attachment directory for '${attachment.name}'.`,
                }),
            ),
          );
          yield* fileSystem.writeFile(attachmentPath, bytes).pipe(
            Effect.mapError(
              () =>
                new RouteRequestError({
                  message: `Failed to persist attachment '${attachment.name}'.`,
                }),
            ),
          );

          return persistedAttachment;
        }),
      { concurrency: 1 },
    );

    return {
      ...turnStartCommand,
      message: {
        ...turnStartCommand.message,
        attachments: normalizedAttachments,
      },
    } satisfies OrchestrationCommand;
  });

  // HTTP server — serves static files or redirects to Vite dev server
  const httpServer = http.createServer((req, res) => {
    const respond = (
      statusCode: number,
      headers: Record<string, string>,
      body?: string | Uint8Array,
    ) => {
      res.writeHead(statusCode, headers);
      res.end(body);
    };

    void Effect.runPromise(
      Effect.gen(function* () {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (tryHandleProjectFaviconRequest(url, res)) {
          return;
        }
        if (tryHandleProjectIconRequest(url, res)) {
          return;
        }

        if (url.pathname.startsWith(ATTACHMENTS_ROUTE_PREFIX)) {
          const rawRelativePath = url.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
          const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
          if (!normalizedRelativePath) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid attachment path");
            return;
          }

          const isIdLookup =
            !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
          const filePath = isIdLookup
            ? resolveAttachmentPathById({
                stateDir: serverConfig.stateDir,
                attachmentId: normalizedRelativePath,
              })
            : resolveAttachmentRelativePath({
                stateDir: serverConfig.stateDir,
                relativePath: normalizedRelativePath,
              });
          if (!filePath) {
            respond(
              isIdLookup ? 404 : 400,
              { "Content-Type": "text/plain" },
              isIdLookup ? "Not Found" : "Invalid attachment path",
            );
            return;
          }

          const fileInfo = yield* fileSystem
            .stat(filePath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!fileInfo || fileInfo.type !== "File") {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }

          const contentType = Mime.getType(filePath) ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          const streamExit = yield* Stream.runForEach(fileSystem.stream(filePath), (chunk) =>
            Effect.sync(() => {
              if (!res.destroyed) {
                res.write(chunk);
              }
            }),
          ).pipe(Effect.exit);
          if (Exit.isFailure(streamExit)) {
            if (!res.destroyed) {
              res.destroy();
            }
            return;
          }
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        // In dev mode, redirect to Vite dev server
        if (devUrl) {
          respond(302, { Location: devUrl.href });
          return;
        }

        // Serve static files from the web app build
        if (!staticDir) {
          respond(
            503,
            { "Content-Type": "text/plain" },
            "No static directory configured and no dev URL set.",
          );
          return;
        }

        const staticRoot = path.resolve(staticDir);
        const staticRequestPath = url.pathname === "/" ? "/index.html" : url.pathname;
        const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
        const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
        const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
        const hasPathTraversalSegment = staticRelativePath.startsWith("..");
        if (
          staticRelativePath.length === 0 ||
          hasRawLeadingParentSegment ||
          hasPathTraversalSegment ||
          staticRelativePath.includes("\0")
        ) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const isWithinStaticRoot = (candidate: string) =>
          candidate === staticRoot ||
          candidate.startsWith(
            staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`,
          );

        let filePath = path.resolve(staticRoot, staticRelativePath);
        if (!isWithinStaticRoot(filePath)) {
          respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
          return;
        }

        const ext = path.extname(filePath);
        if (!ext) {
          filePath = path.resolve(filePath, "index.html");
          if (!isWithinStaticRoot(filePath)) {
            respond(400, { "Content-Type": "text/plain" }, "Invalid static file path");
            return;
          }
        }

        const fileInfo = yield* fileSystem
          .stat(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!fileInfo || fileInfo.type !== "File") {
          const indexPath = path.resolve(staticRoot, "index.html");
          const indexData = yield* fileSystem
            .readFile(indexPath)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!indexData) {
            respond(404, { "Content-Type": "text/plain" }, "Not Found");
            return;
          }
          respond(200, { "Content-Type": "text/html; charset=utf-8" }, indexData);
          return;
        }

        const contentType = Mime.getType(filePath) ?? "application/octet-stream";
        const data = yield* fileSystem
          .readFile(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!data) {
          respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
          return;
        }
        respond(200, { "Content-Type": contentType }, data);
      }),
    ).catch(() => {
      if (!res.headersSent) {
        respond(500, { "Content-Type": "text/plain" }, "Internal Server Error");
      }
    });
  });

  // WebSocket server — upgrades from the HTTP server
  const wss = new WebSocketServer({ noServer: true });

  const closeWebSocketServer = Effect.callback<void, ServerLifecycleError>((resume) => {
    wss.close((error) => {
      if (error && !isServerNotRunningError(error)) {
        resume(
          Effect.fail(
            new ServerLifecycleError({ operation: "closeWebSocketServer", cause: error }),
          ),
        );
      } else {
        resume(Effect.void);
      }
    });
  });

  const closeAllClients = Ref.get(clients).pipe(
    Effect.flatMap(Effect.forEach((client) => Effect.sync(() => client.close()))),
    Effect.flatMap(() => Ref.set(clients, new Set())),
  );

  const listenOptions = host ? { host, port } : { port };

  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
  const checkpointDiffQuery = yield* CheckpointDiffQuery;
  const orchestrationReactor = yield* OrchestrationReactor;
  const { openInEditor } = yield* Open;
  const providerService = yield* ProviderService;

  const subscriptionsScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(subscriptionsScope, Exit.void));

  yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
    pushBus.publishAll(ORCHESTRATION_WS_CHANNELS.domainEvent, event),
  ).pipe(Effect.forkIn(subscriptionsScope));

  yield* Stream.runForEach(keybindingsManager.streamChanges, (event) =>
    pushBus.publishAll(WS_CHANNELS.serverConfigUpdated, {
      issues: event.issues,
      providers: providerStatuses,
    }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  // Forward provider runtime rate-limit events to clients
  yield* Stream.runForEach(
    providerService.streamEvents.pipe(
      Stream.filter((event) => event.type === "account.rate-limits.updated"),
    ),
    (event) =>
      pushBus.publishAll(WS_CHANNELS.providerAccountUpdated, {
        provider: event.provider,
        data: (event.payload as Record<string, unknown>)?.rateLimits ?? event.payload,
      }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  // Forward provider session.configured and mcp.status.updated events to clients
  yield* Stream.runForEach(
    providerService.streamEvents.pipe(
      Stream.filter(
        (event) => event.type === "session.configured" || event.type === "mcp.status.updated",
      ),
    ),
    (event) =>
      Effect.gen(function* () {
        const payload = event.payload as Record<string, unknown>;
        const threadId =
          typeof event.threadId === "string" ? event.threadId : undefined;
        if (!threadId) return;

        if (event.type === "session.configured") {
          const config = payload.config as Record<string, unknown> | undefined;
          const commands = Array.isArray(config?.commands)
            ? (config.commands as Array<{ name: string; description: string; argumentHint?: string }>)
            : [];
          yield* pushBus.publishAll(WS_CHANNELS.providerSessionConfigured, {
            threadId,
            commands,
            mcpServers: [],
          });
        } else if (event.type === "mcp.status.updated") {
          const status = Array.isArray(payload.status) ? payload.status : [];
          yield* pushBus.publishAll(WS_CHANNELS.providerSessionConfigured, {
            threadId,
            commands: [],
            mcpServers: status as Array<{
              name: string;
              status: string;
              tools?: Array<{ name: string; description?: string }>;
            }>,
          });
        }
      }),
  ).pipe(Effect.forkIn(subscriptionsScope));

  // Periodic usage push (initial after 3s, then every 5 min)
  yield* Effect.gen(function* () {
    yield* Effect.sleep(Duration.seconds(3));
    const pushUsage = Effect.gen(function* () {
      const usage = yield* Effect.tryPromise(() => fetchProviderUsage());
      if (usage.claudeCode.available && usage.claudeCode.tiers.length > 0) {
        yield* pushBus.publishAll(WS_CHANNELS.providerAccountUpdated, {
          provider: "claudeCode",
          data: usage.claudeCode,
        });
      }
    }).pipe(Effect.catch(() => Effect.void));

    while (true) {
      yield* pushUsage;
      yield* Effect.sleep(Duration.minutes(5));
    }
  }).pipe(Effect.forkIn(subscriptionsScope));

  yield* Scope.provide(orchestrationReactor.start, subscriptionsScope);
  yield* readiness.markOrchestrationSubscriptionsReady;

  let welcomeBootstrapProjectId: ProjectId | undefined;
  let welcomeBootstrapThreadId: ThreadId | undefined;

  if (autoBootstrapProjectFromCwd) {
    yield* Effect.gen(function* () {
      const snapshot = yield* projectionReadModelQuery.getSnapshot();
      const existingProject = snapshot.projects.find(
        (project) => project.workspaceRoot === cwd && project.deletedAt === null,
      );
      let bootstrapProjectId: ProjectId;
      let bootstrapProjectDefaultModel: string;

      if (!existingProject) {
        const createdAt = new Date().toISOString();
        bootstrapProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
        const bootstrapProjectTitle = path.basename(cwd) || "project";
        bootstrapProjectDefaultModel = "gpt-5-codex";
        yield* orchestrationEngine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          projectId: bootstrapProjectId,
          title: bootstrapProjectTitle,
          workspaceRoot: cwd,
          defaultModel: bootstrapProjectDefaultModel,
          createdAt,
        });
      } else {
        bootstrapProjectId = existingProject.id;
        bootstrapProjectDefaultModel = existingProject.defaultModel ?? "gpt-5-codex";
      }

      const existingThread = snapshot.threads.find(
        (thread) => thread.projectId === bootstrapProjectId && thread.deletedAt === null,
      );
      if (!existingThread) {
        const createdAt = new Date().toISOString();
        const threadId = ThreadId.makeUnsafe(crypto.randomUUID());
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          threadId,
          projectId: bootstrapProjectId,
          title: "New thread",
          model: bootstrapProjectDefaultModel,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = threadId;
      } else {
        welcomeBootstrapProjectId = bootstrapProjectId;
        welcomeBootstrapThreadId = existingThread.id;
      }
    }).pipe(
      Effect.mapError(
        (cause) => new ServerLifecycleError({ operation: "autoBootstrapProject", cause }),
      ),
    );
  }

  // Ensure a Home project exists for general-purpose chat
  let welcomeHomeProjectId: ProjectId | undefined;
  yield* Effect.gen(function* () {
    const snapshot = yield* projectionReadModelQuery.getSnapshot();
    const homeDir = process.env.HOME || process.env.USERPROFILE || cwd;
    const existingHomeProject = snapshot.projects.find(
      (p) => p.title === "Home" && p.deletedAt === null,
    );
    if (!existingHomeProject) {
      const homeProjectId = ProjectId.makeUnsafe(crypto.randomUUID());
      yield* orchestrationEngine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe(crypto.randomUUID()),
        projectId: homeProjectId,
        title: "Home",
        workspaceRoot: homeDir,
        createdAt: new Date().toISOString(),
      });
      welcomeHomeProjectId = homeProjectId;
    } else {
      welcomeHomeProjectId = existingHomeProject.id;
    }
  }).pipe(
    Effect.mapError(
      (cause) => new ServerLifecycleError({ operation: "autoBootstrapHomeProject", cause }),
    ),
  );

  // Read ~/.claude/mcp.json for pre-session MCP server list
  type WelcomeMcpServer = { name: string; type: string; status: string };
  let welcomeMcpServers: WelcomeMcpServer[] | undefined;
  yield* Effect.gen(function* () {
    const homeDir = process.env.HOME || process.env.USERPROFILE || cwd;
    const fs = yield* FileSystem.FileSystem;
    const servers: WelcomeMcpServer[] = [];
    const seen = new Set<string>();

    // 1. Read ~/.claude/mcp.json
    const mcpConfigPath = `${homeDir}/.claude/mcp.json`;
    const configExists = yield* fs.exists(mcpConfigPath);
    if (configExists) {
      const raw = yield* fs.readFileString(mcpConfigPath);
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { type?: string }> };
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        for (const [name, config] of Object.entries(parsed.mcpServers)) {
          if (!seen.has(name)) {
            seen.add(name);
            servers.push({ name, type: config.type ?? "unknown", status: "configured" });
          }
        }
      }
    }

    // 2. Scan installed plugins at ~/.claude/plugins/marketplaces/*/external_plugins/*/
    const pluginsBase = path.join(homeDir, ".claude", "plugins", "marketplaces");
    const pluginsBaseExists = yield* fs.exists(pluginsBase);
    if (pluginsBaseExists) {
      const marketplaces = yield* fs.readDirectory(pluginsBase);
      for (const marketplace of marketplaces) {
        const extDir = path.join(pluginsBase, marketplace, "external_plugins");
        const extExists = yield* fs.exists(extDir);
        if (!extExists) continue;
        const plugins = yield* fs.readDirectory(extDir);
        for (const plugin of plugins) {
          if (seen.has(plugin)) continue;
          const pluginMcp = path.join(extDir, plugin, ".mcp.json");
          const pluginMcpExists = yield* fs.exists(pluginMcp);
          if (!pluginMcpExists) continue;
          const raw = yield* fs.readFileString(pluginMcp);
          try {
            const parsed = JSON.parse(raw) as Record<string, { type?: string; command?: string }>;
            for (const [name, config] of Object.entries(parsed)) {
              if (!seen.has(name)) {
                seen.add(name);
                servers.push({
                  name,
                  type: config.type ?? (config.command ? "stdio" : "unknown"),
                  status: "configured",
                });
              }
            }
          } catch {
            // skip malformed plugin configs
          }
        }
      }
    }

    if (servers.length > 0) {
      welcomeMcpServers = servers;
    }
  }).pipe(Effect.catch(() => Effect.void));

  const runtimeServices = yield* Effect.services<
    ServerRuntimeServices | ServerConfig | FileSystem.FileSystem | Path.Path
  >();
  const runPromise = Effect.runPromiseWith(runtimeServices);

  const unsubscribeTerminalEvents = yield* terminalManager.subscribe(
    (event) => void Effect.runPromise(pushBus.publishAll(WS_CHANNELS.terminalEvent, event)),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => unsubscribeTerminalEvents()));
  yield* readiness.markTerminalSubscriptionsReady;

  yield* NodeHttpServer.make(() => httpServer, listenOptions).pipe(
    Effect.mapError((cause) => new ServerLifecycleError({ operation: "httpServerListen", cause })),
  );
  yield* readiness.markHttpListening;

  yield* Effect.addFinalizer(() =>
    Effect.all([closeAllClients, closeWebSocketServer.pipe(Effect.ignoreCause({ log: true }))]),
  );

  const routeRequest = Effect.fnUntraced(function* (request: WebSocketRequest) {
    switch (request.body._tag) {
      case ORCHESTRATION_WS_METHODS.getSnapshot:
        return yield* projectionReadModelQuery.getSnapshot();

      case ORCHESTRATION_WS_METHODS.dispatchCommand: {
        const { command } = request.body;
        const normalizedCommand = yield* normalizeDispatchCommand({ command });
        return yield* orchestrationEngine.dispatch(normalizedCommand);
      }

      case ORCHESTRATION_WS_METHODS.getTurnDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getTurnDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.getFullThreadDiff: {
        const body = stripRequestTag(request.body);
        return yield* checkpointDiffQuery.getFullThreadDiff(body);
      }

      case ORCHESTRATION_WS_METHODS.replayEvents: {
        const { fromSequenceExclusive } = request.body;
        return yield* Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(Effect.map((events) => Array.from(events)));
      }

      case WS_METHODS.projectsSearchEntries: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: () => searchWorkspaceEntries(body),
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to search workspace entries: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsImportHistory: {
        const body = stripRequestTag(request.body);
        const allSessions = yield* Effect.tryPromise({
          try: async () => {
            const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
            return listSessions({ dir: body.workspaceRoot, limit: 100 });
          },
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to import Claude Code history: ${String(cause)}`,
            }),
        });

        // Filter out sessions already tracked by T3 Gurt's Claude Code provider
        // to prevent duplicate thread creation during import sync.
        // Check both persisted bindings and active in-memory sessions.
        const trackedIds = yield* providerService.listTrackedClaudeSessionIds();
        const trackedSet = new Set(trackedIds);

        const activeSessions = yield* providerService
          .listSessions()
          .pipe(
            Effect.catch(() => Effect.succeed([] as ReadonlyArray<{ resumeCursor?: unknown }>)),
          );
        for (const session of activeSessions) {
          const cursor = session.resumeCursor as { resume?: string } | null | undefined;
          if (cursor && typeof cursor.resume === "string") {
            trackedSet.add(cursor.resume);
          }
        }

        return {
          sessions: allSessions
            .filter((s) => !trackedSet.has(s.sessionId))
            .map((s) => ({
              sessionId: s.sessionId,
              summary: s.summary,
              lastModified: s.lastModified,
              fileSize: s.fileSize,
            })),
        };
      }

      case WS_METHODS.projectsGetSessionMessages: {
        const body = stripRequestTag(request.body);
        return yield* Effect.tryPromise({
          try: async () => {
            const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
            const messages = await getSessionMessages(body.sessionId, {
              dir: body.workspaceRoot,
              ...(body.limit != null ? { limit: body.limit } : {}),
            });

            type ContentBlock = Record<string, unknown>;
            interface ParsedBlock {
              type: string;
              [key: string]: unknown;
            }

            // First pass: extract all content blocks per message
            const parsed = messages.map((msg) => {
              const message = msg.message as { content?: unknown | unknown[] } | undefined;
              const contentArr = Array.isArray(message?.content)
                ? (message!.content as ContentBlock[])
                : typeof message?.content === "string"
                  ? [{ type: "text", text: message.content }]
                  : [];

              const blocks: ParsedBlock[] = [];
              for (const b of contentArr) {
                switch (b.type) {
                  case "text":
                    if (typeof b.text === "string" && b.text.trim())
                      blocks.push({ type: "text", text: b.text });
                    break;
                  case "thinking":
                    if (typeof b.thinking === "string" && b.thinking.trim())
                      blocks.push({ type: "thinking", thinking: b.thinking });
                    break;
                  case "tool_use":
                    blocks.push({
                      type: "tool_use",
                      id: String(b.id),
                      name: String(b.name),
                      input: (b.input as Record<string, unknown>) ?? {},
                    });
                    break;
                  case "tool_result":
                    blocks.push({
                      type: "tool_result",
                      toolUseId: String(b.tool_use_id),
                      content: b.content,
                      isError: Boolean(b.is_error),
                    });
                    break;
                }
              }

              return {
                type: msg.type as "user" | "assistant",
                uuid: msg.uuid,
                sessionId: msg.session_id,
                blocks,
              };
            });

            // Second pass: pair tool_result blocks with their tool_use blocks
            const resultMap = new Map<string, { content: unknown; isError: boolean }>();
            for (const msg of parsed) {
              for (const block of msg.blocks) {
                if (block.type === "tool_result") {
                  resultMap.set(block.toolUseId as string, {
                    content: block.content,
                    isError: block.isError as boolean,
                  });
                }
              }
            }
            for (const msg of parsed) {
              for (const block of msg.blocks) {
                if (block.type === "tool_use") {
                  const result = resultMap.get(block.id as string);
                  if (result) block.result = result;
                }
              }
            }

            // Filter out user messages that only contain tool_result blocks,
            // and strip tool_result blocks from remaining messages
            const result = [];
            for (const msg of parsed) {
              if (msg.type === "user" && !msg.blocks.some((b) => b.type !== "tool_result")) {
                continue;
              }
              msg.blocks = msg.blocks.filter((b) => b.type !== "tool_result");
              result.push(msg);
            }
            return result;
          },
          catch: (cause) =>
            new RouteRequestError({
              message: `Failed to get session messages: ${String(cause)}`,
            }),
        });
      }

      case WS_METHODS.projectsGetMcpServers: {
        const body = stripRequestTag(request.body);
        return yield* Effect.gen(function* () {
          interface McpServerInfo {
            name: string;
            type: string;
            status: string;
            source: string;
            command?: string;
            args?: string[];
            url?: string;
          }
          const servers: McpServerInfo[] = [];
          const seen = new Set<string>();
          const homeDir = process.env.HOME || process.env.USERPROFILE || cwd;

          function addFromMcpServersRecord(
            record: Record<
              string,
              { type?: string; command?: string; args?: string[]; url?: string }
            >,
            source: string,
          ) {
            for (const [name, config] of Object.entries(record)) {
              if (seen.has(name)) continue;
              seen.add(name);
              const inferredType =
                config.type ?? (config.command ? "stdio" : config.url ? "sse" : "unknown");
              servers.push({
                name,
                type: inferredType,
                status: "configured",
                source,
                ...(config.command ? { command: config.command } : {}),
                ...(config.args ? { args: config.args } : {}),
                ...(config.url ? { url: config.url } : {}),
              });
            }
          }

          // 1. Project-local configs
          const candidates = [
            path.join(body.workspaceRoot, ".mcp.json"),
            path.join(body.workspaceRoot, ".claude", "mcp.json"),
          ];
          for (const configPath of candidates) {
            const exists = yield* fileSystem.exists(configPath);
            if (!exists) continue;
            const raw = yield* fileSystem.readFileString(configPath);
            const parsed = JSON.parse(raw) as {
              mcpServers?: Record<
                string,
                { type?: string; command?: string; args?: string[]; url?: string }
              >;
            };
            if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
              addFromMcpServersRecord(parsed.mcpServers, "project");
            }
          }

          // 2. Global ~/.claude/mcp.json
          const globalMcpPath = path.join(homeDir, ".claude", "mcp.json");
          const globalMcpExists = yield* fileSystem.exists(globalMcpPath);
          if (globalMcpExists) {
            const raw = yield* fileSystem.readFileString(globalMcpPath);
            const parsed = JSON.parse(raw) as {
              mcpServers?: Record<
                string,
                { type?: string; command?: string; args?: string[]; url?: string }
              >;
            };
            if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
              addFromMcpServersRecord(parsed.mcpServers, "global");
            }
          }

          // 3. Cursor MCP config (~/.cursor/mcp.json)
          const cursorMcpPath = path.join(homeDir, ".cursor", "mcp.json");
          const cursorMcpExists = yield* fileSystem.exists(cursorMcpPath);
          if (cursorMcpExists) {
            const raw = yield* fileSystem.readFileString(cursorMcpPath);
            try {
              const parsed = JSON.parse(raw) as {
                mcpServers?: Record<
                  string,
                  { type?: string; command?: string; args?: string[]; url?: string }
                >;
              } & Record<
                string,
                { type?: string; command?: string; args?: string[]; url?: string }
              >;
              // Cursor uses { mcpServers: {...} } OR top-level { name: config }
              if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
                addFromMcpServersRecord(parsed.mcpServers, "cursor");
              } else {
                // Top-level keys are server names
                const topLevel: Record<
                  string,
                  { type?: string; command?: string; args?: string[]; url?: string }
                > = {};
                for (const [key, val] of Object.entries(parsed)) {
                  if (
                    key !== "mcpServers" &&
                    val &&
                    typeof val === "object" &&
                    ("command" in val || "url" in val)
                  ) {
                    topLevel[key] = val;
                  }
                }
                if (Object.keys(topLevel).length > 0) {
                  addFromMcpServersRecord(topLevel, "cursor");
                }
              }
            } catch {
              // skip malformed cursor config
            }
          }

          // 4. Scan installed Claude Code plugins
          const pluginsBase = path.join(homeDir, ".claude", "plugins", "marketplaces");
          const pluginsBaseExists = yield* fileSystem.exists(pluginsBase);
          if (pluginsBaseExists) {
            const marketplaces = yield* fileSystem.readDirectory(pluginsBase);
            for (const marketplace of marketplaces) {
              const extDir = path.join(pluginsBase, marketplace, "external_plugins");
              const extExists = yield* fileSystem.exists(extDir);
              if (!extExists) continue;
              const plugins = yield* fileSystem.readDirectory(extDir);
              for (const plugin of plugins) {
                if (seen.has(plugin)) continue;
                const pluginMcp = path.join(extDir, plugin, ".mcp.json");
                const pluginMcpExists = yield* fileSystem.exists(pluginMcp);
                if (!pluginMcpExists) continue;
                const raw = yield* fileSystem.readFileString(pluginMcp);
                try {
                  const parsed = JSON.parse(raw) as Record<
                    string,
                    { type?: string; command?: string; args?: string[]; url?: string }
                  >;
                  for (const [name, config] of Object.entries(parsed)) {
                    if (seen.has(name)) continue;
                    seen.add(name);
                    const inferredType = config.type ?? (config.command ? "stdio" : "unknown");
                    servers.push({
                      name,
                      type: inferredType,
                      status: "configured",
                      source: "plugin",
                      ...(config.command ? { command: config.command } : {}),
                      ...(config.args ? { args: config.args } : {}),
                      ...(config.url ? { url: config.url } : {}),
                    });
                  }
                } catch {
                  // skip malformed plugin configs
                }
              }
            }
          }

          return { servers };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to read project MCP config: ${String(cause)}`,
              }),
          ),
        );
      }

      case WS_METHODS.projectsAddMcpServer: {
        const body = stripRequestTag(request.body);
        return yield* Effect.gen(function* () {
          const configPath =
            body.scope === "global"
              ? path.join(process.env.HOME || process.env.USERPROFILE || cwd, ".claude", "mcp.json")
              : path.join(body.workspaceRoot ?? cwd, ".mcp.json");

          let existing: Record<string, unknown> = {};
          const exists = yield* fileSystem.exists(configPath);
          if (exists) {
            const raw = yield* fileSystem.readFileString(configPath);
            try {
              existing = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              existing = {};
            }
          }

          const mcpServers =
            typeof existing.mcpServers === "object" && existing.mcpServers !== null
              ? { ...(existing.mcpServers as Record<string, unknown>) }
              : {};

          const serverConfig: Record<string, unknown> = {};
          if (body.type === "stdio") {
            serverConfig.command = body.command ?? "";
            if (body.args && body.args.length > 0) {
              serverConfig.args = body.args;
            }
          } else {
            serverConfig.type = body.type;
            serverConfig.url = body.url ?? "";
          }
          mcpServers[body.name] = serverConfig;

          const dir = path.dirname(configPath);
          yield* fileSystem
            .makeDirectory(dir, { recursive: true })
            .pipe(Effect.catch(() => Effect.void));
          yield* fileSystem.writeFileString(
            configPath,
            JSON.stringify({ ...existing, mcpServers }, null, 2) + "\n",
          );
          return { ok: true };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to add MCP server: ${String(cause)}`,
              }),
          ),
        );
      }

      case WS_METHODS.projectsRemoveMcpServer: {
        const body = stripRequestTag(request.body);
        return yield* Effect.gen(function* () {
          const configPath =
            body.scope === "global"
              ? path.join(process.env.HOME || process.env.USERPROFILE || cwd, ".claude", "mcp.json")
              : path.join(body.workspaceRoot ?? cwd, ".mcp.json");

          const exists = yield* fileSystem.exists(configPath);
          if (!exists) return { ok: true };

          const raw = yield* fileSystem.readFileString(configPath);
          let existing: Record<string, unknown> = {};
          try {
            existing = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return { ok: true };
          }

          if (typeof existing.mcpServers === "object" && existing.mcpServers !== null) {
            const mcpServers = { ...(existing.mcpServers as Record<string, unknown>) };
            delete mcpServers[body.name];
            existing = { ...existing, mcpServers };
          }

          yield* fileSystem.writeFileString(configPath, JSON.stringify(existing, null, 2) + "\n");
          return { ok: true };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to remove MCP server: ${String(cause)}`,
              }),
          ),
        );
      }

      case WS_METHODS.projectsWriteFile: {
        const body = stripRequestTag(request.body);
        const target = yield* resolveWorkspaceWritePath({
          workspaceRoot: body.cwd,
          relativePath: body.relativePath,
          path,
        });
        yield* fileSystem
          .makeDirectory(path.dirname(target.absolutePath), { recursive: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new RouteRequestError({
                  message: `Failed to prepare workspace path: ${String(cause)}`,
                }),
            ),
          );
        yield* fileSystem.writeFileString(target.absolutePath, body.contents).pipe(
          Effect.mapError(
            (cause) =>
              new RouteRequestError({
                message: `Failed to write workspace file: ${String(cause)}`,
              }),
          ),
        );
        return { relativePath: target.relativePath };
      }

      case WS_METHODS.shellOpenInEditor: {
        const body = stripRequestTag(request.body);
        return yield* openInEditor(body);
      }

      case WS_METHODS.gitStatus: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.status(body);
      }

      case WS_METHODS.gitPull: {
        const body = stripRequestTag(request.body);
        return yield* git.pullCurrentBranch(body.cwd);
      }

      case WS_METHODS.gitRunStackedAction: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.runStackedAction(body);
      }

      case WS_METHODS.gitResolvePullRequest: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.resolvePullRequest(body);
      }

      case WS_METHODS.gitPreparePullRequestThread: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.preparePullRequestThread(body);
      }

      case WS_METHODS.gitGenerateCommitMessage: {
        const body = stripRequestTag(request.body);
        return yield* gitManager.generateCommitMessage(body);
      }

      case WS_METHODS.gitListBranches: {
        const body = stripRequestTag(request.body);
        return yield* git.listBranches(body);
      }

      case WS_METHODS.gitCreateWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.createWorktree(body);
      }

      case WS_METHODS.gitRemoveWorktree: {
        const body = stripRequestTag(request.body);
        return yield* git.removeWorktree(body);
      }

      case WS_METHODS.gitCreateBranch: {
        const body = stripRequestTag(request.body);
        return yield* git.createBranch(body);
      }

      case WS_METHODS.gitCheckout: {
        const body = stripRequestTag(request.body);
        return yield* Effect.scoped(git.checkoutBranch(body));
      }

      case WS_METHODS.gitInit: {
        const body = stripRequestTag(request.body);
        return yield* git.initRepo(body);
      }

      case WS_METHODS.gitLog: {
        const body = stripRequestTag(request.body);
        return yield* git.log(body);
      }

      case WS_METHODS.gitShowCommitDiff: {
        const body = stripRequestTag(request.body);
        return yield* git.showCommitDiff(body);
      }

      case WS_METHODS.terminalOpen: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.open(body);
      }

      case WS_METHODS.terminalWrite: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.write(body);
      }

      case WS_METHODS.terminalResize: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.resize(body);
      }

      case WS_METHODS.terminalClear: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.clear(body);
      }

      case WS_METHODS.terminalRestart: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.restart(body);
      }

      case WS_METHODS.terminalClose: {
        const body = stripRequestTag(request.body);
        return yield* terminalManager.close(body);
      }

      case WS_METHODS.terminalListShells: {
        const shells: Array<{ path: string; label: string }> = [];
        const seen = new Set<string>();
        const addShell = (shellPath: string, label: string) => {
          if (seen.has(shellPath)) return;
          seen.add(shellPath);
          shells.push({ path: shellPath, label });
        };

        if (process.platform === "win32") {
          if (process.env.ComSpec) addShell(process.env.ComSpec, "Command Prompt");
          addShell("powershell.exe", "PowerShell");
          addShell("cmd.exe", "Command Prompt");
        } else {
          // Read /etc/shells for available shells
          try {
            const etcShells = yield* fileSystem.readFileString("/etc/shells");
            for (const line of etcShells.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith("#")) continue;
              const name = path.basename(trimmed);
              const label = name.charAt(0).toUpperCase() + name.slice(1);
              addShell(trimmed, label);
            }
          } catch {
            // Fallback if /etc/shells doesn't exist
            addShell("/bin/zsh", "Zsh");
            addShell("/bin/bash", "Bash");
            addShell("/bin/sh", "Sh");
          }

          // Ensure system default is included
          if (process.env.SHELL && !seen.has(process.env.SHELL)) {
            const name = path.basename(process.env.SHELL);
            addShell(process.env.SHELL, name.charAt(0).toUpperCase() + name.slice(1));
          }
        }

        return {
          shells,
          defaultShell:
            process.env.SHELL ?? (process.platform === "win32" ? "cmd.exe" : "/bin/bash"),
        };
      }

      case WS_METHODS.serverGetConfig:
        const keybindingsConfig = yield* keybindingsManager.loadConfigState;
        return {
          cwd,
          keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers: providerStatuses,
          availableEditors,
        };

      case WS_METHODS.serverUpsertKeybinding: {
        const body = stripRequestTag(request.body);
        const keybindingsConfig = yield* keybindingsManager.upsertKeybindingRule(body);
        return { keybindings: keybindingsConfig, issues: [] };
      }

      case WS_METHODS.providerGetUsage:
        return yield* Effect.tryPromise({
          try: () => fetchProviderUsage(),
          catch: (error) =>
            new RouteRequestError({
              message: `Failed to fetch usage: ${error instanceof Error ? error.message : "unknown error"}`,
            }),
        });

      case WS_METHODS.providerReconnectMcpServer: {
        const body = stripRequestTag(request.body);
        yield* providerService.reconnectMcpServer(body);
        return {};
      }

      case WS_METHODS.providerToggleMcpServer: {
        const body = stripRequestTag(request.body);
        yield* providerService.toggleMcpServer(body);
        return {};
      }

      default: {
        const _exhaustiveCheck: never = request.body;
        return yield* new RouteRequestError({
          message: `Unknown method: ${String(_exhaustiveCheck)}`,
        });
      }
    }
  });

  const handleMessage = Effect.fnUntraced(function* (ws: WebSocket, raw: unknown) {
    const sendWsResponse = (response: WsResponseMessage) =>
      encodeWsResponse(response).pipe(
        Effect.tap((encodedResponse) => Effect.sync(() => ws.send(encodedResponse))),
        Effect.asVoid,
      );

    const messageText = websocketRawToString(raw);
    if (messageText === null) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: "Invalid request format: Failed to read message" },
      });
    }

    const request = decodeWebSocketRequest(messageText);
    if (Result.isFailure(request)) {
      return yield* sendWsResponse({
        id: "unknown",
        error: { message: `Invalid request format: ${formatSchemaError(request.failure)}` },
      });
    }

    const result = yield* Effect.exit(routeRequest(request.success));
    if (Exit.isFailure(result)) {
      return yield* sendWsResponse({
        id: request.success.id,
        error: { message: Cause.pretty(result.cause) },
      });
    }

    return yield* sendWsResponse({
      id: request.success.id,
      result: result.value,
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    socket.on("error", () => {}); // Prevent unhandled `EPIPE`/`ECONNRESET` from crashing the process if the client disconnects mid-handshake

    if (authToken) {
      let providedToken: string | null = null;
      try {
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);
        providedToken = url.searchParams.get("token");
      } catch {
        rejectUpgrade(socket, 400, "Invalid WebSocket URL");
        return;
      }

      if (providedToken !== authToken) {
        rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const segments = cwd.split(/[/\\]/).filter(Boolean);
    const projectName = segments[segments.length - 1] ?? "project";

    const welcomeData = {
      cwd,
      projectName,
      ...(welcomeBootstrapProjectId ? { bootstrapProjectId: welcomeBootstrapProjectId } : {}),
      ...(welcomeBootstrapThreadId ? { bootstrapThreadId: welcomeBootstrapThreadId } : {}),
      ...(welcomeHomeProjectId ? { homeProjectId: welcomeHomeProjectId } : {}),
      ...(welcomeMcpServers ? { mcpServers: welcomeMcpServers } : {}),
    };
    // Send welcome before adding to broadcast set so publishAll calls
    // cannot reach this client before the welcome arrives.
    void runPromise(
      readiness.awaitServerReady.pipe(
        Effect.flatMap(() => pushBus.publishClient(ws, WS_CHANNELS.serverWelcome, welcomeData)),
        Effect.flatMap((delivered) =>
          delivered ? Ref.update(clients, (clients) => clients.add(ws)) : Effect.void,
        ),
      ),
    );

    ws.on("message", (raw) => {
      void runPromise(handleMessage(ws, raw).pipe(Effect.ignoreCause({ log: true })));
    });

    ws.on("close", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });

    ws.on("error", () => {
      void runPromise(
        Ref.update(clients, (clients) => {
          clients.delete(ws);
          return clients;
        }),
      );
    });
  });

  return httpServer;
});

export const ServerLive = Layer.succeed(Server, {
  start: createServer(),
  stopSignal: Effect.never,
} satisfies ServerShape);
