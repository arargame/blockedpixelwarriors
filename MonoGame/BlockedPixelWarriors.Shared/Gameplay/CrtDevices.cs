using BlockedPixelWarriors.Core;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Stage 2 CRT comm devices (CrtDevices.js): exactly one train cargo cube in every CrtEvery
/// loaded on the terrace is a CRT radio. Cubes are counted over every train and every trip; each
/// run of CrtEvery cubes gets one at a random place in it.
/// </summary>
public sealed class CrtDevices
{
    private int _loaded, _slot;
    public bool Enabled { get; }

    public CrtDevices(bool enabled)
    {
        Enabled = enabled;
        Reset();
    }

    public void Reset()
    {
        _loaded = 0;
        _slot = RollSlot();
    }

    /// <summary>Capture runs: the CRT is cube number <paramref name="slot"/> of the current hundred.</summary>
    public void ForceSlot(int slot) => _slot = slot;

    private static int RollSlot() => (int)(Rng.Shared.Next() * GameConfig.Stages.CrtEvery);

    /// <summary>Counts one freshly loaded cube; true when it is this run's CRT.</summary>
    public bool Next()
    {
        var n = GameConfig.Stages.CrtEvery;
        var hit = _loaded % n == _slot;
        _loaded++;
        if (_loaded % n == 0) _slot = RollSlot();
        return hit;
    }

    /// <summary>Every live cargo cube of the cars is counted; the chosen one becomes a CRT.</summary>
    public void Load(IEnumerable<TrainCar> cars)
    {
        foreach (var car in cars)
        foreach (var t in car.Targets)
        {
            if (t.Kind != TargetKind.Cargo || !t.Alive) continue;
            t.Crt = Enabled && Next();
        }
    }
}
