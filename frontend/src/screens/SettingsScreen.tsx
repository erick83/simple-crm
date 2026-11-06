import React, { useState, useCallback } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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

export interface SettingsScreenProps {
  db?: SqlDriver;
  tenantId?: string;
  terminalId?: string;
  currentOperator?: OperatorEntity | null;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  db: propDb,
  tenantId = "TENANT-001",
  terminalId = "TERM-01",
  currentOperator,
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
    try {
      setOpError(null);
      setOpSuccess(null);
      updateOperatorPin(db, operatorId, pinEditValue);

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
    try {
      const op = createOperator(db, {
        name: newName,
        role: newRole,
        pin: newPin,
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

      {/* Card 2: Gestión de Cajeros y Operadores */}
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
              onChangeText={setNewPin}
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
                    <TextInput
                      style={styles.pinEditInput}
                      placeholder="Nuevo PIN (4 dígitos)"
                      placeholderTextColor={theme.textMuted}
                      keyboardType="numeric"
                      maxLength={4}
                      secureTextEntry
                      value={pinEditValue}
                      onChangeText={setPinEditValue}
                    />
                    <TouchableOpacity
                      style={styles.pinSaveBtn}
                      onPress={() => handleSavePin(op.id, op.name)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.pinSaveBtnText}>Guardar PIN</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.pinCancelBtn}
                      onPress={() => {
                        setEditingPinOperatorId(null);
                        setPinEditValue("");
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.pinCancelBtnText}>Cancelar</Text>
                    </TouchableOpacity>
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
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      flexWrap: "wrap",
    },
    pinEditInput: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: spacing.radiusSm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      color: c.textPrimary,
      backgroundColor: c.surfaceContainerLow,
      minWidth: 160,
      height: 40,
      fontSize: typography.sizes.body,
    },
    pinSaveBtn: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: spacing.radiusSm,
      backgroundColor: c.primary,
      justifyContent: "center",
      alignItems: "center",
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
  });
