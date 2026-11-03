import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export type NavIconName = "pos" | "inventory" | "shifts" | "balance" | "settings";

export interface NavIconProps {
  name: NavIconName;
  size?: number;
  /** Token de color ya resuelto; el icono se tiñe igual que su etiqueta. */
  color: string;
}

/**
 * Iconos de navegación dibujados a trazo (1.8 px, 24×24). Sustituyen a los emoji:
 * heredan el color del estado activo y se ven igual en Android, Web y escritorio.
 */
export const NavIcon: React.FC<NavIconProps> = ({ name, size = 22, color }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    accessibilityElementsHidden
    importantForAccessibility="no"
  >
    {name === "pos" ? (
      <>
        <Path d="M3 4.2h1.9l2.35 9.2a1.9 1.9 0 0 0 1.84 1.42h7.35a1.9 1.9 0 0 0 1.85-1.42L19.8 7.9H6.1" />
        <Circle cx={9.5} cy={19.2} r={1.35} />
        <Circle cx={17} cy={19.2} r={1.35} />
      </>
    ) : null}
    {name === "inventory" ? (
      <>
        <Path d="M12 3.2 20 7.4v9.2l-8 4.2-8-4.2V7.4l8-4.2Z" />
        <Path d="M4.3 7.6 12 11.8l7.7-4.2" />
        <Path d="M12 11.8V20.8" />
      </>
    ) : null}
    {name === "shifts" ? (
      <>
        <Circle cx={12} cy={12} r={8.4} />
        <Path d="M12 7.6V12l3.3 1.9" />
      </>
    ) : null}
    {name === "balance" ? (
      <>
        <Path d="M5 20v-6.4" />
        <Path d="M12 20V4.4" />
        <Path d="M19 20v-9.6" />
        <Path d="M2.8 20h18.4" />
      </>
    ) : null}
    {name === "settings" ? (
      <>
        <Path d="M3.5 8h8.2" />
        <Circle cx={14.6} cy={8} r={1.8} />
        <Path d="M17.8 8h2.7" />
        <Path d="M3.5 16h2.7" />
        <Circle cx={9.1} cy={16} r={1.8} />
        <Path d="M12.3 16h8.2" />
      </>
    ) : null}
  </Svg>
);
