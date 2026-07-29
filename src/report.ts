import { RadarReport } from "./score";

const MAX_EVENTS_DISPLAY = 10;

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
    .map(
      (event, idx) =>
        `${idx + 1}. ${event.name} | Area: ${event.area} | Orario: ${event.startTimeLocal}-${event.endTimeLocal} | Tipo: ${event.kind} | Affluenza stimata: ${event.expectedAttendance}`,
    );

  const hiddenEvents = report.eventsUsed.length - MAX_EVENTS_DISPLAY;
  if (hiddenEvents > 0) {
    rows.push(`... e altri ${hiddenEvents} eventi non mostrati.`);
  }

  return rows;
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
          .map(
            (event) =>
              `<li><strong>${event.name}</strong><br/><small>Area: ${event.area} | Orario: ${event.startTimeLocal}-${event.endTimeLocal} | Tipo: ${event.kind} | Affluenza stimata: ${event.expectedAttendance}</small></li>`,
          )
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
  ${sourceHtml}
  <h3>Meteo</h3>
  <ul>
    <li>Temperatura max: ${report.weather.maxTemperatureC.toFixed(1)}°C</li>
    <li>Pioggia prevista: ${report.weather.rainMm.toFixed(1)} mm</li>
    <li>Vento max: ${report.weather.maxWindKmh.toFixed(1)} km/h</li>
  </ul>
  <h3>Top aree</h3>
  <ol>${areaListHtml}</ol>
  <h3>Eventi considerati</h3>
  <ol>${eventsListHtml}</ol>
  `;
}
