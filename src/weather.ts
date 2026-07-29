import axios from "axios";
import { OpenMeteoDailyResponse } from "./types";

export interface WeatherData {
  maxTemperatureC: number;
  rainMm: number;
  maxWindKmh: number;
}

export async function getWeather(): Promise<WeatherData> {
  const response = await axios.get<OpenMeteoDailyResponse>(
    "https://api.open-meteo.com/v1/forecast",
    {
      params: {
        latitude: 45.4642,
        longitude: 9.19,
        daily: "precipitation_sum,temperature_2m_max,wind_speed_10m_max",
        forecast_days: 1,
        timezone: "Europe/Rome",
      },
      timeout: 10000,
    },
  );

  const daily = response.data.daily;
  const temperature = daily.temperature_2m_max?.[0] ?? 0;
  const rain = daily.precipitation_sum?.[0] ?? 0;
  const wind = daily.wind_speed_10m_max?.[0] ?? 0;

  return {
    maxTemperatureC: temperature,
    rainMm: rain,
    maxWindKmh: wind,
  };
}
