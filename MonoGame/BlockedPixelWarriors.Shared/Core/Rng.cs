namespace BlockedPixelWarriors.Core;

/// <summary>
/// Small fast RNG helpers. <see cref="Shared"/> mirrors the web build's fxRandom; the seeded
/// mulberry32 generator reproduces the web layouts (cargo stacks) for the same seeds.
/// </summary>
public sealed class Rng
{
    private uint _state;

    public Rng(uint seed) => _state = seed;

    public static Rng Shared { get; } = new((uint)Environment.TickCount);

    /// <summary>mulberry32, identical to TrainModels.js mulberry().</summary>
    public float Next()
    {
        unchecked
        {
            _state += 0x6d2b79f5;
            uint t = _state;
            t = (t ^ (t >> 15)) * (t | 1);
            t ^= t + (t ^ (t >> 7)) * (t | 61);
            var v = (float)((t ^ (t >> 14)) / 4294967296.0);
            return v < 1f ? v : 0.99999994f;
        }
    }

    public float Range(float min, float max) => min + (max - min) * Next();

    /// <summary>Symmetric random in [-amount, amount] (Random.js spread()).</summary>
    public float Spread(float amount) => (Next() * 2 - 1) * amount;

    public int Int(int min, int maxInclusive) => min + (int)(Next() * (maxInclusive - min + 1));

    public bool Chance(float p) => Next() < p;

    public T Pick<T>(IReadOnlyList<T> list) => list[(int)(Next() * list.Count) % list.Count];
}
