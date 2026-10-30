using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// What gameplay tells the HUD (Dependency Inversion: the session never touches drawing code).
/// Mirrors the web Hud.js API used by Game.js.
/// </summary>
public interface IHudEvents
{
    void Toast(string text, Color? color = null);
    void Notice(string text, Color color);
    /// <summary>Kill-feed line "who ➜ what [extra]".</summary>
    void Kill(string who, Color whoColor, string what, Color whatColor, string extra = null, Color? extraColor = null);
    void DamageFlash(float strength);
    void FloatText(string text, Vector3 world, Color color);
    void ShowTitle();
    void ShowGameOver(int score);
    /// <summary>All 300 packages delivered: red, green, blue counts.</summary>
    void ShowMissionComplete(int score, IReadOnlyList<int> delivered);
    void HideOverlay();
    void ClearLog();
}

/// <summary>Kill-feed colours (Game.js FEED / BOX_CSS).</summary>
public static class FeedColors
{
    public static readonly Color Heli = new(0x7b, 0xe8, 0x6a);
    public static readonly Color Train = new(0xff, 0x6b, 0x6b);
    public static readonly Color Engineer = new(0xff, 0xcf, 0x6a);
    public static readonly Color Grey = new(0xc9, 0xce, 0xd6);
    public static readonly Color Gold = new(0xff, 0xd3, 0x4a);
    public static readonly Color ToastDefault = new(0xff, 0xcf, 0x6a);
}
