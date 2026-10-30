using BlockedPixelWarriors.Assets;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// The upgrade-card picker as gameplay sees it (Dependency Inversion: the session decides what to
/// offer and applies the choice, the UI shows the cards and reports the pick).
/// </summary>
public interface ICardPicker
{
    bool Active { get; }

    /// <summary>Shows up to two cards; <paramref name="onPick"/> runs once the chosen card has been played.</summary>
    void Show(IReadOnlyList<CardDefData> defs, Action<CardDefData> onPick);

    /// <summary>Hides the picker without choosing (game over, restart).</summary>
    void Cancel();
}
