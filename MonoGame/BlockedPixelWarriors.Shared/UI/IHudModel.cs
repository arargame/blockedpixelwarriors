using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Gameplay;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.UI;

/// <summary>
/// Tank level, top centre (where the heli game shows the train panel): blocks broken toward the goal,
/// the drain filling toward its limit and the blocks still to come (hud.css .tank-panel).
/// </summary>
public readonly record struct ChannelPanel(string Title, int Broken, int Goal, int Drain, int DrainLimit, int Incoming);

/// <summary>
/// What the shared HUD (<see cref="Hud"/>) shows: the heli game (<see cref="GameSession"/>) and the
/// tank level (<see cref="TankLevel"/>) both feed it - score and wave / phase on top, the train or
/// channel panel in the middle, HP, objectives and the log bottom left, power-ups bottom right.
/// </summary>
public interface IHudModel
{
    /// <summary>In play (touch controls show, the HP row counts).</summary>
    bool HudPlaying { get; }
    bool Paused { get; }
    int ScoreValue { get; }
    /// <summary>Top-right panel: WAVE (heli game) or PHASE (tank level).</summary>
    string WaveLabel { get; }
    int Wave { get; }
    /// <summary>Heli game: the train damage panel (null when none).</summary>
    Train Train { get; }
    /// <summary>Tank level: the channel panel instead of the train (null in the heli game).</summary>
    ChannelPanel? Channel { get; }
    int Lives { get; }
    float HealthRatio { get; }
    /// <summary>Heli game: mission + cargo chopper bars (null in the tank level).</summary>
    Logistics Logistics { get; }
    (string title, IReadOnlyList<Objective> items) Objectives();
    IReadOnlyList<ActivePower> ActivePowers { get; }
    Vector3? TrainWarnPoint { get; }
    string TrainWarnSide { get; }
}
