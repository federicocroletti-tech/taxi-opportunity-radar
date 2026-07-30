import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { decode as decodeHtml } from "he";
import { readFile } from "node:fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { resolve } from "node:path";

export type EventKind =
  | "concert"
  | "sports"
  | "fair"
  | "transport-disruption"
  | "nightlife";

export type EventSourceType = "jsonld-html" | "rss";

export interface ManualEvent {
  name: string;
  area: string;
  kind: EventKind;
  startTimeLocal: string;
  endTimeLocal: string;
  expectedAttendance: number;
  venue?: string;
  source?: string;
  detail?: string;
  url?: string;
}

interface EventsConfigFile {
  city?: string;
  events?: ManualEvent[];
}

interface EventSourceConfig {
  name: string;
  url: string;
  sourceType?: EventSourceType;
  kind?: EventKind;
  defaultArea?: string;
  defaultAttendance?: number;
  maxEvents?: number;
  maxAgeHours?: number;
  maxFutureHours?: number;
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
const DEFAULT_RSS_EVENT_DURATION_HOURS = 2;
const DEFAULT_RSS_MAX_AGE_HOURS = 48;
const DEFAULT_RSS_MAX_FUTURE_HOURS = 24;
const DEFAULT_HTML_MAX_AGE_HOURS = 18;
const DEFAULT_HTML_MAX_FUTURE_HOURS = 24 * 21;
const EVENTS_TEXT_MAX_LENGTH = 200;

const NEGATIVE_EVENT_PATTERNS: RegExp[] = [
  /nessun(?:a)?\s+event(?:o|i)/i,
  /nessun(?:a)?\s+concert(?:o|i)/i,
  /non\s+[eè]\s+in\s+programma\s+alcun(?:a)?\s+concert(?:o|i)/i,
  /non\s+[eè]\s+previst[oa]\s+alcun(?:a)?\s+concert(?:o|i)/i,
  /no\s+events?\s+scheduled/i,
  /no\s+concerts?\s+scheduled/i,
  /no\s+upcoming\s+events?/i,
  /non\s+sono\s+in\s+programma\s+eventi/i,
];

const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
  cdataPropName: "cdata",
});

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
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
  if (normalized.includes("lambrate")) return "Lambrate";
  if (normalized.includes("linate")) return "Linate";
  if (normalized.includes("malpensa")) return "Malpensa";
  if (normalized.includes("cadorna")) return "Cadorna";
  if (normalized.includes("porta garibaldi")) return "Porta Garibaldi";
  if (normalized.includes("forlanini")) return "Forlanini";
  if (normalized.includes("bicocca")) return "Bicocca";

  return fallback;
}

