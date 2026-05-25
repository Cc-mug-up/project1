Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\毕业设计\project1"
WshShell.Run "D:\86189\node.exe server.js > server.log 2>&1", 0, False
