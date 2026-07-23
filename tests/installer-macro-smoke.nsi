Unicode true
Name "Kaoz.1 installer macro smoke test"
OutFile "kaoz1-installer-macro-smoke.exe"
RequestExecutionLevel user

!include "..\build\installer.nsh"

Function .onInit
  !insertmacro customInit
FunctionEnd

Section
SectionEnd
