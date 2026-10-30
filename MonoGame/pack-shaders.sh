#!/usr/bin/env bash
# Shaders/*.glfx -> packed MGFX (OpenGL) for Desktop (Content/Effects) and phones (Content.Mobile/Effects).
set -e
cd "$(dirname "$0")"
dotnet build Tools/EffectPacker/EffectPacker.csproj -c Release -v q
P=$(ls Tools/EffectPacker/bin/Release/*/EffectPacker.dll | head -1)
dotnet "$P" Shaders BlockedPixelWarriors.Shared/Content/Effects
dotnet "$P" Shaders BlockedPixelWarriors.Shared/Content.Mobile/Effects --define MOBILE
