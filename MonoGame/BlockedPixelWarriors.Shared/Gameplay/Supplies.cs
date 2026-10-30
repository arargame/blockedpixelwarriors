using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>Supply types: T triple fire, D 8-way burst, R homing rockets, H repair kit, G gem.</summary>
public enum SupplyType { T, D, R, H, G }

public enum GemKind { Blue, Green, Red, Black }

/// <summary>Supply catalogue (PowerUps.js POWERUPS) and gem table (GEMS).</summary>
public static class SupplyCatalog
{
    public sealed record Def(string Name, Color Css, uint Color, bool Timed);

    public sealed record GemDef(string Name, uint Color, Color Css, uint Glow, float DamageMul, float RateMul, float CritChance = 0, float CritMul = 1);

    public static readonly Def[] Supplies =
    {
        new("TRIPLE FIRE", new Color(0xff, 0xd2, 0x3f), 0xf2c230, true),
        new("8-WAY BURST", new Color(0x4f, 0xd8, 0xff), 0x27b9e0, true),
        new("HOMING ROCKETS", new Color(0xff, 0x6a, 0x4a), 0xe0442a, true),
        new("REPAIR KIT", new Color(0xff, 0x4d, 0x5e), 0xe8303c, false),
        new("GEM POWER", Color.White, 0xffffff, true),
    };

    public static readonly GemDef[] Gems =
    {
        new("RAPID FIRE", 0x3f8cff, new Color(0x5a, 0xb8, 0xff), 0x4f9cff, 1.2f, 2),
        new("ACID", 0x55e04a, new Color(0x7b, 0xe8, 0x6a), 0x62e153, 1, 1),
        new("POWER SHOT", 0xf43745, new Color(0xff, 0x6b, 0x6b), 0xff4a3a, 2.5f, 1),
        new("CRITICAL", 0x1c1a22, new Color(0xc9, 0xb8, 0xff), 0x8a6cff, 1.5f, 1, 0.2f, 3),
    };

    public static Def Of(SupplyType t) => Supplies[(int)t];

    public static GemDef Of(GemKind g) => Gems[(int)g];
}

/// <summary>An active timed power-up.</summary>
public sealed class ActivePower
{
    public SupplyType Type;
    public float Remaining, Duration;
    public GemKind? Gem;
}

/// <summary>Active timed power-ups (8-15 s each; picking the same again restarts it).</summary>
public sealed class PowerUpSystem
{
    private readonly List<ActivePower> _active = new();
    public IReadOnlyList<ActivePower> Active => _active;

    public void Activate(SupplyType type, float? duration = null, GemKind? gem = null)
    {
        var d = duration ?? GameConfig.Supply.DurationMin + Rng.Shared.Next() * (GameConfig.Supply.DurationMax - GameConfig.Supply.DurationMin);
        _active.RemoveAll(p => p.Type == type);
        _active.Add(new ActivePower { Type = type, Remaining = d, Duration = d, Gem = gem });
    }

    public bool Has(SupplyType type) => _active.Exists(p => p.Type == type);

    public GemKind? Gem => _active.Find(p => p.Type == SupplyType.G)?.Gem;

    public void Update(float dt)
    {
        foreach (var p in _active) p.Remaining -= dt;
        _active.RemoveAll(p => p.Remaining <= 0);
    }

    public void Clear() => _active.Clear();
}

/// <summary>
/// Supply drops (PowerUps.js SupplyCrates): letter crates (T/D/R), the first-aid kit (H) and a
/// faceted gem (G). They pop out of a block, drop to the floor and hover; inside the magnet
/// radius they curve in toward the helicopter.
/// </summary>
public sealed class SupplyCrates : IRenderable
{
    public sealed class Item
    {
        public SupplyType Type;
        public GemKind? Gem;
        public uint Color;
        public Vector3 Pos, Vel;
        public bool Landed, Pulled, Visible = true;
        public float Age, Spin;
        public Matrix World;
        public float GlowOpacity;
    }

