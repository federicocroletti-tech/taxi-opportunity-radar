import { RadarReport } from "./score";

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

export function buildTextReport(report: RadarReport): string {
  const rows: string[] = [];

  rows.push("==========================");
  rows.push("TAXI OPPORTUNITY RADAR");
  rows.push("==========================");
  rows.push(
    `Generato: ${new Date(report.generatedAtIso).toLocaleString("it-IT")}`,
  );
  rows.push(`City Score Milano: ${report.cityScore}/100`);
  rows.push("");
  rows.push("METEO");
  rows.push(...formatWeather(report));
  rows.push("");
  rows.push("TOP AREE");
  rows.push(...formatAreas(report));

  return rows.join("\n");
}

export function buildHtmlReport(report: RadarReport): string {
  const areaListHtml = report.topAreas
    .map(
      (area) =>
        `<li><strong>${area.area}</strong> - ${area.score}/100 (eventi: ${area.eventsCount})<br/><small>${area.reasons
          .slice(0, 4)
          .join("; ")}</small></li>`,
    )
    .join("");

  return `
  <h2>Taxi Opportunity Radar - Milano</h2>
  <p><strong>Data:</strong> ${new Date(report.generatedAtIso).toLocaleString("it-IT")}</p>
  <p><strong>City score:</strong> ${report.cityScore}/100</p>
  <h3>Meteo</h3>
  <ul>
    <li>Temperatura max: ${report.weather.maxTemperatureC.toFixed(1)}°C</li>
    <li>Pioggia prevista: ${report.weather.rainMm.toFixed(1)} mm</li>
    <li>Vento max: ${report.weather.maxWindKmh.toFixed(1)} km/h</li>
  </ul>
  <h3>Top aree</h3>
  <ol>${areaListHtml}</ol>
  `;
}
