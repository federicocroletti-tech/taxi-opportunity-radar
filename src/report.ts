import { RadarReport } from "./score";
import { EventKind } from "./events";

const MAX_EVENTS_DISPLAY = 10;

const EVENT_KIND_LABELS: Record<EventKind, string> = {
  concert: "Concerto",
  sports: "Sport",
  fair: "Fiera / Business",
  "transport-disruption": "Trasporti / Viabilita",
  nightlife: "Nightlife",
};

export interface ReportContext {
  sourceMode: "web" | "manual-fallback";
  failedSources: string[];
}

function formatWeather(report: RadarReport): string[] {
  return [
    `Temperatura max: ${report.weather.maxTemperatureC.toFixed(1)}°C`,
    `Pioggia prevista: ${report.weather.rainMm.toFixed(1)} mm`,
    `Vento max: ${report.weather.maxWindKmh.toFixed(1)} km/h`,
  ];
}

function formatKind(kind: EventKind): string {
  return EVENT_KIND_LABELS[kind] ?? kind;
}

function formatAreas(report: RadarReport): string[] {
  if (report.topAreas.length === 0) {
    return ["Nessuna area disponibile."];
  }

  return report.topAreas.map((area, idx) => {
    const reasonsPreview = area.reasons.slice(0, 3).join("; ");
    return `${idx + 1}. ${area.area} -> ${area.score}/100 (eventi: ${area.eventsCount}) | ${reasonsPreview}`;
  });
}

