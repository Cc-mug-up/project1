@echo off
schtasks /create /tn DormShareServer /tr "wscript.exe \"d:\毕业设计\project1\start-silent.vbs\"" /sc onlogon /it /f
echo.
echo If you see "成功" above, the auto-start task is set up.
echo If you see "拒绝访问", please right-click this file and "以管理员身份运行".
pause
