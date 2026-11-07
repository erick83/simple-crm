; ==============================================================================
; hooks.nsh — Script personalizado de instalación y desinstalación NSIS para Tauri v2
; Proyecto: Bisync POS
; Propósito: Garantizar la persistencia de datos (base de datos, inventario y configuración)
;            durante actualizaciones y ofrecer la opción de conservarlos por defecto al desinstalar.
; ==============================================================================

!macro customInstall
  ; Verificación durante la instalación o actualización
  ${If} ${FileExists} "$LOCALAPPDATA\com.bisync.pos\*.*"
    DetailPrint "------------------------------------------------------------"
    DetailPrint "Base de datos y configuración existente detectada en %LOCALAPPDATA%\com.bisync.pos"
    DetailPrint "Actualización segura: los datos de negocio se conservan intactos."
    DetailPrint "------------------------------------------------------------"
  ${EndIf}
!macroend

!macro customUnInstall
  ; Durante la desinstalación, comprobar si existen datos guardados de la app
  ${If} ${FileExists} "$LOCALAPPDATA\com.bisync.pos\*.*"
    ; MB_DEFBUTTON2 hace que el botón por defecto sea "No" (conservar datos)
    ; para prevenir pérdidas accidentales de datos contables e inventario.
    MessageBox MB_YESNO|MB_DEFBUTTON2|MB_ICONEXCLAMATION \
      "AVISO DE DATOS Y CONFIGURACIÓN LOCAL:$\r$\n$\r$\nSe han detectado datos de la aplicación (base de datos SQLite, inventario, facturación y configuración local).$\r$\n$\r$\n¿Desea ELIMINAR permanentemente todos los datos de su negocio?$\r$\n$\r$\n• Seleccione 'No' (Recomendado por defecto) para CONSERVAR sus datos ante una futura reinstalación o actualización.$\r$\n• Seleccione 'Sí' para BORRAR todo de forma definitiva." \
      IDNO keep_data_uninst

      DetailPrint "Eliminando datos locales de la aplicación a solicitud del usuario..."
      RMDir /r "$LOCALAPPDATA\com.bisync.pos"
      RMDir /r "$APPDATA\com.bisync.pos"
      Goto end_uninst

    keep_data_uninst:
      DetailPrint "Base de datos y configuración local conservadas correctamente."

    end_uninst:
  ${EndIf}
!macroend
