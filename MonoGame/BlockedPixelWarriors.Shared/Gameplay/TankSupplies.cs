using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Tank-level supplies (src/tank/TankSupplies.js): the Blender crate (supply_body / supply_trim /
/// supply_letter_X) in the type's colour with its glowing letter, smaller than a block. A destroyed
/// supply block throws one up; it lands, bobs and sparkles, is pulled toward the tank when it comes
/// close and collected on contact. Unpicked crates blink and vanish after Lifetime seconds.
/// </summary>
public sealed class TankSupplies
{
    private const float MagnetRadius = 6.5f, MagnetAccel = 34, PickupRadius = 2.6f, Lifetime = 18, Scale = 1.4f;

    public static uint Color(SupplyType t) => t switch
    {
        SupplyType.T => 0xff8a1e,
        SupplyType.D => 0x2f7ff0,
        SupplyType.R => 0xd8302a,
        SupplyType.H => 0x36b84a,
        _ => 0x9a4ae0,
    };

    public sealed class Item
    {
        public SupplyType Type;
        public Vector3 Pos, Vel;
        public float Age, Spin, Sparkle, Y;
        public bool Landed, Pulled, Visible = true;
        public Matrix World;
    }

    private readonly Effects _effects;
    private readonly Func<float, float, float> _floorAt;
    private readonly GpuMesh _body, _trim;
    private readonly Dictionary<SupplyType, GpuMesh> _letters = new();
    private readonly List<Item> _items = new();
    public Action<SupplyType, Item> OnPickup;
    public IReadOnlyList<Item> Items => _items;

    public TankSupplies(ModelLibrary models, Effects effects, Func<float, float, float> floorAt)
    {
        _effects = effects;
        _floorAt = floorAt;
        _body = models.Mesh("supply_body");
        _trim = models.Mesh("supply_trim");
        foreach (var t in new[] { SupplyType.T, SupplyType.D, SupplyType.R, SupplyType.H, SupplyType.G })
            if (models.Mesh($"supply_letter_{t}") is { } m) _letters[t] = m;
    }

    /// <summary>A crate of `type` thrown up out of a destroyed block at `at`.</summary>
    public void Spawn(SupplyType type, Vector3 at)
    {
        var r = Rng.Shared;
        _items.Add(new Item { Type = type, Pos = at, Vel = new Vector3(r.Spread(1.5f), 6.5f, r.Spread(1.5f)), Spin = r.Spread(0.6f) });
        _effects.SparkBurst(at, 14, 5, new Vector4(3, 2.6f, 1.6f, 1));
    }

    public void Update(float dt, Vector3 tank, bool canPickup)
    {
        var rng = Rng.Shared;
        for (var i = _items.Count - 1; i >= 0; i--)
        {
            var it = _items[i];
            it.Age += dt;
            var dx = tank.X - it.Pos.X;
            var dz = tank.Z - it.Pos.Z;
            var dist = MathF.Sqrt(dx * dx + dz * dz);
            var floor = _floorAt(it.Pos.X, it.Pos.Z) + 0.33f * Scale;
            if (canPickup && it.Age > 0.4f && dist < MagnetRadius)
            {
                // Magnet: drawn toward the tank, hopping a little.
                it.Pulled = true;
                it.Landed = false;
                it.Vel.X += dx / MathF.Max(dist, 1e-3f) * MagnetAccel * dt;
                it.Vel.Z += dz / MathF.Max(dist, 1e-3f) * MagnetAccel * dt;
                it.Vel *= MathF.Exp(-1.2f * dt);
                it.Vel.Y += ((tank.Y + 1.6f - it.Pos.Y) * 6 - it.Vel.Y) * MathF.Min(1, dt * 4);
                it.Pos += it.Vel * dt;
            }
            else if (!it.Landed)
            {
                it.Vel.Y -= 16 * dt;
                it.Vel.X *= MathF.Exp(-1.5f * dt);
                it.Vel.Z *= MathF.Exp(-1.5f * dt);
                it.Pos += it.Vel * dt;
                if (it.Pos.Y <= floor && it.Vel.Y < 0)
                {
                    it.Pos.Y = floor;
                    it.Vel = Vector3.Zero;
                    it.Landed = true;
                    it.Pulled = false;
                    _effects.SnowPuff(new Vector3(it.Pos.X, floor - 0.2f, it.Pos.Z), 5);
                }
            }
            var bob = it.Landed ? MathF.Sin(it.Age * 3) * 0.12f + 0.12f : 0;
            it.Y = it.Landed ? floor + bob : it.Pos.Y;
            var p = new Vector3(it.Pos.X, it.Y, it.Pos.Z);
            var rx = it.Landed ? 0 : MathF.Sin(it.Age * 5) * 0.3f;
            var rz = it.Landed ? 0 : MathF.Cos(it.Age * 4) * 0.2f;
            it.World = Matrix.CreateScale(Scale) * MathX.RotationXYZ(rx, it.Spin + MathF.Sin(it.Age * 1.4f) * 0.35f, rz) * Matrix.CreateTranslation(p);
            // Sparkles round the glowing letter.
            it.Sparkle -= dt;
            if (it.Sparkle <= 0)
            {
                it.Sparkle = 0.12f;
                _effects.Fire.Emit(new ParticleSpec
                {
                    Position = new Vector3(it.Pos.X + rng.Spread(0.6f), it.Y + 0.4f, it.Pos.Z + rng.Spread(0.5f)), Velocity = new Vector3(0, rng.Range(0.6f, 1.4f), 0),
                    Life = rng.Range(0.4f, 0.7f), Size0 = 0.28f, Size1 = 0.02f, Aspect = 1, Color0 = new Vector4(3, 2.7f, 1.8f, 1), Color1 = new Vector4(1.5f, 1, 0.4f, 0), HasColor1 = true,
                });
            }
            var left = Lifetime - it.Age;
            it.Visible = it.Pulled || left > 4 || (int)MathF.Floor(left * 8) % 2 == 0;
            if (canPickup && dist < PickupRadius && MathF.Abs(it.Y - tank.Y - 1) < 3)
            {
                _effects.SparkBurst(p, 26, 7, new Vector4(3, 3, 3, 1));
                _effects.FlashLight(p, Color(it.Type), 30, 0.3f, 6);
                _items.RemoveAt(i);
                OnPickup?.Invoke(it.Type, it);
            }
            else if (left <= 0 && !it.Pulled) _items.RemoveAt(i);
        }
    }

    public void Clear() => _items.Clear();

    public void Submit(RenderQueue queue)
    {
        foreach (var it in _items)
        {
            if (!it.Visible) continue;
            // ColorMul tints the near-white paint (the dark slats stay dark); alpha 1 keeps it opaque.
            if (_body != null) queue.Add(_body, it.World, new DrawOverrides { ColorMul = new Vector4(Palette.ToLinear(Color(it.Type)), 1) });
            if (_trim != null) queue.Add(_trim, it.World);
            if (_letters.TryGetValue(it.Type, out var l)) queue.Add(l, it.World, DrawOverrides.None, false);
        }
    }
}
