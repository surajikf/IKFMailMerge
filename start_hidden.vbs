Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get the directory of this script to ensure we run from the correct folder
ScriptPath = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = ScriptPath

' 0 = Hide window, False = Don't wait for completion
WshShell.Run "cmd /c run.bat", 0, False
