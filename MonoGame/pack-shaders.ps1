# Shaders/*.glfx -> packed MGFX (OpenGL) for Desktop (Content/Effects) and phones (Content.Mobile/Effects).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
dotnet build Tools/EffectPacker/EffectPacker.csproj -c Release -v q
$p = Get-ChildItem Tools/EffectPacker/bin/Release/*/EffectPacker.dll | Select-Object -First 1
dotnet $p.FullName Shaders BlockedPixelWarriors.Shared/Content/Effects
dotnet $p.FullName Shaders BlockedPixelWarriors.Shared/Content.Mobile/Effects --define MOBILE
