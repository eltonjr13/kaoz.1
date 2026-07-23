!macro customInit
  ; v0.2.4 could leave its Electron/Node server process alive during the first
  ; corrective update. Do not use /T here because the installer can itself be
  ; a descendant of the application process that launched it.
  nsExec::ExecToLog 'taskkill.exe /IM "Kaoz.1.exe" /F'
  Pop $0
  ; Transitional cleanup for installations published before the Kaoz.1 rename.
  nsExec::ExecToLog 'taskkill.exe /IM "MrChicken.exe" /F'
  Pop $0
  Sleep 750
!macroend
