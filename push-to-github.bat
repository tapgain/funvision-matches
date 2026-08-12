@echo off
REM FunVision match veri reposunu GitHub'a yükler.
REM ÖNCE: github.com'da public "funvision-matches" reposu oluştur (boş).
REM Sonra: bu dosyayı repo-bundle klasöründe çalıştır ve repo URL'sini yapıştır.

cd /d "%~dp0"

set /p REPO_URL="GitHub repo URL'si (https://github.com/KULLANICI/funvision-matches.git): "

git init
git add .
git commit -m "funvision match veri hatti (kaziyici + workflow)"
git branch -M main
git remote add origin %REPO_URL%
git push -u origin main

echo.
echo TAMAM. Actions otomatik baslayacak: Actions sekmesinde 'fetch-matches' isini goreceksin.
pause
