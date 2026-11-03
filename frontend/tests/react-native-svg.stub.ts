/**
 * Sustituto de `react-native-svg` para Vitest: sus módulos nativos no cargan en Node.
 * Los tests solo montan elementos con `React.createElement`, nunca renderizan SVG.
 */
export const Svg = () => null;
export const Path = () => null;
export const Circle = () => null;
export const G = () => null;
export default Svg;
