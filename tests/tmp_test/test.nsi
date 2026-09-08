Unicode true
Name Kaoz Test
OutFile tests\tmp_test\test.exe
RequestExecutionLevel user

!include MUI2.nsh

!define MUI_BGCOLOR 101217
!define MUI_TEXTCOLOR F4F5F7

!define MUI_PAGE_CUSTOMFUNCTION_SHOW customInstFilesShow
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE PortugueseBR

Function customInstFilesShow
  FindWindow $0 #32770 " $HWNDPARENT
 GetDlgItem $1 $0 1004
 System::Call 'uxtheme::SetWindowTheme(i r1, w , w )'
 SendMessage $1 0x0409 0 0x00F26C7C
 SendMessage $1 0x2001 0 0x00211A17
FunctionEnd

Section
 Sleep 1000
SectionEnd