    private readonly Effects _effects;
    private readonly GpuMesh _crate, _firstAid, _gem;
    private readonly RenderMaterial[] _crateMaterials = new RenderMaterial[3];
    private readonly RenderMaterial[] _gemMaterials = new RenderMaterial[4];
    private readonly BillboardBatch _glows;
    private readonly List<Item> _items = new();

    public IReadOnlyList<Item> Items => _items;
    public Action<SupplyType, Item> OnPickup;

    public SupplyCrates(GraphicsDevice device, ModelLibrary models, Dictionary<string, string> crateTextures, Effects effects)
    {
        _effects = effects;
        _crate = models.Mesh("supply_crate");
        _firstAid = models.Mesh("supply_firstaid");
        _gem = models.Mesh("supply_gem");
        var baseMat = _crate.Material;
        foreach (var type in new[] { SupplyType.T, SupplyType.D, SupplyType.R })
        {
            var m = baseMat.Clone();
            if (crateTextures != null && crateTextures.TryGetValue(type.ToString(), out var tex))
            {
                var (t, srgb) = models.Texture(tex);
                m.Map = t;
                m.MapSrgb = srgb;
            }
            m.Emissive = Palette.ToLinear(SupplyCatalog.Of(type).Color) * 0.12f;
            _crateMaterials[(int)type] = m;
        }
        for (var g = 0; g < 4; g++)
        {
            var def = SupplyCatalog.Gems[g];
            var black = g == (int)GemKind.Black;
            var m = _gem.Material.Clone();
            m.BaseColor = new Vector4(Palette.ToLinear(def.Color), 1);
            m.Emissive = Palette.ToLinear(black ? 0x3a2a66 : def.Color) * (black ? 0.5f : 0.18f);
            m.Roughness = 0.04f;
            m.Metalness = black ? 0.6f : 0.35f;
            m.EnvIntensity = black ? 3 : 2.2f;
            _gemMaterials[g] = m;
        }
        var (glow, glowSrgb) = models.Texture("glow");
        _glows = new BillboardBatch(device, glow, glowSrgb, 64, true, 0);
    }

    /// <summary>Uniformly random type; G and R only join with their upgrade cards.</summary>
    public Item SpawnRandom(Vector3 position, bool gems, bool homing)
    {
        Span<SupplyType> pool = stackalloc SupplyType[5];
        var n = 0;
        foreach (SupplyType t in Enum.GetValues(typeof(SupplyType)))
            if ((gems || t != SupplyType.G) && (homing || t != SupplyType.R)) pool[n++] = t;
        return Spawn(pool[(int)(Rng.Shared.Next() * n)], position);
    }

    public Item Spawn(SupplyType type, Vector3 position, GemKind? gemKind = null)
    {
        var rng = Rng.Shared;
        var item = new Item
        {
            Type = type,
            Color = SupplyCatalog.Of(type).Color,
            Pos = position,
            Vel = new Vector3((rng.Next() - 0.5f) * 1.5f, 5.5f, (rng.Next() - 0.5f) * 1.5f),
            Spin = rng.Next() * 6,
        };
        if (type == SupplyType.G)
        {
            item.Gem = gemKind ?? (GemKind)(int)(rng.Next() * 4);
            item.Color = SupplyCatalog.Of(item.Gem.Value).Color;
        }
        _items.Add(item);
        return item;
    }

