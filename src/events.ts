import axios from "axios";
import { readFile } from "node:fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { resolve } from "node:path";

export type EventKind =
  | "concert"
  | "sports"
  | "fair"
  | "transport-disruption"
  | "nightlife";

export interface ManualEvent {
  name: string;
  area: string;
  kind: EventKind;
  startTimeLocal: string;
  endTimeLocal: string;
  expectedAttendance: number;
}

interface EventsConfigFile {
  city?: string;
  events?: ManualEvent[];
}

interface EventSourceConfig {
  name: string;
  url: string;
  kind?: EventKind;
  defaultArea?: string;
  defaultAttendance?: number;
  maxEvents?: number;
}

interface EventSourcesFile {
  city?: string;
  sources?: EventSourceConfig[];
}

export interface EventLoadResult {
  events: ManualEvent[];
  sourceMode: "web" | "manual-fallback";
  webEventsCount: number;
  failedSources: string[];
}

const DEFAULT_CONFIG_PATH = "config/events.json";
const DEFAULT_SOURCES_PATH = "config/event-sources.json";

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function isValidEvent(event: Partial<ManualEvent>): event is ManualEvent {
  return Boolean(
    event.name &&
    event.area &&
    event.startTimeLocal &&
    event.endTimeLocal &&
    typeof event.expectedAttendance === "number" &&
    event.expectedAttendance >= 0,
  );
}

function inferArea(text: string, fallback = "Milano Centro"): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("san siro")) return "San Siro";
  if (normalized.includes("rho")) return "Rho Fiera";
  if (normalized.includes("assago") || normalized.includes("forum"))
    return "Assago";
  if (normalized.includes("navigli")) return "Navigli";
  if (normalized.includes("duomo") || normalized.includes("centro"))
    return "Milano Centro";
  if (normalized.includes("centrale")) return "Milano Centrale";
  if (normalized.includes("bicocca")) return "Bicocca";

  return fallback;
}

function inferKind(title: string, fallback: EventKind): EventKind {
  const normalized = title.toLowerCase();

  if (normalized.includes("concerto") || normalized.includes("live"))
    return "concert";
  if (
    normalized.includes("partita") ||
    normalized.includes("match") ||
    normalized.includes("vs")
  )
    return "sports";
  if (normalized.includes("fiera") || normalized.includes("expo"))
    return "fair";
  if (
    normalized.includes("metro") ||
    normalized.includes("sciopero") ||
    normalized.includes("tren")
  ) {
    return "transport-disruption";
  }
  if (
    normalized.includes("night") ||
    normalized.includes("club") ||
    normalized.includes("dj")
  )
    return "nightlife";

  return fallback;
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Rome",
  });
}

function locationToText(location: unknown): string {
  if (typeof location === "string") {
    return location;
  }

  if (!location || typeof location !== "object") {
    return "";
  }

  const loc = location as Record<string, unknown>;
  const name = typeof loc.name === "string" ? loc.name : "";
  const address = loc.address;

  if (typeof address === "string") {
    return `${name} ${address}`.trim();
  }

  if (address && typeof address === "object") {
    const addr = address as Record<string, unknown>;
    const locality =
      typeof addr.addressLocality === "string" ? addr.addressLocality : "";
    const street =
      typeof addr.streetAddress === "string" ? addr.streetAddress : "";
    return `${name} ${street} ${locality}`.trim();
  }

  return name;
}

function extractEventNodes(value: unknown): Record<string, unknown>[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractEventNodes(item));
  }

  if (typeof value !== "object") {
    return [];
  }

  const obj = value as Record<string, unknown>;
  const typeField = obj["@type"];
  const isEvent =
    (typeof typeField === "string" && typeField.toLowerCase() === "event") ||
    (Array.isArray(typeField) &&
      typeField.some(
        (item) => typeof item === "string" && item.toLowerCase() === "event",
      ));

  // Some websites publish event cards in JSON-LD without explicit @type=Event.
  const isEventLike =
    typeof obj.startDate === "string" &&
    (typeof obj.name === "string" || typeof obj.description === "string") &&
    (typeof obj.location === "string" ||
      (obj.location !== null && typeof obj.location === "object"));

  let collected: Record<string, unknown>[] =
    isEvent || isEventLike ? [obj] : [];

  for (const nested of Object.values(obj)) {
    collected = collected.concat(extractEventNodes(nested));
  }

  return collected;
}

