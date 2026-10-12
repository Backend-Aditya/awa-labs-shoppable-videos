// Structured, single-line JSON logs (Render collects stdout). Every log
// carries an event name plus whatever context identifies the shop and
// object involved, so failures that used to be silently swallowed can be
// found and counted.
type Level = "info" | "warn" | "error";
type Context = Record<string, unknown>;

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

function write(level: Level, event: string, context: Context = {}, error?: unknown) {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...context,
    ...(error === undefined ? {} : { error: serializeError(error) }),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, context?: Context) => write("info", event, context),
  warn: (event: string, context?: Context, error?: unknown) => write("warn", event, context, error),
  error: (event: string, context?: Context, error?: unknown) => write("error", event, context, error),
};