    public void Update(float dt, Vector3 heliPos, bool canPickup)
    {
        const float hover = 0.62f;
        var rng = Rng.Shared;
        for (var i = _items.Count - 1; i >= 0; i--)
        {
            var it = _items[i];
            it.Age += dt;
            var toHeli = heliPos - it.Pos;
            var dist = toHeli.Length();
            var inField = canPickup && it.Age > 0.35f && dist < GameConfig.Supply.MagnetRadius;
            if (inField)
            {
                it.Pulled = true;
                it.Landed = false;
                it.Vel += toHeli / MathF.Max(dist, 1e-3f) * GameConfig.Supply.MagnetAccel * dt;
                it.Vel *= MathF.Exp(-GameConfig.Supply.MagnetDamping * dt);
                it.Pos += it.Vel * dt;
            }
            else if (!it.Landed)
            {
                it.Vel.Y -= 16 * dt;
                it.Vel.X *= MathF.Exp(-2 * dt);
                it.Vel.Z *= MathF.Exp(-2 * dt);
                it.Pos += it.Vel * dt;
                if (it.Pos.Y <= hover && it.Vel.Y < 0)
                {
                    it.Pos.Y = hover;
                    it.Vel = Vector3.Zero;
                    it.Landed = true;
                    it.Pulled = false;
                    _effects.SnowPuff(new Vector3(it.Pos.X, 0.2f, it.Pos.Z), 4);
                }
            }
            var bob = it.Landed ? MathF.Sin(it.Age * 3) * 0.12f : 0;
            it.Spin += dt * (it.Pulled ? 6 : 1.6f);
            var meshPos = new Vector3(it.Pos.X, it.Pos.Y + bob, it.Pos.Z);
            var gem = it.Type == SupplyType.G;
            var scale = gem ? Matrix.CreateScale(0.62f, 1.25f, 0.62f) : it.Type == SupplyType.H ? Matrix.CreateScale(0.95f) : Matrix.Identity;
            it.World = scale * MathX.RotationXYZ(gem ? 0.3f : 0.35f, it.Spin, gem ? 0 : 0.2f) * Matrix.CreateTranslation(meshPos);
            it.GlowOpacity = (0.55f + MathF.Sin(it.Age * 6) * 0.2f) * (gem ? 0.35f : 1);
            if (it.Pulled && rng.Next() < 0.6f)
            {
                var c = Palette.ToLinear(it.Gem.HasValue ? SupplyCatalog.Of(it.Gem.Value).Glow : it.Color);
                _effects.Fire.Emit(new ParticleSpec { Position = it.Pos, Life = 0.25f, Size0 = 0.35f, Size1 = 0.05f, Aspect = 1, Color0 = new Vector4(c * 3, 1), Color1 = new Vector4(c, 0), HasColor1 = true });
            }
            var left = GameConfig.Supply.CrateLifetime - it.Age;
            it.Visible = it.Pulled || left > 4 || (int)MathF.Floor(left * 8) % 2 == 0;
            if (canPickup && dist < GameConfig.Supply.PickupRadius)
            {
                _effects.SparkBurst(meshPos, 26, 7, new Vector4(3, 3, 3, 1));
                _effects.FlashLight(meshPos, it.Color, 30, 0.3f, 6);
                _items.RemoveAt(i);
                OnPickup?.Invoke(it.Type, it);
            }
            else if (left <= 0 && !it.Pulled)
            {
                _items.RemoveAt(i);
            }
        }
    }

    public void Clear() => _items.Clear();

    public void Submit(RenderQueue queue)
    {
        _glows.Begin();
        foreach (var it in _items)
        {
            if (it.Visible)
            {
                switch (it.Type)
                {
                    case SupplyType.H:
                        queue.Add(_firstAid, it.World);
                        break;
                    case SupplyType.G:
                        queue.Add(_gem, it.World, DrawOverrides.None, true, 0, RenderLayer.World, null, _gemMaterials[(int)it.Gem.GetValueOrDefault()]);
                        break;
                    default:
                        queue.Add(_crate, it.World, DrawOverrides.None, true, 0, RenderLayer.World, null, _crateMaterials[(int)it.Type]);
                        break;
                }
            }
            var glow = Palette.ToLinear(it.Gem.HasValue ? SupplyCatalog.Of(it.Gem.Value).Glow : it.Color) * (it.Type == SupplyType.G ? 1.1f : 1.4f);
            var size = it.Type == SupplyType.G ? 2.6f : 2.2f;
            var p = it.World.Translation;
            _glows.Push(p.X, 0.25f, p.Z, size, size, glow.X, glow.Y, glow.Z, it.GlowOpacity);
        }
        _glows.End();
        queue.Add(_glows);
    }
}