function parseEventsFromHtml(
  html: string,
  source: EventSourceConfig,
): ManualEvent[] {
  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(scriptRegex)];

  const allEvents: ManualEvent[] = [];

  for (const match of matches) {
    const payload = match[1]?.trim();
    if (!payload) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseJson<unknown>(payload);
    } catch {
      continue;
    }

    const eventNodes = extractEventNodes(parsed);

    for (const node of eventNodes) {
      const name =
        typeof node.name === "string"
          ? node.name.trim()
          : typeof node.description === "string"
            ? node.description.trim().slice(0, 90)
            : "";
      if (!name) {
        continue;
      }

      const startTimeLocal = normalizeTime(node.startDate, "19:00");
      const endTimeLocal = normalizeTime(node.endDate, "23:00");
      const locationText = locationToText(node.location);
      const area = inferArea(
        locationText || name,
        source.defaultArea ?? "Milano Centro",
      );

      const manualEvent: Partial<ManualEvent> = {
        name,
        area,
        kind: inferKind(name, source.kind ?? "fair"),
        startTimeLocal,
        endTimeLocal,
        expectedAttendance: source.defaultAttendance ?? 5000,
      };

      if (isValidEvent(manualEvent)) {
        allEvents.push(manualEvent);
      }
    }
  }

  if (typeof source.maxEvents === "number" && source.maxEvents > 0) {
    return allEvents.slice(0, source.maxEvents);
  }

  return allEvents;
}

function dedupeEvents(events: ManualEvent[]): ManualEvent[] {
  const seen = new Set<string>();
  const deduped: ManualEvent[] = [];

  for (const event of events) {
    const key = `${event.name.toLowerCase()}|${event.area.toLowerCase()}|${event.startTimeLocal}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

async function loadEventSources(
  sourcesPath = DEFAULT_SOURCES_PATH,
): Promise<EventSourceConfig[]> {
  const absolutePath = resolve(process.cwd(), sourcesPath);
  const raw = await readFile(absolutePath, "utf-8");
  const parsed = parseJson<EventSourcesFile>(raw);

  return (
    parsed.sources?.filter((source) => Boolean(source.name && source.url)) ?? []
  );
}

async function loadEventsFromWeb(): Promise<{
  events: ManualEvent[];
  failedSources: string[];
}> {
  const sources = await loadEventSources();
  const events: ManualEvent[] = [];
  const failedSources: string[] = [];

  for (const source of sources) {
    try {
      const allowInsecureTls = process.env.EVENTS_ALLOW_INSECURE_TLS === "true";
      const response = await axios.get<string>(source.url, {
        responseType: "text",
        timeout: 12000,
        httpsAgent: allowInsecureTls
          ? new HttpsAgent({ rejectUnauthorized: false })
          : undefined,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      });

      const parsed = parseEventsFromHtml(response.data, source);
      events.push(...parsed);
    } catch {
      failedSources.push(source.name);
    }
  }

  return {
    events: dedupeEvents(events),
    failedSources,
  };
}

export async function loadManualEvents(
  configPath = DEFAULT_CONFIG_PATH,
): Promise<ManualEvent[]> {
  const absolutePath = resolve(process.cwd(), configPath);

  const raw = await readFile(absolutePath, "utf-8");
  const parsed = parseJson<EventsConfigFile>(raw);

  const events = parsed.events ?? [];

  return events.filter((event) => isValidEvent(event));
}

export async function loadRadarEvents(): Promise<EventLoadResult> {
  const webResult = await loadEventsFromWeb();

  if (webResult.events.length > 0) {
    return {
      events: webResult.events,
      sourceMode: "web",
      webEventsCount: webResult.events.length,
      failedSources: webResult.failedSources,
    };
  }

  const manualEvents = await loadManualEvents();
  return {
    events: manualEvents,
    sourceMode: "manual-fallback",
    webEventsCount: 0,
    failedSources: webResult.failedSources,
  };
}
