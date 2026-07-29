import { ManualEvent } from "./events";
import { WeatherData } from "./weather";

export interface AreaOpportunity {
  area: string;
  score: number;
  reasons: string[];
  eventsCount: number;
}

export interface RadarReport {
  generatedAtIso: string;
  weather: WeatherData;
  cityScore: number;
  topAreas: AreaOpportunity[];
  eventsUsed: ManualEvent[];
}

function sortEvents(events: ManualEvent[]): ManualEvent[] {
  return [...events].sort((a, b) => {
    const areaComparison = a.area.localeCompare(b.area, "it");
    if (areaComparison !== 0) {
      return areaComparison;
    }

    const startComparison = a.startTimeLocal.localeCompare(b.startTimeLocal);
    if (startComparison !== 0) {
      return startComparison;
    }

    return a.name.localeCompare(b.name, "it");
  });
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function weatherImpactScore(weather: WeatherData): {
  points: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let points = 0;

  if (weather.rainMm >= 0.5) {
    points += 15;
    reasons.push("Pioggia prevista: maggiore domanda per corse brevi");
  }

  if (weather.rainMm >= 8) {
    points += 10;
    reasons.push("Pioggia intensa: probabile picco domanda");
  }

  if (weather.maxTemperatureC >= 30 || weather.maxTemperatureC <= 4) {
    points += 8;
    reasons.push("Temperatura estrema: minore propensione a muoversi a piedi");
  }

  if (weather.maxWindKmh >= 25) {
    points += 6;
    reasons.push("Vento sostenuto: possibili spostamenti in taxi in aumento");
  }

  return { points, reasons };
}

function attendanceToScore(attendance: number): number {
  if (attendance >= 45000) {
    return 35;
  }
  if (attendance >= 20000) {
    return 25;
  }
  if (attendance >= 8000) {
    return 16;
  }
  if (attendance >= 2000) {
    return 10;
  }
  return 4;
}

function hourToScore(hour: number): number {
  if (hour >= 21 || hour <= 1) {
    return 10;
  }
  if (hour >= 17 && hour <= 20) {
    return 7;
  }
  if (hour >= 7 && hour <= 9) {
    return 5;
  }
  return 2;
}

function eventImpact(event: ManualEvent): { points: number; reason: string } {
  const attendanceScore = attendanceToScore(event.expectedAttendance);
  const endHour = Number(event.endTimeLocal.split(":")[0]);
  const timeScore = hourToScore(Number.isNaN(endHour) ? 18 : endHour);
  const eventTypeMultiplier = event.kind === "transport-disruption" ? 1.15 : 1;

  const points = Math.round(
    (attendanceScore + timeScore) * eventTypeMultiplier,
  );
  const reason = `${event.name} (${event.endTimeLocal}, ${event.expectedAttendance} persone stimate)`;

  return { points, reason };
}

export function buildRadarReport(
  weather: WeatherData,
  events: ManualEvent[],
): RadarReport {
  const weatherImpact = weatherImpactScore(weather);

  const areaMap = new Map<string, AreaOpportunity>();

  for (const event of events) {
    const impact = eventImpact(event);
    const current = areaMap.get(event.area) ?? {
      area: event.area,
      score: 35,
      reasons: [],
      eventsCount: 0,
    };

    current.score += impact.points;
    current.eventsCount += 1;
    current.reasons.push(impact.reason);

    areaMap.set(event.area, current);
  }

  const baseAreas =
    areaMap.size > 0
      ? Array.from(areaMap.values())
      : [
          {
            area: "Milano Centro",
            score: 40,
            reasons: [
              "Nessun evento manuale caricato: usata baseline cittadina",
            ],
            eventsCount: 0,
          },
        ];

  const scoredAreas = baseAreas
    .map((area) => {
      const score = clamp(area.score + weatherImpact.points);
      return {
        ...area,
        score,
        reasons: [...weatherImpact.reasons, ...area.reasons],
      };
    })
    .sort((a, b) => b.score - a.score);

  const cityScore = clamp(
    Math.round(
      scoredAreas.reduce((acc, item) => acc + item.score, 0) /
        scoredAreas.length,
    ),
  );

  return {
    generatedAtIso: new Date().toISOString(),
    weather,
    cityScore,
    topAreas: scoredAreas,
    eventsUsed: sortEvents(events),
  };
}
