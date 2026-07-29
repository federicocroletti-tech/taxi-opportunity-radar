import axios from "axios";

interface BrevoConfig {
  apiKey: string;
  fromEmail: string;
  toEmail: string;
  fromName: string;
}

function getBrevoConfigFromEnv(): BrevoConfig | null {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.EMAIL_FROM?.trim();
  const toEmail = process.env.EMAIL_TO?.trim();
  const fromName =
    process.env.EMAIL_FROM_NAME?.trim() || "Taxi Opportunity Radar";

  if (!apiKey || !fromEmail || !toEmail) {
    return null;
  }

  return { apiKey, fromEmail, toEmail, fromName };
}

export async function sendDailyEmail(
  subject: string,
  htmlContent: string,
): Promise<boolean> {
  const config = getBrevoConfigFromEnv();

  if (!config) {
    return false;
  }

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        email: config.fromEmail,
        name: config.fromName,
      },
      to: [
        {
          email: config.toEmail,
        },
      ],
      subject,
      htmlContent,
    },
    {
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
      },
      timeout: 10000,
    },
  );

  return true;
}