function inferKind(title: string, fallback: EventKind): EventKind {
  const normalized = title.toLowerCase();

  const hasAny = (patterns: RegExp[]): boolean =>
    patterns.some((pattern) => pattern.test(normalized));

  if (
    hasAny([
      /\bconcerto\b/i,
      /\blive\s+music\b/i,
      /\btour\b/i,
      /\bfestival\b/i,
      /\bgig\b/i,
      /\bshowcase\b/i,
    ])
  ) {
    return "concert";
  }

  if (
    hasAny([
      /\bpartita\b/i,
      /\bmatch\b/i,
      /\bvs\b/i,
      /\bstadio\b/i,
      /\bserie\s*a\b/i,
      /\bchampions\b/i,
      /\bcalcio\b/i,
      /\bderby\b/i,
      /\binter\b/i,
      /\bac\s*milan\b/i,
      /\bjuventus\b/i,
      /\bmonza\b/i,
      /\bnapoli\b/i,
      /\budinese\b/i,
      /\bvenezia\b/i,
    ])
  ) {
    return "sports";
  }

  if (
    hasAny([
      /\bfiera\b/i,
      /\bexpo\b/i,
      /\bsalone\b/i,
      /\bforum\b/i,
      /\bconference\b/i,
      /\bconvegno\b/i,
    ])
  ) {
    return "fair";
  }

  if (
    hasAny([
      /\bmetro\b/i,
      /\bsciopero\b/i,
      /\btren\w*/i,
      /\btraffico\b/i,
      /\bchiusura\b/i,
      /\bincidente\b/i,
      /\bdeviazion\w*/i,
      /\baeroporto\b/i,
      /\bstazione\b/i,
      /\bcantiere\b/i,
      /\bviabilit\w*/i,
    ])
  ) {
    return "transport-disruption";
  }

  if (
    hasAny([
      /\bnight\b/i,
      /\bclub\b/i,
      /\bdj\b/i,
      /\bparty\b/i,
      /\bdiscoteca\b/i,
      /\baperitivo\b/i,
    ])
  ) {
    return "nightlife";
  }

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

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function sanitizeText(
  value: string,
  maxLength = EVENTS_TEXT_MAX_LENGTH,
): string {
  const decoded = decodeHtml(value);
  const noHtml = stripHtml(decoded);
  const compacted = compactText(noHtml);
  return truncateText(compacted, maxLength);
}

function looksLikeNoEventMessage(...values: (string | undefined)[]): boolean {
  const normalized = values
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return NEGATIVE_EVENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLikelyGenericFeedTitle(title: string): boolean {
  const normalized = title.toLowerCase();

  if (normalized.length < 10) {
    return true;
  }

  return (
    normalized.includes("rss") ||
    normalized.includes("feed") ||
    normalized.includes("homepage") ||
    normalized.startsWith("tutte le notizie di oggi")
  );
}

function estimateAttendanceByKind(kind: EventKind): number {
  switch (kind) {
    case "concert":
      return 35000;
    case "sports":
      return 42000;
    case "fair":
      return 15000;
    case "transport-disruption":
      return 12000;
    case "nightlife":
      return 7000;
    default:
      return 5000;
  }
}

function addHoursToTime(time: string, addHours: number): string {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return time;
  }

  const totalMinutes = (hours * 60 + minutes + addHours * 60) % (24 * 60);
  const normalizedMinutes =
    totalMinutes < 0 ? totalMinutes + 24 * 60 : totalMinutes;
  const normalizedHours = Math.floor(normalizedMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutePart = (normalizedMinutes % 60).toString().padStart(2, "0");

  return `${normalizedHours}:${minutePart}`;
}

function parseDateCandidate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isWithinDateWindow(
  value: unknown,
  maxAgeHours: number,
  maxFutureHours: number,
  allowMissingDate: boolean,
): boolean {
  const parsedDate = parseDateCandidate(value);
  if (!parsedDate) {
    return allowMissingDate;
  }

  const diffHours = (parsedDate.getTime() - Date.now()) / (1000 * 60 * 60);
  return diffHours >= -maxAgeHours && diffHours <= maxFutureHours;
}

function extractVenue(location: unknown): string | undefined {
  if (!location || typeof location !== "object") {
    return undefined;
  }

  const loc = location as Record<string, unknown>;
  if (typeof loc.name === "string" && loc.name.trim().length > 0) {
    return compactText(loc.name);
  }

  return undefined;
}

function extractEventName(
  node: Record<string, unknown>,
  sourceName: string,
): string {
  if (typeof node.name === "string" && node.name.trim().length > 0) {
    return sanitizeText(node.name, 100);
  }

  if (
    typeof node.description === "string" &&
    node.description.trim().length > 0
  ) {
    return sanitizeText(node.description, 90);
  }

  return `Evento da ${sourceName}`;
}

function extractEventDetail(
  node: Record<string, unknown>,
  eventName: string,
): string | undefined {
  if (
    typeof node.description !== "string" ||
    node.description.trim().length === 0
  ) {
    return undefined;
  }

  const normalizedDescription = sanitizeText(node.description);
  const normalizedName = compactText(eventName);

  if (normalizedDescription.toLowerCase() === normalizedName.toLowerCase()) {
    return undefined;
  }

  return truncateText(normalizedDescription, 140);
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

function readXmlText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return sanitizeText(value);
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const merged = value
      .map((item) => readXmlText(item))
      .filter((item): item is string => Boolean(item))
      .join(" ");

    return merged.length > 0 ? compactText(merged) : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const asRecord = value as Record<string, unknown>;

  if (typeof asRecord["#text"] === "string") {
    return sanitizeText(asRecord["#text"]);
  }

  if (typeof asRecord.cdata === "string") {
    return sanitizeText(asRecord.cdata);
  }

  const merged = Object.entries(asRecord)
    .filter(([key]) => key !== "href")
    .map(([, nested]) => readXmlText(nested))
    .filter((item): item is string => Boolean(item))
    .join(" ");

  return merged.length > 0 ? compactText(merged) : undefined;
}

function extractRssLink(item: Record<string, unknown>): string | undefined {
  const linkNode = item.link;

  if (typeof linkNode === "string") {
    return linkNode.trim() || undefined;
  }

  if (Array.isArray(linkNode)) {
    for (const entry of linkNode) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        return entry.trim();
      }
      if (entry && typeof entry === "object") {
        const candidate = (entry as Record<string, unknown>).href;
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
    }
  }

  if (linkNode && typeof linkNode === "object") {
    const href = (linkNode as Record<string, unknown>).href;
    if (typeof href === "string" && href.trim().length > 0) {
      return href.trim();
    }
  }

  return undefined;
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
  const maxAgeHours = source.maxAgeHours ?? DEFAULT_HTML_MAX_AGE_HOURS;
  const maxFutureHours = source.maxFutureHours ?? DEFAULT_HTML_MAX_FUTURE_HOURS;

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
      if (
        !isWithinDateWindow(node.startDate, maxAgeHours, maxFutureHours, true)
      ) {
        continue;
      }

      const name = extractEventName(node, source.name);
      if (!name) {
        continue;
      }

      const startTimeLocal = normalizeTime(node.startDate, "19:00");
      const endTimeLocal = normalizeTime(node.endDate, "23:00");
      const locationText = locationToText(node.location);
      const venue = extractVenue(node.location);
      const detail = extractEventDetail(node, name);
      const eventUrl = typeof node.url === "string" ? node.url : undefined;

      if (looksLikeNoEventMessage(name, detail)) {
        continue;
      }

      const area = inferArea(
        locationText || name,
        source.defaultArea ?? "Milano Centro",
      );

      const inferredKind = inferKind(
        `${name} ${detail ?? ""}`,
        source.kind ?? "fair",
      );

      const manualEvent: Partial<ManualEvent> = {
        name,
        area,
        kind: inferredKind,
        startTimeLocal,
        endTimeLocal,
        expectedAttendance:
          source.defaultAttendance ?? estimateAttendanceByKind(inferredKind),
      };

      if (venue) {
        manualEvent.venue = venue;
      }
      manualEvent.source = source.name;
      if (detail) {
        manualEvent.detail = detail;
      }
      if (eventUrl) {
        manualEvent.url = eventUrl;
      }

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

function parseEventsFromRss(
  xml: string,
  source: EventSourceConfig,
): ManualEvent[] {
  const parsed = rssParser.parse(xml) as Record<string, unknown>;
  const rssNode =
    parsed.rss && typeof parsed.rss === "object"
      ? (parsed.rss as Record<string, unknown>)
      : undefined;
  const channelNode =
    rssNode?.channel && typeof rssNode.channel === "object"
      ? (rssNode.channel as Record<string, unknown>)
      : undefined;

  const atomNode =
    parsed.feed && typeof parsed.feed === "object"
      ? (parsed.feed as Record<string, unknown>)
      : undefined;

  const rawItems: unknown[] = [
    ...asArray(channelNode?.item),
    ...asArray(atomNode?.entry),
  ];

  const maxAgeHours = source.maxAgeHours ?? DEFAULT_RSS_MAX_AGE_HOURS;
  const maxFutureHours = source.maxFutureHours ?? DEFAULT_RSS_MAX_FUTURE_HOURS;
  const allEvents: ManualEvent[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const node = item as Record<string, unknown>;
    const title = readXmlText(node.title);
    if (!title || isLikelyGenericFeedTitle(title)) {
      continue;
    }

    const detail =
      readXmlText(node.description) ??
      readXmlText(node.summary) ??
      readXmlText(node.content);

    const category = readXmlText(node.category);
    const dateValue =
      node.pubDate ?? node.published ?? node.updated ?? node["dc:date"];

    if (!isWithinDateWindow(dateValue, maxAgeHours, maxFutureHours, false)) {
      continue;
    }

    if (looksLikeNoEventMessage(title, detail)) {
      continue;
    }

    const inferredKind = inferKind(
      `${title} ${category ?? ""} ${detail ?? ""}`,
      source.kind ?? "transport-disruption",
    );

    const startTimeLocal = normalizeTime(dateValue, "08:00");
    const endTimeLocal = addHoursToTime(
      startTimeLocal,
      DEFAULT_RSS_EVENT_DURATION_HOURS,
    );
    const area = inferArea(
      `${title} ${detail ?? ""}`,
      source.defaultArea ?? "Milano Centro",
    );

    const manualEvent: Partial<ManualEvent> = {
      name: title,
      area,
      kind: inferredKind,
      startTimeLocal,
      endTimeLocal,
      expectedAttendance:
        source.defaultAttendance ?? estimateAttendanceByKind(inferredKind),
      source: source.name,
    };

    if (detail) {
      manualEvent.detail = detail;
    }

    const rssUrl = extractRssLink(node);
    if (rssUrl) {
      manualEvent.url = rssUrl;
    }

    if (isValidEvent(manualEvent)) {
      allEvents.push(manualEvent);
    }
  }

  if (typeof source.maxEvents === "number" && source.maxEvents > 0) {
    return allEvents.slice(0, source.maxEvents);
  }

  return allEvents;
}

function dedupeEvents(events: ManualEvent[]): ManualEvent[] {
  const seen = new Set<string>();
  const seenByUrl = new Set<string>();
  const deduped: ManualEvent[] = [];

  for (const event of events) {
    const normalizedUrl = event.url?.trim().toLowerCase();
    if (normalizedUrl && seenByUrl.has(normalizedUrl)) {
      continue;
    }

    const key = `${event.name
      .toLowerCase()
      .replace(
        /[^a-z0-9\s]/g,
        "",
      )}|${event.area.toLowerCase()}|${event.startTimeLocal}|${event.kind}`;
    if (seen.has(key)) {
      continue;
    }

    if (normalizedUrl) {
      seenByUrl.add(normalizedUrl);
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

      const sourceType = source.sourceType ?? "jsonld-html";
      const parsed =
        sourceType === "rss"
          ? parseEventsFromRss(response.data, source)
          : parseEventsFromHtml(response.data, source);
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
