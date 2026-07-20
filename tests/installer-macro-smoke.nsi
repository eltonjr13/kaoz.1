Unicode true
Name "MrChicken installer macro smoke test"
OutFile "D:\apps\mrchicken\release\mrchicken-installer-macro-smoke.exe"
RequestExecutionLevel user

!include "..\build\installer.nsh"

Function .onInit
  !insertmacro customInit
FunctionEnd

Section
SectionEnd
