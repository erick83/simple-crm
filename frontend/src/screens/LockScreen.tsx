import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import { Numpad } from "../components/Numpad";
import type { SqlDriver } from "../database/connection";
import {
  verifyOperatorPin,
  logOperatorAction,
  hashOperatorPin,
} from "../database/repositories/operator.repository";
import type { OperatorEntity } from "../database/repositories/operator.repository";

export interface LockScreenProps {
  db?: SqlDriver;
  terminalId?: string;
  tenantId?: string;
  onUnlock: (operator: OperatorEntity) => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({
  db,
  terminalId = "TERM-01",
  onUnlock,
}) => {
  const { colors: theme, mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [pin, setPin] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const isSubmittingRef = useRef(false);

  const submitPin = useCallback(
    (pinToValidate: string) => {
      if (isSubmittingRef.current || isSuccess) return;
      isSubmittingRef.current = true;

      if (!db) {
        // Modo simulado / preview sin DB conectada: aceptar 1234 o 0000
        if (pinToValidate === "1234") {
          setIsSuccess(true);
          setTimeout(() => {
            onUnlock({
              id: "sim-admin",
              name: "Administrador Simulado",
              role: "ADMIN",
              pinHash: "",
              isActive: true,
              createdAt: Date.now(),
            });
          }, 300);
          return;
        } else if (pinToValidate === "0000") {
          setIsSuccess(true);
          setTimeout(() => {
            onUnlock({
              id: "sim-cashier",
              name: "Cajero Simulado",
              role: "CASHIER",
              pinHash: "",
              isActive: true,
              createdAt: Date.now(),
            });
          }, 300);
          return;
        }

        setErrorMessage("PIN incorrecto (Prueba: 1234 o 0000)");
        setPin("");
        isSubmittingRef.current = false;
        return;
      }

      try {
        const operator = verifyOperatorPin(db, pinToValidate);
        if (operator) {
          setIsSuccess(true);
          setErrorMessage(null);

          // Registrar evento de auditoría de inicio de sesión
          try {
            logOperatorAction(db, {
              operatorId: operator.id,
              operatorName: operator.name,
              action: "LOGIN",
              entityType: "AUTH",
              details: { terminalId },
            });
          } catch {
            // No bloquear el inicio de sesión si la bitácora falla
          }

          setTimeout(() => {
            onUnlock(operator);
          }, 250);
        } else {
          // Verificar si el PIN pertenece a un operador inactivo/bloqueado
          const hash = hashOperatorPin(pinToValidate);
          const inactive = db.all<{ name: string }>(
            "SELECT name FROM operators WHERE pin_hash = ? AND is_active = 0 LIMIT 1",
            [hash],
          );

          if (inactive.length > 0) {
            setErrorMessage(`Operador "${inactive[0]!.name}" bloqueado. Contacte a un administrador.`);
          } else {
            setErrorMessage("PIN incorrecto. Reintente.");
          }

          setPin("");
          isSubmittingRef.current = false;
        }
      } catch (err) {
        setErrorMessage((err as Error).message);
        setPin("");
        isSubmittingRef.current = false;
      }
    },
    [db, isSuccess, onUnlock, terminalId],
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (isSubmittingRef.current || isSuccess) return;
      setErrorMessage(null);
      setPin((prev) => {
        if (prev.length >= 4) return prev;
        const next = prev + digit;
        if (next.length === 4) {
          // Despacho síncrono para respuesta táctil instantánea
          setTimeout(() => submitPin(next), 50);
        }
        return next;
      });
    },
    [isSuccess, submitPin],
  );

  const handleBackspace = useCallback(() => {
    if (isSubmittingRef.current || isSuccess) return;
    setErrorMessage(null);
    setPin((prev) => (prev.length > 0 ? prev.slice(0, -1) : ""));
  }, [isSuccess]);

  const handleClear = useCallback(() => {
    if (isSubmittingRef.current || isSuccess) return;
    setErrorMessage(null);
    setPin("");
  }, [isSuccess]);

  // Soporte para entrada física por teclado en Web y Escritorio
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Escape" || e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleClear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleDigit, handleBackspace, handleClear]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.surfaceBase}
      />

      <View style={styles.topHeader}>
        <View style={styles.brandBox}>
          <BrandLogo variant="lockup" width={130} />
        </View>
        <ThemeToggle compact />
      </View>

      <View style={styles.mainContainer}>
        <View style={styles.card} testID="lock-screen-card">
          <View style={styles.headerInfo}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={styles.title}>Terminal Protegido</Text>
            <Text style={styles.subtitle}>
              Caja {terminalId} • Ingrese su PIN de 4 dígitos
            </Text>
          </View>

          {/* Indicadores visuales de 4 dígitos */}
          <View
            style={styles.dotsRow}
            accessibilityRole="text"
            accessibilityLabel={`${pin.length} de 4 dígitos ingresados`}
            testID="pin-dots-container"
          >
            {[0, 1, 2, 3].map((index) => {
              const filled = pin.length > index;
              return (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    filled && styles.dotFilled,
                    isSuccess && styles.dotSuccess,
                  ]}
                  testID={`pin-dot-${index}-${filled ? "filled" : "empty"}`}
                />
              );
            })}
          </View>

          {/* Mensaje de retroalimentación / error */}
          <View style={styles.feedbackContainer}>
            {errorMessage ? (
              <Text style={styles.errorText} testID="lock-screen-error">
                {errorMessage}
              </Text>
            ) : isSuccess ? (
              <Text style={styles.successText} testID="lock-screen-success">
                ✓ Desbloqueando sesión...
              </Text>
            ) : (
              <Text style={styles.hintText}>
                Use el teclado táctil o físico para desbloquear
              </Text>
            )}
          </View>

          {/* Teclado numérico táctil de 64 px */}
          <View style={styles.numpadWrapper}>
            <Numpad
              onDigit={handleDigit}
              onClear={handleClear}
              onBackspace={handleBackspace}
              showDecimal={false}
            />
          </View>

          {/* Recordatorio de credenciales predeterminadas para onboarding */}
          <View style={styles.footerHelp}>
            <Text style={styles.footerHelpText}>
              PIN Iniciales — Administrador: 1234 • Cajero: 0000
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: c.surfaceBase,
    },
    topHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      height: 60,
    },
    brandBox: {
      flexDirection: "row",
      alignItems: "center",
    },
    mainContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.md,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: c.surfaceContainerLow,
      borderRadius: spacing.radiusXl,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
      alignItems: "center",
    },
    headerInfo: {
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    lockIcon: {
      fontSize: 32,
      marginBottom: spacing.xs,
    },
    title: {
      fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: typography.sizes.caption,
      color: c.textMuted,
      fontWeight: typography.weights.medium,
    },
    dotsRow: {
      flexDirection: "row",
      gap: spacing.md,
      marginBottom: spacing.md,
      justifyContent: "center",
      alignItems: "center",
      height: 32,
    },
    dot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: c.borderSolid,
      backgroundColor: "transparent",
    },
    dotFilled: {
      backgroundColor: c.primary,
      borderColor: c.primaryGlow,
    },
    dotSuccess: {
      backgroundColor: c.hero,
      borderColor: c.heroLight,
    },
    feedbackContainer: {
      minHeight: 28,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    errorText: {
      fontSize: typography.sizes.subText,
      color: c.errorText,
      fontWeight: typography.weights.semibold,
      textAlign: "center",
    },
    successText: {
      fontSize: typography.sizes.subText,
      color: c.heroText,
      fontWeight: typography.weights.bold,
      textAlign: "center",
    },
    hintText: {
      fontSize: typography.sizes.caption,
      color: c.textMuted,
      textAlign: "center",
    },
    numpadWrapper: {
      width: "100%",
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    footerHelp: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: spacing.md,
      width: "100%",
      alignItems: "center",
    },
    footerHelpText: {
      fontSize: 11,
      color: c.textMuted,
      letterSpacing: 0.2,
      textAlign: "center",
    },
  });
