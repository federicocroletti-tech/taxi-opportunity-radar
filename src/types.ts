export interface OpenMeteoDailyResponse {
  daily: {
    precipitation_sum: number[];
    temperature_2m_max: number[];
    wind_speed_10m_max: number[];
  };
}