function formatEventsUsed(report: RadarReport): string[] {
  if (report.eventsUsed.length === 0) {
    return ["Nessun evento considerato."];
  }

  const rows = report.eventsUsed
    .slice(0, MAX_EVENTS_DISPLAY)
    .map((event, idx) => {
      const extra = [
        event.venue ? `Venue: ${event.venue}` : "",
        event.source ? `Fonte: ${event.source}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      const detail = event.detail ? ` | Dettaglio: ${event.detail}` : "";
      const link = event.url ? ` | Link: ${event.url}` : "";

      return `${idx + 1}. ${event.name} | Area: ${event.area} | Orario: ${event.startTimeLocal}-${event.endTimeLocal} | Tipo: ${formatKind(event.kind)} | Affluenza stimata: ${event.expectedAttendance}${extra ? ` | ${extra}` : ""}${detail}${link}`;
    });

  const hiddenEvents = report.eventsUsed.length - MAX_EVENTS_DISPLAY;
  if (hiddenEvents > 0) {
    rows.push(`... e altri ${hiddenEvents} eventi non mostrati.`);
  }

  return rows;
}

function formatKindDistribution(report: RadarReport): string[] {
  if (report.eventsUsed.length === 0) {
    return ["Nessun tipo disponibile."];
  }

  const counter = new Map<EventKind, number>();
  for (const event of report.eventsUsed) {
    counter.set(event.kind, (counter.get(event.kind) ?? 0) + 1);
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `- ${formatKind(kind)}: ${count}`);
}

function formatSourceDistribution(report: RadarReport): string[] {
  if (report.eventsUsed.length === 0) {
    return ["Nessuna sorgente disponibile."];
  }

  const counter = new Map<string, number>();
  for (const event of report.eventsUsed) {
    const source = event.source ?? "Sorgente non specificata";
    counter.set(source, (counter.get(source) ?? 0) + 1);
  }

  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `- ${source}: ${count}`);
}

export function buildTextReport(
  report: RadarReport,
  context?: ReportContext,
): string {
  const rows: string[] = [];

  rows.push("==========================");
  rows.push("TAXI OPPORTUNITY RADAR");
  rows.push("==========================");
  rows.push(
    `Generato: ${new Date(report.generatedAtIso).toLocaleString("it-IT")}`,
  );
  rows.push(`City Score Milano: ${report.cityScore}/100`);
  rows.push(`Eventi/notizie validati: ${report.eventsUsed.length}`);
  if (context) {
    rows.push(`Sorgente eventi: ${context.sourceMode}`);
    if (context.failedSources.length > 0) {
      rows.push(
        `Sorgenti web non raggiungibili: ${context.failedSources.join(", ")}`,
      );
    }
  }
  rows.push("");
  rows.push("METEO");
  rows.push(...formatWeather(report));
  rows.push("");
  rows.push("DISTRIBUZIONE TIPO NOTIZIA");
  rows.push(...formatKindDistribution(report));
  rows.push("");
  rows.push("SORGENTI UTILIZZATE");
  rows.push(...formatSourceDistribution(report));
  rows.push("");
  rows.push("TOP AREE");
  rows.push(...formatAreas(report));
  rows.push("");
  rows.push("EVENTI CONSIDERATI");
  rows.push(...formatEventsUsed(report));

  return rows.join("\n");
}

export function buildHtmlReport(
  report: RadarReport,
  context?: ReportContext,
): string {
  const kindDistributionHtml = formatKindDistribution(report)
    .map((row) => `<li>${row.replace("- ", "")}</li>`)
    .join("");

  const sourceDistributionHtml = formatSourceDistribution(report)
    .map((row) => `<li>${row.replace("- ", "")}</li>`)
    .join("");

  const areaListHtml = report.topAreas
    .map(
      (area) =>
        `<li><strong>${area.area}</strong> - ${area.score}/100 (eventi: ${area.eventsCount})<br/><small>${area.reasons
          .slice(0, 4)
          .join("; ")}</small></li>`,
    )
    .join("");

  const eventsListHtml =
    report.eventsUsed.length > 0
      ? report.eventsUsed
          .slice(0, MAX_EVENTS_DISPLAY)
          .map((event) => {
            const venue = event.venue ? ` | Venue: ${event.venue}` : "";
            const source = event.source ? ` | Fonte: ${event.source}` : "";
            const detail = event.detail
              ? `<br/><small>Dettaglio: ${event.detail}</small>`
              : "";
            const link = event.url
              ? `<br/><small><a href="${event.url}">Pagina evento</a></small>`
              : "";

            return `<li><strong>${event.name}</strong><br/><small>Area: ${event.area} | Orario: ${event.startTimeLocal}-${event.endTimeLocal} | Tipo: ${formatKind(event.kind)} | Affluenza stimata: ${event.expectedAttendance}${venue}${source}</small>${detail}${link}</li>`;
          })
          .join("") +
        (() => {
          const hiddenEvents = report.eventsUsed.length - MAX_EVENTS_DISPLAY;
          return hiddenEvents > 0
            ? `<li><small>... e altri ${hiddenEvents} eventi non mostrati.</small></li>`
            : "";
        })()
      : "<li>Nessun evento considerato.</li>";

  const sourceHtml = context
    ? `<p><strong>Sorgente eventi:</strong> ${context.sourceMode}</p>${
        context.failedSources.length > 0
          ? `<p><strong>Sorgenti web non raggiungibili:</strong> ${context.failedSources.join(", ")}</p>`
          : ""
      }`
    : "";

  return `
  <h2>Taxi Opportunity Radar - Milano</h2>
  <p><strong>Data:</strong> ${new Date(report.generatedAtIso).toLocaleString("it-IT")}</p>
  <p><strong>City score:</strong> ${report.cityScore}/100</p>
  <p><strong>Eventi/notizie validati:</strong> ${report.eventsUsed.length}</p>
  ${sourceHtml}
  <h3>Meteo</h3>
  <ul>
    <li>Temperatura max: ${report.weather.maxTemperatureC.toFixed(1)}°C</li>
    <li>Pioggia prevista: ${report.weather.rainMm.toFixed(1)} mm</li>
    <li>Vento max: ${report.weather.maxWindKmh.toFixed(1)} km/h</li>
  </ul>
  <h3>Distribuzione per tipo notizia</h3>
  <ul>${kindDistributionHtml}</ul>
  <h3>Distribuzione per sorgente</h3>
  <ul>${sourceDistributionHtml}</ul>
  <h3>Top aree</h3>
  <ol>${areaListHtml}</ol>
  <h3>Eventi considerati</h3>
  <ol>${eventsListHtml}</ol>
  `;
}
