import React, { useState, useEffect, useRef } from "react";
import {
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme, useThemedStyles } from "../theme/ThemeContext";
import type { Palette } from "../theme/tokens";
import { spacing } from "../theme/spacing";
import { typography } from "../theme/typography";
import { BrandLogo } from "../components/BrandLogo";
import { ThemeToggle } from "../components/ThemeToggle";
import type { SqlDriver } from "../database/connection";
import {
  LicenseValidatorService,
  LicenseRequestData,
} from "../services/license-validator.service";

export interface ActivationScreenProps {
  db: SqlDriver;
  terminalId?: string;
  tenantId?: string;
  currentHwid?: string;
  onActivated: () => void;
}

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  db,
  terminalId = "TERM-01",
  tenantId = "TENANT-001",
  currentHwid,
  onActivated,
}) => {
  const { colors: theme, mode } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const hwid = currentHwid ?? LicenseValidatorService.computeHwid({ fallbackSeed: terminalId });
  const [activeTab, setActiveTab] = useState<"trial" | "license">("trial");
  const [email, setEmail] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [generatedRequest, setGeneratedRequest] = useState<LicenseRequestData | null>(null);
  const [trialActivated, setTrialActivated] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState(false);
  const dropZoneRef = useRef<View>(null);

  useEffect(() => {
    const el = dropZoneRef.current as unknown as HTMLElement | null;
    if (el && typeof el.addEventListener === "function") {
      const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      };
      const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      };
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const text = ev.target?.result as string;
            if (text) {
              setTokenInput(text);
              setSelectedFileName(file.name);
              setErrorMessage(null);
            }
          };
          reader.readAsText(file);
        }
      };

      el.addEventListener("dragover", onDragOver);
      el.addEventListener("dragleave", onDragLeave);
      el.addEventListener("drop", onDrop);

      return () => {
        el.removeEventListener("dragover", onDragOver);
        el.removeEventListener("dragleave", onDragLeave);
        el.removeEventListener("drop", onDrop);
      };
    }
  }, [activeTab]);

  const handlePickFile = () => {
    if (typeof document !== "undefined") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = ev.target?.result as string;
          if (text) {
            setTokenInput(text);
            setSelectedFileName(file.name);
            setErrorMessage(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }
  };

  const handleActivateTrial = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const emailClean = email.trim();
    if (!LicenseValidatorService.isValidEmail(emailClean)) {
      setErrorMessage("Por favor ingrese un correo electrónico válido.");
      return;
    }

    const res = LicenseValidatorService.activateTrial(db, {
      email: emailClean,
      currentHwid: hwid,
      tenantId,
      terminalId,
    });

    if (!res.success) {
      setErrorMessage(res.message);
      return;
    }

    const req = LicenseValidatorService.createLicenseRequest({
      email: emailClean,
      currentHwid: hwid,
      tenantId,
      terminalId,
      deviceLabel: `Terminal ${terminalId}`,
    });
    setGeneratedRequest(req);
    setTrialActivated(true);

    // Descargar automáticamente el archivo .json para el usuario
    const fileName = `bisync-license-request-${terminalId}.json`;
    LicenseValidatorService.downloadJsonFile(fileName, JSON.stringify(req, null, 2));
  };

  const handleInstallLicense = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const raw = tokenInput.trim();
    if (!raw) {
      setErrorMessage("Ingrese el contenido del archivo token.json emitido por Bisync.");
      return;
    }

    const res = LicenseValidatorService.installLicense(db, raw, hwid);
    if (res.status === "ACTIVE" || res.status === "GRACE") {
      setSuccessMessage("¡Licencia comercial verificada y activada exitosamente!");
      setTimeout(() => {
        onActivated();
      }, 800);
    } else {
      setErrorMessage(res.message ?? "El certificado de licencia no es válido para este equipo.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.surfaceBase}
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topBar}>
          <BrandLogo variant="lockup" width={140} />
          <ThemeToggle />
        </View>

        <View style={styles.card}>
          {trialActivated && generatedRequest ? (
            <View style={styles.activatedCard}>
              <View style={styles.activatedBadge}>
                <Text style={styles.activatedBadgeText}>✓ PERIODO DE PRUEBA ACTIVADO</Text>
              </View>

              <Text style={styles.activatedTitle}>¡Terminal Lista para Operar!</Text>
              <Text style={styles.activatedSubtitle}>
                Se han habilitado 15 días completos de funcionamiento en este punto de venta.
              </Text>

              <View style={styles.downloadNoticeBox}>
                <Text style={styles.downloadNoticeIcon}>📥</Text>
                <View style={styles.downloadNoticeContent}>
                  <Text style={styles.downloadNoticeTitle}>Fichero de Solicitud Descargado</Text>
                  <Text style={[styles.downloadNoticeFilename, typography.tabularNumeric]}>
                    bisync-license-request-{terminalId}.json
                  </Text>
                  <Text style={styles.downloadNoticeDesc}>
                    El archivo se descargó automáticamente en tu carpeta de Descargas. Remítelo a{" "}
                    <Text style={{ color: theme.primaryGlow, fontWeight: "bold" }}>bisyncdev@gmail.com</Text> para
                    gestionar el pago y recibir tu licencia definitiva.
                  </Text>
                </View>
              </View>

              <View style={styles.actionsContainer}>
                <Text style={styles.actionsHeader}>Opciones para enviar o respaldar tu archivo:</Text>

                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  activeOpacity={0.85}
                  onPress={() => {
                    Linking.openURL(LicenseValidatorService.getGmailComposeUrl(generatedRequest)).catch(() => {});
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir Gmail en el navegador con la solicitud lista"
                >
                  <Text style={styles.actionButtonSecondaryText}>✉️ ABRIR GMAIL EN EL NAVEGADOR</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  activeOpacity={0.85}
                  onPress={async () => {
                    await LicenseValidatorService.copyToClipboard(JSON.stringify(generatedRequest, null, 2));
                    setCopyFeedback(true);
                    setTimeout(() => setCopyFeedback(false), 3000);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Copiar datos de configuración al portapapeles"
                >
                  <Text style={styles.actionButtonSecondaryText}>
                    {copyFeedback ? "✓ ¡COPIADO AL PORTAPAPELES!" : "📋 COPIAR DATOS AL PORTAPAPELES"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButtonSecondary}
                  activeOpacity={0.85}
                  onPress={() => {
                    LicenseValidatorService.downloadJsonFile(
                      `bisync-license-request-${terminalId}.json`,
                      JSON.stringify(generatedRequest, null, 2),
                    );
                    setDownloadFeedback(true);
                    setTimeout(() => setDownloadFeedback(false), 3000);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Volver a descargar archivo json"
                >
                  <Text style={styles.actionButtonSecondaryText}>
                    {downloadFeedback ? "✓ ¡ARCHIVO DESCARGADO NUEVAMENTE!" : "💾 VOLVER A DESCARGAR ARCHIVO (.JSON)"}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.continueButton}
                activeOpacity={0.85}
                onPress={onActivated}
                accessibilityRole="button"
                accessibilityLabel="Continuar al punto de venta"
              >
                <Text style={styles.continueButtonText}>CONTINUAR AL PUNTO DE VENTA ➔</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <View style={styles.pillBadge}>
                  <Text style={styles.pillBadgeText}>ACTIVACIÓN OBLIGATORIA</Text>
                </View>
                <Text style={styles.title}>Registro de Terminal</Text>
                <Text style={styles.subtitle}>
                  Para comenzar a operar este punto de venta, registre el correo electrónico del propietario.
                  Se habilitará un periodo de prueba de 15 días completo de forma inmediata.
                </Text>
              </View>

              {/* Selector de modo */}
              <View style={styles.tabsRow}>
                <TouchableOpacity
                  style={[styles.tabButton, activeTab === "trial" && styles.tabButtonActive]}
                  onPress={() => {
                    setActiveTab("trial");
                    setErrorMessage(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabButtonText, activeTab === "trial" && styles.tabButtonTextActive]}>
                    1. Activar Prueba de 15 Días
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabButton, activeTab === "license" && styles.tabButtonActive]}
                  onPress={() => {
                    setActiveTab("license");
                    setErrorMessage(null);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tabButtonText, activeTab === "license" && styles.tabButtonTextActive]}>
                    2. Ya tengo Licencia (token.json)
                  </Text>
                </TouchableOpacity>
              </View>

              {activeTab === "trial" ? (
                <View style={styles.formContainer}>
                  <Text style={styles.inputLabel}>Correo Electrónico del Propietario</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="ejemplo@comercio.com"
                    placeholderTextColor={theme.textMuted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Correo electrónico para activar la prueba"
                  />

                  <View style={styles.deviceInfoBox}>
                    <Text style={styles.deviceInfoLabel}>Identificador del Dispositivo (HWID):</Text>
                    <Text style={[styles.deviceInfoValue, typography.tabularNumeric]} numberOfLines={1}>
                      {hwid}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.primaryButton}
                    activeOpacity={0.85}
                    onPress={handleActivateTrial}
                    accessibilityRole="button"
                    accessibilityLabel="Activar periodo de prueba de 15 días"
                  >
                    <Text style={styles.primaryButtonText}>ACTIVAR PRUEBA DE 15 DÍAS Y COMENZAR</Text>
                  </TouchableOpacity>

                  <Text style={styles.helpFootnote}>
                    Al activar la prueba, se descargará el archivo de configuración que debe ser remitido a{" "}
                    <Text style={{ color: theme.primaryGlow, fontWeight: "bold" }}>bisyncdev@gmail.com</Text> para
                    gestionar el pago de la licencia comercial.
                  </Text>
                </View>
              ) : (
                <View style={styles.formContainer}>
                  <Text style={styles.inputLabel}>Cargar Archivo de Licencia (token.json)</Text>

                  {/* Zona Drag & Drop / Selector de Archivo */}
                  <View
                    ref={dropZoneRef}
                    style={[
                      styles.dropZone,
                      isDragging && styles.dropZoneDragging,
                      selectedFileName && styles.dropZoneLoaded,
                    ]}
                  >
                    <Text style={styles.dropZoneIcon}>
                      {selectedFileName ? "✓" : "📄"}
                    </Text>

                    {selectedFileName ? (
                      <View style={styles.fileSelectedContainer}>
                        <Text style={styles.fileSelectedText} numberOfLines={1}>
                          {selectedFileName}
                        </Text>
                        <TouchableOpacity
                          style={styles.removeFileBtn}
                          onPress={() => {
                            setSelectedFileName(null);
                            setTokenInput("");
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Quitar archivo seleccionado"
                        >
                          <Text style={styles.removeFileBtnText}>✕ Cambiar archivo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.dropZonePrompt}>
                        <Text style={styles.dropZoneText}>
                          Arrastra y suelta aquí tu archivo <Text style={{ fontWeight: "bold" }}>token.json</Text>
                        </Text>
                        <Text style={styles.dropZoneSubtext}>o selecciónalo desde tu computadora:</Text>
                        <TouchableOpacity
                          style={styles.browseButton}
                          activeOpacity={0.85}
                          onPress={handlePickFile}
                          accessibilityRole="button"
                          accessibilityLabel="Buscar archivo de licencia en el equipo"
                        >
                          <Text style={styles.browseButtonText}>BUSCAR ARCHIVO (.JSON)</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* Entrada manual / previsualización */}
                  <View style={styles.manualInputSection}>
                    <Text style={styles.inputSublabel}>
                      {selectedFileName ? "Contenido cargado del certificado:" : "O si lo prefieres, pega el contenido JSON:"}
                    </Text>
                    <TextInput
                      style={styles.multilineInput}
                      placeholder='Pegue aquí el texto JSON recibido ({"payload":{...},"signature":"..."})'
                      placeholderTextColor={theme.textMuted}
                      value={tokenInput}
                      onChangeText={(val) => {
                        setTokenInput(val);
                        if (!val.trim()) setSelectedFileName(null);
                      }}
                      multiline
                      numberOfLines={4}
                      accessibilityLabel="Texto del token de licencia firmado"
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.licenseButton, !tokenInput.trim() && styles.primaryButtonDisabled]}
                    activeOpacity={0.85}
                    onPress={handleInstallLicense}
                    disabled={!tokenInput.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Instalar licencia comercial definitiva"
                  >
                    <Text style={styles.licenseButtonText}>ACTIVAR LICENCIA DEFINITIVA</Text>
                  </TouchableOpacity>
                </View>
              )}

              {errorMessage ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⚠ {errorMessage}</Text>
                </View>
              ) : null}

              {successMessage ? (
                <View style={styles.successBox}>
                  <Text style={styles.successText}>✓ {successMessage}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: c.surfaceBase,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xl,
    },
    topBar: {
      width: "100%",
      maxWidth: 620,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 620,
      backgroundColor: c.surfaceContainerLow,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: spacing.radiusLg,
      padding: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      alignItems: "center",
      gap: spacing.xs,
      textAlign: "center",
    },
    pillBadge: {
      backgroundColor: c.warningSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: spacing.radiusSm,
      marginBottom: spacing.xs,
    },
    pillBadgeText: {
      fontSize: 11,
      fontWeight: typography.weights.bold,
      color: c.warningText,
      letterSpacing: 1,
    },
    title: {
      fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
      textAlign: "center",
    },
    subtitle: {
      fontSize: typography.sizes.subText,
      color: c.textSecondary,
      textAlign: "center",
      lineHeight: 20,
      maxWidth: 520,
    },
    tabsRow: {
      flexDirection: "row",
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      padding: 4,
      gap: 4,
    },
    tabButton: {
      flex: 1,
      paddingVertical: spacing.sm,
      alignItems: "center",
      borderRadius: spacing.radiusSm,
    },
    tabButtonActive: {
      backgroundColor: c.surfaceContainerHighest,
      borderWidth: 1,
      borderColor: c.borderSolid,
    },
    tabButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
      color: c.textSecondary,
    },
    tabButtonTextActive: {
      color: c.textPrimary,
      fontWeight: typography.weights.bold,
    },
    formContainer: {
      gap: spacing.md,
    },
    inputLabel: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    textInput: {
      height: spacing.touchTargetMin, // 48px
      backgroundColor: c.surfaceContainer,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      paddingHorizontal: spacing.md,
      fontSize: typography.sizes.body,
      color: c.textPrimary,
    },
    multilineInput: {
      minHeight: 110,
      backgroundColor: c.surfaceContainer,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      padding: spacing.md,
      fontSize: 12,
      color: c.textPrimary,
      textAlignVertical: "top",
    },
    deviceInfoBox: {
      backgroundColor: c.surfaceBase,
      padding: spacing.sm,
      borderRadius: spacing.radiusSm,
      borderWidth: 1,
      borderColor: c.border,
      gap: 2,
    },
    deviceInfoLabel: {
      fontSize: 11,
      color: c.textMuted,
    },
    deviceInfoValue: {
      fontSize: 11,
      color: c.textSecondary,
    },
    primaryButton: {
      height: 54,
      backgroundColor: c.primary,
      borderRadius: spacing.radiusMd,
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xs,
    },
    primaryButtonText: {
      color: c.onPrimary,
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      letterSpacing: 0.8,
    },
    licenseButton: {
      height: 54,
      backgroundColor: c.hero,
      borderRadius: spacing.radiusMd,
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xs,
    },
    licenseButtonText: {
      color: c.onHero,
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      letterSpacing: 0.8,
    },
    helpFootnote: {
      fontSize: typography.sizes.caption,
      color: c.textMuted,
      lineHeight: 18,
      textAlign: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    dropZone: {
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusLg,
      padding: spacing.lg,
      backgroundColor: c.surfaceContainer,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      minHeight: 140,
    },
    dropZoneDragging: {
      borderColor: c.primary,
      backgroundColor: c.primarySoft,
    },
    dropZoneLoaded: {
      borderColor: c.hero,
      borderStyle: "solid",
      backgroundColor: c.heroSoft,
    },
    dropZoneIcon: {
      fontSize: 32,
      color: c.heroText,
    },
    dropZonePrompt: {
      alignItems: "center",
      gap: 6,
    },
    dropZoneText: {
      fontSize: typography.sizes.body,
      color: c.textPrimary,
      textAlign: "center",
    },
    dropZoneSubtext: {
      fontSize: typography.sizes.caption,
      color: c.textMuted,
      marginBottom: spacing.xs,
    },
    browseButton: {
      minHeight: spacing.touchTargetMin,
      paddingHorizontal: spacing.lg,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.primary,
      justifyContent: "center",
      alignItems: "center",
    },
    browseButtonText: {
      color: c.onPrimary,
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      letterSpacing: 0.6,
    },
    fileSelectedContainer: {
      alignItems: "center",
      gap: 6,
    },
    fileSelectedText: {
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      color: c.heroText,
    },
    removeFileBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    removeFileBtnText: {
      fontSize: 12,
      color: c.textMuted,
    },
    manualInputSection: {
      gap: 6,
    },
    inputSublabel: {
      fontSize: typography.sizes.caption,
      color: c.textSecondary,
    },
    errorBox: {
      backgroundColor: c.errorSoft,
      padding: spacing.md,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.error,
    },
    errorText: {
      color: c.errorText,
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
    },
    successBox: {
      backgroundColor: c.heroSoft,
      padding: spacing.md,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.hero,
    },
    successText: {
      color: c.heroText,
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
    },
    activatedCard: {
      gap: spacing.lg,
      alignItems: "center",
      width: "100%",
    },
    activatedBadge: {
      backgroundColor: c.heroSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: spacing.radiusSm,
    },
    activatedBadgeText: {
      fontSize: 11,
      fontWeight: typography.weights.bold,
      color: c.heroText,
      letterSpacing: 1,
    },
    activatedTitle: {
      fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
      textAlign: "center",
    },
    activatedSubtitle: {
      fontSize: typography.sizes.subText,
      color: c.textSecondary,
      textAlign: "center",
      lineHeight: 20,
      maxWidth: 520,
    },
    downloadNoticeBox: {
      width: "100%",
      flexDirection: "row",
      backgroundColor: c.surfaceContainer,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusLg,
      padding: spacing.md,
      gap: spacing.md,
      alignItems: "center",
    },
    downloadNoticeIcon: {
      fontSize: 28,
    },
    downloadNoticeContent: {
      flex: 1,
      gap: 4,
    },
    downloadNoticeTitle: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    downloadNoticeFilename: {
      fontSize: typography.sizes.caption,
      color: c.primaryGlow,
      fontWeight: typography.weights.bold,
    },
    downloadNoticeDesc: {
      fontSize: 12,
      color: c.textSecondary,
      lineHeight: 18,
    },
    actionsContainer: {
      width: "100%",
      gap: spacing.sm,
    },
    actionsHeader: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textMuted,
      marginBottom: 2,
    },
    actionButtonSecondary: {
      minHeight: spacing.touchTargetMin,
      backgroundColor: c.surfaceContainerHigh,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.md,
    },
    actionButtonSecondaryText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
      letterSpacing: 0.5,
    },
    continueButton: {
      width: "100%",
      height: 60,
      backgroundColor: c.hero,
      borderRadius: spacing.radiusMd,
      justifyContent: "center",
      alignItems: "center",
      marginTop: spacing.xs,
    },
    continueButtonText: {
      color: c.onHero,
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      letterSpacing: 1,
    },
  });
