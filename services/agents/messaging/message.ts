export type MessageKind = "command" | "event" | "response";

export interface Message<TPayload = unknown> {
  readonly id: string;
  readonly kind: MessageKind;
  readonly name: string;
  readonly payload: TPayload;
  readonly createdAt: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Command<TPayload = unknown> extends Message<TPayload> {
  readonly kind: "command";
}

export interface Event<TPayload = unknown> extends Message<TPayload> {
  readonly kind: "event";
}

export interface ResponseError {
  readonly code: string;
  readonly message: string;
  readonly retriable: boolean;
}

export interface Response<TPayload = unknown> extends Message<TPayload> {
  readonly kind: "response";
  readonly success: boolean;
  readonly error?: ResponseError;
}

export interface MessageOptions {
  readonly id?: string;
  readonly createdAt?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ResponseOptions extends MessageOptions {
  readonly success?: boolean;
  readonly error?: ResponseError;
}

export function createCommand<TPayload>(
  name: string,
  payload: TPayload,
  options: MessageOptions = {},
): Command<TPayload> {
  return Object.freeze({
    ...messageFields("command", name, payload, options),
    kind: "command",
  });
}

export function createEvent<TPayload>(
  name: string,
  payload: TPayload,
  options: MessageOptions = {},
): Event<TPayload> {
  return Object.freeze({
    ...messageFields("event", name, payload, options),
    kind: "event",
  });
}

export function createResponse<TPayload>(
  name: string,
  payload: TPayload,
  options: ResponseOptions = {},
): Response<TPayload> {
  const success = options.success ?? options.error === undefined;
  if (success && options.error) {
    throw new Error("A successful response cannot contain an error.");
  }
  if (!success && !options.error) {
    throw new Error("A failed response must contain an error.");
  }

  return Object.freeze({
    ...messageFields("response", name, payload, options),
    kind: "response",
    success,
    error: options.error ? freezeResponseError(options.error) : undefined,
  });
}

export function isResponse(message: Message): message is Response {
  return message.kind === "response";
}

export function normalizeMessageName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(
      "Message name must use lowercase alphanumeric segments separated by ., _, : or -.",
    );
  }
  return normalized;
}

function messageFields<TPayload>(
  kind: MessageKind,
  name: string,
  payload: TPayload,
  options: MessageOptions,
): Message<TPayload> {
  return {
    id: requireIdentifier(options.id ?? crypto.randomUUID(), "Message id"),
    kind,
    name: normalizeMessageName(name),
    payload,
    createdAt: normalizeTimestamp(options.createdAt ?? new Date().toISOString()),
    headers: Object.freeze({ ...(options.headers ?? {}) }),
  };
}

function freezeResponseError(error: ResponseError): ResponseError {
  return Object.freeze({
    code: requireIdentifier(error.code, "Response error code"),
    message: requireText(error.message, "Response error message"),
    retriable: error.retriable,
  });
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /\s/.test(normalized)) {
    throw new Error(`${label} must be a non-empty identifier without spaces.`);
  }
  return normalized;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function normalizeTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Message createdAt must be a valid timestamp.");
  }
  return timestamp.toISOString();
}
