import dotenv from "dotenv";
import { loadRadarEvents } from "./events";
import { buildTextReport, buildHtmlReport } from "./report";
import { buildRadarReport } from "./score";
import { getWeather } from "./weather";
import { sendDailyEmail } from "./email";

dotenv.config();

async function main() {
  try {
    const weather = await getWeather();
    const eventLoad = await loadRadarEvents();
    const report = buildRadarReport(weather, eventLoad.events);

    const textReport = buildTextReport(report);
    console.log(textReport);
    console.log(
      `\nSorgente eventi: ${eventLoad.sourceMode} | Eventi caricati: ${eventLoad.events.length}`,
    );
    if (eventLoad.failedSources.length > 0) {
      console.log(
        `Sorgenti web non raggiungibili: ${eventLoad.failedSources.join(", ")}`,
      );
    }

    const mailSubject = `Taxi Opportunity Radar Milano - ${new Date(report.generatedAtIso).toLocaleDateString("it-IT")}`;
    const mailHtml = buildHtmlReport(report);
    const emailSent = await sendDailyEmail(mailSubject, mailHtml);

    if (emailSent) {
      console.log("\nEmail inviata correttamente via Brevo.");
    } else {
      console.log(
        "\nEmail non inviata: variabili BREVO_API_KEY / EMAIL_FROM / EMAIL_TO non configurate.",
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    console.error(`Errore esecuzione radar: ${message}`);
    process.exitCode = 1;
  }
}

main();
