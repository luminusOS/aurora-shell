declare module 'gi://GWeather' {
  namespace GWeather {
    enum TemperatureUnit {
      INVALID = 0,
      DEFAULT = 1,
      KELVIN = 2,
      CENTIGRADE = 3,
      FAHRENHEIT = 4,
    }

    enum Sky {
      INVALID = 0,
    }

    enum ConditionPhenomenon {
      INVALID = 0,
      NONE = 1,
    }
  }

  export default GWeather;
}
