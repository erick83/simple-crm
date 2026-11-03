import React from "react";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";
import {
  LOCKUP_ASPECT,
  LOCKUP_VIEW_BOX,
  MARK_ASPECT,
  MARK_VIEW_BOX,
  brandMark,
  brandWordmark,
} from "./brand-logo.paths";

export interface BrandLogoProps {
  /** `lockup` = isotipo + wordmark (barra de 240 px); `mark` = solo isotipo (riel de 88 px). */
  variant?: "lockup" | "mark";
  width: number;
}

/** Logo BISync dibujado como SVG: nítido en cualquier tamaño y con el wordmark del tema activo. */
export const BrandLogo: React.FC<BrandLogoProps> = ({ variant = "lockup", width }) => {
  const { colors } = useTheme();
  const isLockup = variant === "lockup";

  return (
    <Svg
      width={width}
      height={Math.round(width * (isLockup ? LOCKUP_ASPECT : MARK_ASPECT))}
      viewBox={isLockup ? LOCKUP_VIEW_BOX : MARK_VIEW_BOX}
      accessibilityRole="image"
      accessibilityLabel="BISync Solutions"
    >
      {brandMark.map((path) => (
        <Path key={path.d} d={path.d} fill={colors[path.fill]} />
      ))}
      {isLockup
        ? brandWordmark.map((d) => <Path key={d} d={d} fill={colors.brandInk} />)
        : null}
    </Svg>
  );
};
