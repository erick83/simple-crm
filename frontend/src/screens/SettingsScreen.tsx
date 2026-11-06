import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Linking,
  ScrollView,
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
import { getOrCreateDefaultSqlDriver } from "../database/connection";
import type { SqlDriver } from "../database/connection";
import {
  getDefaultTaxRate,
  setDefaultTaxRate,
  taxRateToPercent,
} from "../database/repositories/settings.repository";
import {
  listOperators,
  createOperator,
  toggleOperatorActive,
  canDeleteOperator,
  deleteOperator,
  updateOperatorPin,
  logOperatorAction,
} from "../database/repositories/operator.repository";
import type {
  OperatorEntity,
  OperatorRole,
} from "../database/repositories/operator.repository";
import {
  LicenseValidatorService,
  LicenseCheckResult,
  LicenseRequestData,
} from "../services/license-validator.service";

export interface SettingsScreenProps {
  db?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  currentOperator?: OperatorEntity | null;
  currentHwid?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  db: propDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  currentOperator,
  currentHwid,
}) => {
  const { colors: theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const db = propDb ?? getOrCreateDefaultSqlDriver({ tenantId, terminalId });

  const [taxPercent, setTaxPercent] = useState(() => taxRateToPercent(getDefaultTaxRate(db)));
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // Gestión de operadores y cajeros
  const [operators, setOperators] = useState<OperatorEntity[]>(() =>
    db ? listOperators(db) : [],
  );
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<OperatorRole>("CASHIER");
  const [newPin, setNewPin] = useState("");
  const [opError, setOpError] = useState<string | null>(null);
  const [opSuccess, setOpSuccess] = useState<string | null>(null);
  const [editingPinOperatorId, setEditingPinOperatorId] = useState<string | null>(null);
  const [pinEditValue, setPinEditValue] = useState("");
  const [pinConfirmValue, setPinConfirmValue] = useState("");

  // Gestión de Licenciamiento, Registro de Email y Periodo de Prueba
  const hwid = currentHwid ?? LicenseValidatorService.computeHwid({ fallbackSeed: terminalId });
  const [licenseInfo, setLicenseInfo] = useState<LicenseCheckResult>(() =>
    db ? LicenseValidatorService.evaluateLicense(db, hwid) : { status: "UNLICENSED", canCheckout: false },
  );
  const [emailInput, setEmailInput] = useState(() => licenseInfo.registeredEmail ?? "");
  const [licenseTokenInput, setLicenseTokenInput] = useState("");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [licMessage, setLicMessage] = useState<string | null>(null);
  const [licError, setLicError] = useState(false);
  const [generatedRequest, setGeneratedRequest] = useState<LicenseRequestData | null>(null);
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
              setLicenseTokenInput(text);
              setSelectedFileName(file.name);
              setLicMessage(null);
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
  }, []);

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
            setLicenseTokenInput(text);
            setSelectedFileName(file.name);
            setLicMessage(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }
  };

  const refreshLicense = useCallback(() => {
    if (!db) return;
    try {
      const info = LicenseValidatorService.evaluateLicense(db, hwid);
      setLicenseInfo(info);
      if (info.registeredEmail && !emailInput) {
        setEmailInput(info.registeredEmail);
      }
    } catch {
      // ignore
    }
  }, [db, hwid, emailInput]);

  const handleActivateTrial = () => {
    setLicMessage(null);
    setLicError(false);
    if (!db) {
      setLicError(true);
      setLicMessage("Sin base de datos local disponible.");
      return;
    }
    const res = LicenseValidatorService.activateTrial(db, {
      email: emailInput,
      currentHwid: hwid,
      tenantId,
      terminalId,
    });
    if (!res.success) {
      setLicError(true);
      setLicMessage(res.message);
      return;
    }
    const req = LicenseValidatorService.createLicenseRequest({
      email: emailInput,
      currentHwid: hwid,
      tenantId,
      terminalId,
      deviceLabel: `Terminal ${terminalId}`,
    });
    setGeneratedRequest(req);
    const filename = `bisync-license-request-${terminalId}.json`;
    LicenseValidatorService.downloadJsonFile(filename, JSON.stringify(req, null, 2));
    setLicError(false);
    setLicMessage(
      `¡Periodo de prueba de 15 días activado! Se descargó automáticamente el archivo ${filename}.`,
    );
    refreshLicense();
  };

  const getOrBuildRequest = () => {
    return (
      generatedRequest ??
      LicenseValidatorService.createLicenseRequest({
        email: emailInput || (licenseInfo.registeredEmail ?? "comercio@ejemplo.com"),
        currentHwid: hwid,
        tenantId,
        terminalId,
        deviceLabel: `Terminal ${terminalId}`,
      })
    );
  };

  const handleOpenGmail = () => {
    const req = getOrBuildRequest();
    const url = LicenseValidatorService.getGmailComposeUrl(req);
    Linking.openURL(url).catch(() => {
      setLicError(true);
      setLicMessage("No se pudo abrir el navegador. Puede descargar el archivo o copiar los datos.");
    });
  };

  const handleDownloadRequest = () => {
    const req = getOrBuildRequest();
    const filename = `bisync-license-request-${terminalId}.json`;
    LicenseValidatorService.downloadJsonFile(filename, JSON.stringify(req, null, 2));
    setLicError(false);
    setLicMessage(`✓ Archivo ${filename} descargado en la carpeta de Descargas.`);
  };

  const handleCopyRequest = async () => {
    const req = getOrBuildRequest();
    await LicenseValidatorService.copyToClipboard(JSON.stringify(req, null, 2));
    setLicError(false);
    setLicMessage("✓ Datos de la solicitud copiados al portapapeles.");
  };

  const handleInstallLicense = () => {
    setLicMessage(null);
    setLicError(false);
    if (!db) return;
    if (!licenseTokenInput.trim()) {
      setLicError(true);
      setLicMessage("Ingrese el contenido del archivo de licencia token.json.");
      return;
    }
    const res = LicenseValidatorService.installLicense(db, licenseTokenInput, hwid);
    if (res.status === "ACTIVE" || res.status === "GRACE") {
      setLicError(false);
      setLicMessage("¡Licencia comercial activada exitosamente!");
      setLicenseTokenInput("");
      refreshLicense();
    } else {
      setLicError(true);
      setLicMessage(res.message ?? "La licencia ingresada no es válida para este equipo.");
    }
  };

  const refreshOperators = useCallback(() => {
    if (!db) return;
    try {
      setOperators(listOperators(db));
    } catch {
      // ignore
    }
  }, [db]);

  const handleSavePin = (operatorId: string, operatorName: string) => {
    if (!db) return;
    setOpError(null);
    setOpSuccess(null);

    const cleanPin = pinEditValue.replace(/[^0-9]/g, "");
    const cleanConfirm = pinConfirmValue.replace(/[^0-9]/g, "");

    if (cleanPin.length !== 4) {
      setOpError("El nuevo PIN debe contener exactamente 4 dígitos numéricos.");
      return;
    }

    if (cleanPin !== cleanConfirm) {
      setOpError("Los PINs no coinciden. Por favor confirme el mismo número de 4 dígitos.");
      return;
    }

    try {
      updateOperatorPin(db, operatorId, cleanPin);

      try {
        logOperatorAction(db, {
          operatorId: currentOperator?.id ?? "op-admin",
          operatorName: currentOperator?.name ?? "Admin",
          action: "OPERATOR_UPDATE",
          entityType: "OPERATOR",
          entityId: operatorId,
          details: { field: "pin", targetName: operatorName },
        });
      } catch {
        // ignore
      }

      setOpSuccess(`PIN de "${operatorName}" actualizado con éxito.`);
      setEditingPinOperatorId(null);
      setPinEditValue("");
      setPinConfirmValue("");
      refreshOperators();
    } catch (err) {
      setOpError((err as Error).message);
    }
  };

  const handleSaveTax = () => {
    setMessage(null);
    if (!db) {
      setIsError(true);
      setMessage("Sin base de datos local, no se puede guardar la configuración");
      return;
    }
    try {
      const rate = setDefaultTaxRate(db, taxPercent);
      setTaxPercent(taxRateToPercent(rate));
      setIsError(false);
      setMessage(`IVA sugerido guardado: ${taxRateToPercent(rate)}% se aplicará a los productos nuevos`);
    } catch (err) {
      setIsError(true);
      setMessage((err as Error).message);
    }
  };

  const handleCreateOperator = () => {
    setOpError(null);
    setOpSuccess(null);
    if (!db) return;

    const cleanPin = newPin.replace(/[^0-9]/g, "");
    if (cleanPin.length !== 4) {
      setOpError("El PIN del operador debe contener exactamente 4 dígitos numéricos.");
      return;
    }

    try {
      const op = createOperator(db, {
        name: newName,
        role: newRole,
        pin: cleanPin,
      });

      try {
        logOperatorAction(db, {
          operatorId: currentOperator?.id ?? op.id,
          operatorName: currentOperator?.name ?? op.name,
          action: "OPERATOR_CREATE",
          entityType: "OPERATOR",
          entityId: op.id,
          details: { name: op.name, role: op.role },
        });
      } catch {
        // ignore
      }

      setNewName("");
      setNewPin("");
      setOpSuccess(`Operador "${op.name}" creado con éxito.`);
      refreshOperators();
    } catch (err) {
      setOpError((err as Error).message);
    }
  };

  const handleToggleActive = (operatorId: string, currentActive: boolean) => {
    setOpError(null);
    setOpSuccess(null);
    if (!db) return;
    try {
      toggleOperatorActive(db, operatorId, !currentActive);
      try {
        logOperatorAction(db, {
          operatorId: currentOperator?.id ?? "system",
          operatorName: currentOperator?.name ?? "Admin",
          action: "OPERATOR_UPDATE",
          entityType: "OPERATOR",
          entityId: operatorId,
          details: { isActive: !currentActive },
        });
      } catch {
        // ignore
      }
      refreshOperators();
    } catch (err) {
      setOpError((err as Error).message);
    }
  };

  const handleDeleteOperator = (operatorId: string) => {
    setOpError(null);
    setOpSuccess(null);
    if (!db) return;
    try {
      deleteOperator(db, operatorId);
      try {
        logOperatorAction(db, {
          operatorId: currentOperator?.id ?? "system",
          operatorName: currentOperator?.name ?? "Admin",
          action: "OPERATOR_DELETE",
          entityType: "OPERATOR",
          entityId: operatorId,
        });
      } catch {
        // ignore
      }
      setOpSuccess("Operador eliminado correctamente.");
      refreshOperators();
    } catch (err) {
      setOpError((err as Error).message);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Configuración</Text>

      {/* Card 1: Impuestos */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Impuestos</Text>
        <Text style={styles.sectionHelp}>
          IVA general sugerido (%) que se aplica automáticamente al crear productos. No modifica
          productos existentes ni facturas emitidas.
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, typography.tabularNumeric]}
            placeholder="16"
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textMuted}
            value={taxPercent}
            onChangeText={setTaxPercent}
            accessibilityLabel="IVA general sugerido en porcentaje"
          />
          <TouchableOpacity
            style={[styles.saveButton, !db && styles.saveButtonDisabled]}
            activeOpacity={0.85}
            onPress={handleSaveTax}
            disabled={!db}
            accessibilityRole="button"
            accessibilityLabel="Guardar IVA sugerido"
          >
            <Text style={styles.saveButtonText}>GUARDAR</Text>
          </TouchableOpacity>
        </View>

        {message ? (
          <Text style={[styles.message, isError ? styles.messageError : styles.messageOk]}>
            {isError ? "⚠" : "✓"} {message}
          </Text>
        ) : null}
      </View>

      {/* Card 2: Licencia del Dispositivo & Periodo de Prueba */}
      <View style={styles.card}>
        <View style={styles.licenseHeader}>
          <Text style={styles.sectionTitle}>Licencia del Dispositivo</Text>
          <View
            style={[
              styles.licenseBadge,
              licenseInfo.status === "ACTIVE" && !licenseInfo.isTrial && styles.licenseBadgeActive,
              licenseInfo.status === "ACTIVE" && licenseInfo.isTrial && styles.licenseBadgeTrial,
              licenseInfo.status === "GRACE" && styles.licenseBadgeTrial,
              licenseInfo.status === "EXPIRED" && styles.licenseBadgeExpired,
              licenseInfo.status === "TAMPERED" && styles.licenseBadgeExpired,
              licenseInfo.status === "UNLICENSED" && styles.licenseBadgeUnlicensed,
            ]}
          >
            <Text
              style={[
                styles.licenseBadgeText,
                licenseInfo.status === "ACTIVE" && !licenseInfo.isTrial && styles.licenseBadgeTextActive,
                licenseInfo.status === "ACTIVE" && licenseInfo.isTrial && styles.licenseBadgeTextTrial,
                licenseInfo.status === "GRACE" && styles.licenseBadgeTextTrial,
                (licenseInfo.status === "EXPIRED" || licenseInfo.status === "TAMPERED") && styles.licenseBadgeTextExpired,
              ]}
            >
              {licenseInfo.status === "ACTIVE" && !licenseInfo.isTrial && "LICENCIA COMERCIAL ACTIVA"}
              {licenseInfo.status === "ACTIVE" && licenseInfo.isTrial && `PRUEBA: ${licenseInfo.daysRemaining ?? 15} DÍAS RESTANTES`}
              {licenseInfo.status === "GRACE" && "EN PERÍODO DE GRACIA"}
              {licenseInfo.status === "EXPIRED" && (licenseInfo.isTrial ? "PRUEBA EXPIRADA" : "LICENCIA EXPIRADA")}
              {licenseInfo.status === "TAMPERED" && "CERTIFICADO ADULTERADO"}
              {licenseInfo.status === "UNLICENSED" && "EQUIPO NO REGISTRADO"}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionHelp}>
          Hardware ID inmutable (HWID):{" "}
          <Text style={[typography.tabularNumeric, { color: theme.textPrimary }]}>
            {hwid.slice(0, 16)}...{hwid.slice(-8)}
          </Text>
        </Text>

        {licenseInfo.status === "UNLICENSED" || !licenseInfo.registeredEmail ? (
          <View style={styles.licenseFormBox}>
            <Text style={styles.formSubtitle}>Registro de Correo & Activación de Prueba (15 Días)</Text>
            <Text style={styles.sectionHelp}>
              Ingrese el correo electrónico del propietario para registrar este equipo de forma única,
              activar el periodo de prueba de 15 días y generar el archivo de configuración para Bisync.
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="propietario@comercio.com"
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={theme.textMuted}
                value={emailInput}
                onChangeText={setEmailInput}
                accessibilityLabel="Correo electrónico para registro de licencia"
              />
              <TouchableOpacity
                style={[styles.primaryButton, !db && styles.saveButtonDisabled]}
                activeOpacity={0.85}
                onPress={handleActivateTrial}
                disabled={!db}
                accessibilityRole="button"
                accessibilityLabel="Activar prueba de 15 días"
              >
                <Text style={styles.primaryButtonText}>ACTIVAR PRUEBA Y SOLICITAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.licenseRegisteredBox}>
            <Text style={styles.sectionHelp}>
              Correo registrado: <Text style={{ color: theme.textPrimary, fontWeight: "bold" }}>{licenseInfo.registeredEmail}</Text>
            </Text>
            <View style={styles.licenseActionRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.85}
                onPress={handleOpenGmail}
                accessibilityRole="button"
                accessibilityLabel="Abrir solicitud en Gmail Web"
              >
                <Text style={styles.secondaryButtonText}>✉️ ABRIR GMAIL EN NAVEGADOR</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.85}
                onPress={handleDownloadRequest}
                accessibilityRole="button"
                accessibilityLabel="Descargar archivo de solicitud en JSON"
              >
                <Text style={styles.secondaryButtonText}>📥 DESCARGAR ARCHIVO (.JSON)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.85}
                onPress={handleCopyRequest}
                accessibilityRole="button"
                accessibilityLabel="Copiar datos de solicitud al portapapeles"
              >
                <Text style={styles.secondaryButtonText}>📋 COPIAR DATOS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {generatedRequest ? (
          <View style={styles.jsonPreviewBox}>
            <Text style={styles.jsonTitle}>Fichero de Solicitud Generado ({generatedRequest.deviceLabel}):</Text>
            <Text style={[styles.jsonText, typography.tabularNumeric]}>
              {JSON.stringify(generatedRequest, null, 2)}
            </Text>
          </View>
        ) : null}

        {/* Carga de Licencia Comercial */}
        <View style={styles.licenseImportBox}>
          <Text style={styles.formSubtitle}>Instalar Licencia Definitiva (token.json)</Text>
          <Text style={styles.sectionHelp}>
            Cargue o arrastre el archivo firmado recibido desde bisyncdev@gmail.com para activar permanentemente.
          </Text>

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
                    setLicenseTokenInput("");
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
                <Text style={styles.dropZoneSubtext}>o selecciónalo desde tu equipo:</Text>
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
          <TextInput
            style={[styles.multilineInput, typography.tabularNumeric]}
            placeholder='{"payload":{...},"signature":"..."}'
            placeholderTextColor={theme.textMuted}
            value={licenseTokenInput}
            onChangeText={(val) => {
              setLicenseTokenInput(val);
              if (!val.trim()) setSelectedFileName(null);
            }}
            multiline
            numberOfLines={3}
            accessibilityLabel="Contenido del token de licencia JSON"
          />
          <TouchableOpacity
            style={[styles.installButton, (!db || !licenseTokenInput.trim()) && styles.saveButtonDisabled]}
            activeOpacity={0.85}
            onPress={handleInstallLicense}
            disabled={!db || !licenseTokenInput.trim()}
            accessibilityRole="button"
            accessibilityLabel="Instalar licencia comercial"
          >
            <Text style={styles.installButtonText}>ACTIVAR LICENCIA DEFINITIVA</Text>
          </TouchableOpacity>
        </View>

        {licMessage ? (
          <Text style={[styles.message, licError ? styles.messageError : styles.messageOk]}>
            {licError ? "⚠" : "✓"} {licMessage}
          </Text>
        ) : null}
      </View>

      {/* Card 3: Gestión de Cajeros y Operadores */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Gestión de Operadores y Cajeros</Text>
        <Text style={styles.sectionHelp}>
          Administre el personal con acceso a la caja. Los operadores con turnos o auditorías previas
          no se pueden eliminar físicamente para preservar el historial, pero pueden ser bloqueados.
        </Text>

        {/* Formulario de Registro */}
        <View style={styles.operatorForm}>
          <Text style={styles.formSubtitle}>Registrar Nuevo Operador</Text>
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, styles.flexInput]}
              placeholder="Nombre del Operador"
              placeholderTextColor={theme.textMuted}
              value={newName}
              onChangeText={setNewName}
            />
            <TextInput
              style={[styles.input, styles.pinInput, typography.tabularNumeric]}
              placeholder="PIN 4 dígitos"
              keyboardType="number-pad"
              maxLength={4}
              placeholderTextColor={theme.textMuted}
              value={newPin}
              onChangeText={(val) => setNewPin(val.replace(/[^0-9]/g, "").slice(0, 4))}
            />
            <View style={styles.roleGroup}>
              <TouchableOpacity
                style={[styles.roleBtn, newRole === "CASHIER" && styles.roleBtnActive]}
                onPress={() => setNewRole("CASHIER")}
                activeOpacity={0.8}
              >
                <Text style={[styles.roleBtnText, newRole === "CASHIER" && styles.roleBtnTextActive]}>
                  Cajero
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleBtn, newRole === "ADMIN" && styles.roleBtnActive]}
                onPress={() => setNewRole("ADMIN")}
                activeOpacity={0.8}
              >
                <Text style={[styles.roleBtnText, newRole === "ADMIN" && styles.roleBtnTextActive]}>
                  Admin
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.saveButton, !db && styles.saveButtonDisabled]}
              activeOpacity={0.85}
              onPress={handleCreateOperator}
              disabled={!db}
            >
              <Text style={styles.saveButtonText}>AGREGAR</Text>
            </TouchableOpacity>
          </View>

          {opError ? <Text style={[styles.message, styles.messageError]}>⚠ {opError}</Text> : null}
          {opSuccess ? <Text style={[styles.message, styles.messageOk]}>✓ {opSuccess}</Text> : null}
        </View>

        {/* Lista de Operadores */}
        <View style={styles.operatorList}>
          {operators.map((op) => {
            const checkDelete = db ? canDeleteOperator(db, op.id) : { canDelete: false };
            return (
              <View key={op.id} style={styles.operatorRow}>
                <View style={styles.operatorRowMain}>
                  <View style={styles.operatorMeta}>
                    <Text style={styles.operatorNameText}>{op.name}</Text>
                    <View style={styles.badgeRow}>
                      <View
                        style={[
                          styles.badge,
                          op.role === "ADMIN" ? styles.badgeAdmin : styles.badgeCashier,
                        ]}
                      >
                        <Text style={styles.badgeText}>
                          {op.role === "ADMIN" ? "ADMIN" : "CAJERO"}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.badge,
                          op.isActive ? styles.badgeActive : styles.badgeBlocked,
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            op.isActive ? styles.badgeTextActive : styles.badgeTextBlocked,
                          ]}
                        >
                          {op.isActive ? "ACTIVO" : "BLOQUEADO"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.operatorActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.changePinActionBtn]}
                      onPress={() => {
                        setEditingPinOperatorId(editingPinOperatorId === op.id ? null : op.id);
                        setPinEditValue("");
                        setPinConfirmValue("");
                        setOpError(null);
                        setOpSuccess(null);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.actionBtnText, styles.changePinActionText]}>
                        Cambiar PIN
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        op.isActive ? styles.blockActionBtn : styles.unblockActionBtn,
                      ]}
                      onPress={() => handleToggleActive(op.id, op.isActive)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.actionBtnText,
                          op.isActive ? styles.blockActionText : styles.unblockActionText,
                        ]}
                      >
                        {op.isActive ? "Bloquear" : "Desbloquear"}
                      </Text>
                    </TouchableOpacity>

                    {checkDelete.canDelete ? (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteActionBtn]}
                        onPress={() => handleDeleteOperator(op.id)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.actionBtnText, styles.deleteActionText]}>
                          Eliminar
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.historyChip}>
                        <Text style={styles.historyChipText}>Con historial</Text>
                      </View>
                    )}
                  </View>
                </View>

                {editingPinOperatorId === op.id ? (
                  <View style={styles.pinEditContainer}>
                    <View style={styles.pinInputsRow}>
                      <View style={styles.pinFieldGroup}>
                        <Text style={styles.pinFieldLabel}>Nuevo PIN (4 dígitos):</Text>
                        <TextInput
                          style={[styles.pinEditInput, typography.tabularNumeric]}
                          placeholder="••••"
                          placeholderTextColor={theme.textMuted}
                          keyboardType="number-pad"
                          maxLength={4}
                          secureTextEntry
                          value={pinEditValue}
                          onChangeText={(val) => {
                            setPinEditValue(val.replace(/[^0-9]/g, "").slice(0, 4));
                            setOpError(null);
                          }}
                          accessibilityLabel={`Nuevo PIN para ${op.name}`}
                        />
                      </View>

                      <View style={styles.pinFieldGroup}>
                        <Text style={styles.pinFieldLabel}>Confirmar PIN:</Text>
                        <TextInput
                          style={[
                            styles.pinEditInput,
                            typography.tabularNumeric,
                            pinConfirmValue.length === 4 &&
                              pinEditValue === pinConfirmValue &&
                              styles.pinInputMatch,
                            pinConfirmValue.length > 0 &&
                              pinConfirmValue.length === 4 &&
                              pinEditValue !== pinConfirmValue &&
                              styles.pinInputMismatch,
                          ]}
                          placeholder="••••"
                          placeholderTextColor={theme.textMuted}
                          keyboardType="number-pad"
                          maxLength={4}
                          secureTextEntry
                          value={pinConfirmValue}
                          onChangeText={(val) => {
                            setPinConfirmValue(val.replace(/[^0-9]/g, "").slice(0, 4));
                            setOpError(null);
                          }}
                          accessibilityLabel={`Confirmar nuevo PIN para ${op.name}`}
                        />
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.pinSaveBtn,
                          (pinEditValue.length !== 4 ||
                            pinConfirmValue.length !== 4 ||
                            pinEditValue !== pinConfirmValue) &&
                            styles.pinSaveBtnDisabled,
                        ]}
                        onPress={() => handleSavePin(op.id, op.name)}
                        activeOpacity={0.85}
                        disabled={
                          pinEditValue.length !== 4 ||
                          pinConfirmValue.length !== 4 ||
                          pinEditValue !== pinConfirmValue
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Guardar nuevo PIN"
                      >
                        <Text style={styles.pinSaveBtnText}>Guardar PIN</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.pinCancelBtn}
                        onPress={() => {
                          setEditingPinOperatorId(null);
                          setPinEditValue("");
                          setPinConfirmValue("");
                          setOpError(null);
                        }}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel="Cancelar cambio de PIN"
                      >
                        <Text style={styles.pinCancelBtnText}>Cancelar</Text>
                      </TouchableOpacity>
                    </View>

                    {pinConfirmValue.length > 0 &&
                    pinConfirmValue.length === 4 &&
                    pinEditValue !== pinConfirmValue ? (
                      <Text style={styles.pinMismatchText}>
                        ⚠ Los PINs no coinciden
                      </Text>
                    ) : pinEditValue.length === 4 && pinEditValue === pinConfirmValue ? (
                      <Text style={styles.pinMatchText}>
                        ✓ Los PINs coinciden (4 dígitos)
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.surfaceBase,
    },
    content: {
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      fontSize: typography.sizes.titleLg,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    card: {
      backgroundColor: c.surfaceContainerLow,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: spacing.radiusLg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    sectionTitle: {
      fontSize: typography.sizes.titleMd,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    sectionHelp: {
      fontSize: typography.sizes.caption,
      color: c.textSecondary,
      lineHeight: 18,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    input: {
      flex: 1,
      minHeight: spacing.touchTargetMin,
      maxHeight: spacing.touchTargetMin,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      paddingHorizontal: spacing.md,
      fontSize: typography.sizes.body,
      color: c.textPrimary,
      backgroundColor: c.surfaceContainer,
    },
    saveButton: {
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.xl,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.primary,
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.onPrimary,
      letterSpacing: 1,
    },
    message: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
    },
    messageOk: {
      color: c.heroText,
    },
    messageError: {
      color: c.errorText,
    },
    operatorForm: {
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    formSubtitle: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    formRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    flexInput: {
      flex: 2,
      minWidth: 180,
    },
    pinInput: {
      flex: 1,
      minWidth: 120,
    },
    roleGroup: {
      flexDirection: "row",
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.borderSolid,
      overflow: "hidden",
    },
    roleBtn: {
      paddingHorizontal: spacing.md,
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: c.surfaceContainer,
    },
    roleBtnActive: {
      backgroundColor: c.primarySoft,
    },
    roleBtnText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.medium,
      color: c.textMuted,
    },
    roleBtnTextActive: {
      color: c.primaryGlow,
      fontWeight: typography.weights.bold,
    },
    operatorList: {
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    operatorRow: {
      flexDirection: "column",
      alignItems: "stretch",
      padding: spacing.md,
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.border,
      gap: spacing.sm,
    },
    operatorRowMain: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
      flexWrap: "wrap",
    },
    operatorMeta: {
      gap: 4,
    },
    operatorNameText: {
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    badgeRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    badge: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 2,
      borderRadius: spacing.radiusSm,
    },
    badgeAdmin: {
      backgroundColor: c.primarySoft,
    },
    badgeCashier: {
      backgroundColor: c.neutralSoft,
    },
    badgeActive: {
      backgroundColor: c.heroSoft,
    },
    badgeBlocked: {
      backgroundColor: c.errorSoft,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    badgeTextActive: {
      color: c.heroText,
    },
    badgeTextBlocked: {
      color: c.errorText,
    },
    operatorActions: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "center",
    },
    actionBtn: {
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: spacing.radiusSm,
      justifyContent: "center",
      alignItems: "center",
    },
    actionBtnText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
    },
    blockActionBtn: {
      backgroundColor: c.warningSoft,
    },
    blockActionText: {
      color: c.warningText,
    },
    unblockActionBtn: {
      backgroundColor: c.heroSoft,
    },
    unblockActionText: {
      color: c.heroText,
    },
    changePinActionBtn: {
      backgroundColor: c.primarySoft,
    },
    changePinActionText: {
      color: c.primary,
    },
    deleteActionBtn: {
      backgroundColor: c.errorSoft,
    },
    deleteActionText: {
      color: c.errorText,
    },
    pinEditContainer: {
      flexDirection: "column",
      gap: spacing.xs,
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    pinInputsRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    pinFieldGroup: {
      gap: 2,
    },
    pinFieldLabel: {
      fontSize: 11,
      color: c.textMuted,
      fontWeight: typography.weights.medium,
    },
    pinEditInput: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: spacing.radiusSm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: c.textPrimary,
      backgroundColor: c.surfaceContainerLow,
      minWidth: 110,
      width: 120,
      height: 40,
      fontSize: typography.sizes.body,
      letterSpacing: 2,
    },
    pinInputMatch: {
      borderColor: c.hero,
      borderWidth: 1.5,
    },
    pinInputMismatch: {
      borderColor: c.error,
      borderWidth: 1.5,
    },
    pinSaveBtn: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: spacing.radiusSm,
      backgroundColor: c.primary,
      justifyContent: "center",
      alignItems: "center",
    },
    pinSaveBtnDisabled: {
      opacity: 0.45,
    },
    pinSaveBtnText: {
      color: "#FFFFFF",
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
    },
    pinCancelBtn: {
      minHeight: 40,
      paddingHorizontal: spacing.sm,
      borderRadius: spacing.radiusSm,
      backgroundColor: c.surfaceContainerHigh,
      justifyContent: "center",
      alignItems: "center",
    },
    pinCancelBtnText: {
      color: c.textSecondary,
      fontSize: typography.sizes.caption,
    },
    pinMatchText: {
      fontSize: 12,
      color: c.heroText,
      fontWeight: typography.weights.medium,
    },
    pinMismatchText: {
      fontSize: 12,
      color: c.errorText,
      fontWeight: typography.weights.medium,
    },
    historyChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: spacing.radiusSm,
      backgroundColor: c.neutralSoft,
    },
    historyChipText: {
      fontSize: 11,
      color: c.textMuted,
      fontStyle: "italic",
    },
    licenseHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    licenseBadge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: spacing.radiusSm,
      backgroundColor: c.surfaceContainerHigh,
    },
    licenseBadgeActive: {
      backgroundColor: c.heroSoft,
    },
    licenseBadgeTrial: {
      backgroundColor: c.warningSoft,
    },
    licenseBadgeExpired: {
      backgroundColor: c.errorSoft,
    },
    licenseBadgeUnlicensed: {
      backgroundColor: c.surfaceContainerHighest,
    },
    licenseBadgeText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.textPrimary,
    },
    licenseBadgeTextActive: {
      color: c.heroText,
    },
    licenseBadgeTextTrial: {
      color: c.warningText,
    },
    licenseBadgeTextExpired: {
      color: c.errorText,
    },
    licenseFormBox: {
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.border,
    },
    licenseRegisteredBox: {
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.border,
    },
    licenseImportBox: {
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: c.surfaceContainer,
      borderRadius: spacing.radiusMd,
      borderWidth: 1,
      borderColor: c.border,
    },
    licenseActionRow: {
      flexDirection: "row",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    primaryButton: {
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.primary,
    },
    primaryButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.onPrimary,
      letterSpacing: 0.5,
    },
    secondaryButton: {
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.surfaceContainerHighest,
      borderWidth: 1,
      borderColor: c.borderSolid,
    },
    secondaryButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.primaryGlow,
    },
    installButton: {
      minHeight: spacing.touchTargetMin,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      borderRadius: spacing.radiusMd,
      backgroundColor: c.hero,
    },
    installButtonText: {
      fontSize: typography.sizes.caption,
      fontWeight: typography.weights.bold,
      color: c.onHero,
    },
    multilineInput: {
      minHeight: 70,
      borderWidth: 1,
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusMd,
      padding: spacing.sm,
      fontSize: 12,
      color: c.textPrimary,
      backgroundColor: c.surfaceBase,
    },
    jsonPreviewBox: {
      backgroundColor: c.surfaceBase,
      padding: spacing.sm,
      borderRadius: spacing.radiusSm,
      borderWidth: 1,
      borderColor: c.border,
    },
    jsonTitle: {
      fontSize: 11,
      fontWeight: typography.weights.bold,
      color: c.textSecondary,
      marginBottom: 4,
    },
    jsonText: {
      fontSize: 11,
      color: c.heroText,
    },
    dropZone: {
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: c.borderSolid,
      borderRadius: spacing.radiusLg,
      padding: spacing.md,
      backgroundColor: c.surfaceBase,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      minHeight: 120,
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
      fontSize: 26,
      color: c.heroText,
    },
    dropZonePrompt: {
      alignItems: "center",
      gap: 4,
    },
    dropZoneText: {
      fontSize: typography.sizes.caption,
      color: c.textPrimary,
      textAlign: "center",
    },
    dropZoneSubtext: {
      fontSize: 11,
      color: c.textMuted,
      marginBottom: 2,
    },
    browseButton: {
      minHeight: spacing.touchTargetMin,
      paddingHorizontal: spacing.md,
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
      gap: 4,
    },
    fileSelectedText: {
      fontSize: typography.sizes.body,
      fontWeight: typography.weights.bold,
      color: c.heroText,
    },
    removeFileBtn: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    removeFileBtnText: {
      fontSize: 11,
      color: c.textMuted,
    },
  });
