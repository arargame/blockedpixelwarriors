using BlockedPixelWarriors.Core;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

public enum AimKind { Block, Gem, Turret, Cargo, Mine }

/// <summary>
/// A live thing the heli's guns can aim at (board block or train part). A value type, so smart
/// aim, homing missiles and the 8-way burst can hold on to it without allocations.
/// </summary>
public readonly struct AimTarget
{
    public readonly AimKind Kind;
    public readonly Block Block;
    public readonly Train Train;
    public readonly TrainCar Car;
    public readonly TrainTarget Part;
    public readonly Mine Mine;

    public AimTarget(Block block)
    {
        Kind = AimKind.Block;
        Block = block;
        Train = null;
        Car = null;
        Part = null;
        Mine = null;
    }

    public AimTarget(Mine mine)
    {
        Kind = AimKind.Mine;
        Block = null;
        Train = null;
        Car = null;
        Part = null;
        Mine = mine;
    }

    public AimTarget(Train train, TrainCar car, TrainTarget part)
    {
        Kind = part.Kind switch { TargetKind.Gem => AimKind.Gem, TargetKind.Turret => AimKind.Turret, _ => AimKind.Cargo };
        Block = null;
        Train = train;
        Car = car;
        Part = part;
        Mine = null;
    }

    public bool IsValid => Block != null || Part != null || Mine != null;

    public bool Alive => Block != null ? Block.Alive && Block.Drop <= 0 : Mine != null ? Mine.Alive : Part != null && Part.Alive && !Train.Destroyed;

    public Vector3 Position => Block != null ? new Vector3(Block.X, GameConfig.BlockSize * 0.55f, Block.Z) : Mine != null ? Mine.Pos : Car.ToWorld(Part.Center);
}

/// <summary>Spatial queries for weapons: targets in range of the helicopter, smart-aim lock.</summary>
public sealed class Targeting
{
    public readonly struct Candidate
    {
        public readonly AimTarget Target;
        public readonly float Dx, Dz;

        public Candidate(AimTarget t, float dx, float dz)
        {
            Target = t;
            Dx = dx;
            Dz = dz;
        }
    }

    private readonly List<Candidate> _buffer = new(256);
    private AimTarget _lock;

    /// <summary>Spiked balls are targets too (SURPRISE EGG).</summary>
    public SpikeMines Mines { get; set; }
    private float _lockAt = -1;

    /// <summary>
    /// Live targets within <paramref name="range"/> (horizontal) of <paramref name="from"/>: blocks
    /// (cargo waiting for the engineer excluded) and train parts. The list is reused.
    /// </summary>
    public List<Candidate> Collect(Vector3 from, float range, BlockField blocks, Train train)
    {
        var list = _buffer;
        list.Clear();
        var r2 = range * range;
        foreach (var b in blocks.Blocks)
        {
            if (!b.Alive || b.Drop > 0 || b.Cargo) continue;
            float dx = b.X - from.X, dz = b.Z - from.Z;
            if (dx * dx + dz * dz <= r2) list.Add(new Candidate(new AimTarget(b), dx, dz));
        }
        if (Mines != null)
        {
            foreach (var m in Mines.Mines)
            {
                if (!m.Alive || m.Falling) continue;
                float dx = m.Pos.X - from.X, dz = m.Pos.Z - from.Z;
                if (dx * dx + dz * dz <= r2) list.Add(new Candidate(new AimTarget(m), dx, dz));
            }
        }
        if (train != null && !train.Destroyed)
        {
            foreach (var car in train.Cars)
            foreach (var part in car.Targets)
            {
                if (!part.Alive || part.Kind == TargetKind.Hull) continue;
                var p = car.ToWorld(part.Center);
                float dx = p.X - from.X, dz = p.Z - from.Z;
                if (dx * dx + dz * dz <= r2) list.Add(new Candidate(new AimTarget(train, car, part), dx, dz));
            }
        }
        return list;
    }

    /// <summary>
    /// Smart aim ("auto pilot gunner"): within a narrow cone around the nose the best target is
    /// locked (train parts first, turrets before a shielded gem), refreshed every 0.12 s.
    /// </summary>
    public AimTarget? Lock(float now, Helicopter heli, BlockField blocks, Train train)
    {
        if (_lockAt >= 0 && now - _lockAt < 0.12f && _lock.IsValid && _lock.Alive) return _lock;
        var f = heli.ToWorldDirection(new Vector3(0, 0, -1));
        var cone = MathF.Cos(GameConfig.Heli.AimCone);
        var best = default(AimTarget);
        var found = false;
        var bestScore = float.MaxValue;
        var shielded = train?.GemShielded ?? false;
        foreach (var q in Collect(heli.Position, GameConfig.Heli.AimRange, blocks, train))
        {
            var d = MathF.Sqrt(q.Dx * q.Dx + q.Dz * q.Dz);
            if (d < 0.8f) continue;
            var cos = (q.Dx * f.X + q.Dz * f.Z) / d;
            if (cos < cone) continue;
            var angle = MathF.Acos(MathF.Min(1, cos));
            var priority = q.Target.Kind switch
            {
                AimKind.Gem => shielded ? 1f : -3f,
                AimKind.Turret => shielded ? -3f : -2.5f,
                AimKind.Cargo => -2.5f,
                _ => 0f,
            };
            var score = angle * 12 + d * 0.35f + priority;
            if (score < bestScore)
            {
                bestScore = score;
                best = q.Target;
                found = true;
            }
        }
        _lock = best;
        _lockAt = found ? now : -1;
        return found ? best : null;
    }

    public void Reset() => _lockAt = -1;
}
