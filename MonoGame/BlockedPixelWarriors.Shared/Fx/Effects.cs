using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Fx;

/// <summary>
/// Facade over every visual effect system (EffectsManager.js): particles, voxel debris and the
/// flash point lights. Gameplay only calls intent-level methods such as Explosion() or MuzzleFlash().
/// </summary>
public sealed class Effects : IRenderable
{
    public ParticleSystem Smoke { get; }
    public ParticleSystem Fire { get; }
    public ParticleSystem Sparks { get; }
    public ParticleSystem Fireballs { get; }
    public DebrisSystem Debris { get; }

    private sealed class Flash
    {
        public PointLight Light;
        public float Life, MaxLife = 1, Peak;
    }

    private readonly Flash[] _flashes;
    private int _nextFlash;
    private static Rng R => Rng.Shared;

    public Effects(ParticleSystem smoke, ParticleSystem fire, ParticleSystem sparks, ParticleSystem fireballs, DebrisSystem debris, LightRig lights, int flashLights)
    {
        Smoke = smoke;
        Fire = fire;
        Sparks = sparks;
        Fireballs = fireballs;
        Debris = debris;
        _flashes = new Flash[flashLights];
        for (var i = 0; i < flashLights; i++)
        {
            var light = new PointLight { Color = Palette.ToLinear(0xffa040), Intensity = 0, Distance = 9, Decay = 1.6f };
            lights.Points.Add(light);
            _flashes[i] = new Flash { Light = light };
        }
    }

    public void Update(float dt)
    {
        Smoke.Update(dt);
        Fireballs.Update(dt);
        Fire.Update(dt);
        Sparks.Update(dt);
        Debris.Update(dt);
        foreach (var f in _flashes)
        {
            if (f.Life < f.MaxLife)
            {
                f.Life += dt;
                var t = MathF.Min(1, f.Life / f.MaxLife);
                f.Light.Intensity = f.Peak * (1 - t) * (1 - t);
            }
            else
            {
                f.Light.Intensity = 0;
            }
        }
    }

    private static readonly string Hide = Environment.GetEnvironmentVariable("BPW_HIDE") ?? "";

    public void Submit(RenderQueue queue)
    {
        if (!Hide.Contains("smoke")) Smoke.Submit(queue);
        if (!Hide.Contains("fireballs")) Fireballs.Submit(queue);
        if (!Hide.Contains("fire,") && !Hide.EndsWith("fire")) Fire.Submit(queue);
        if (!Hide.Contains("sparks")) Sparks.Submit(queue);
        if (!Hide.Contains("debris")) Debris.Submit(queue);
    }

    public void Clear()
    {
        Smoke.Clear();
        Fire.Clear();
        Sparks.Clear();
        Fireballs.Clear();
        Debris.Clear();
    }

    public void FlashLight(Vector3 position, uint color = 0xffa040, float intensity = 60, float duration = 0.35f, float distance = 9)
    {
        if (_flashes.Length == 0) return;
        var f = _flashes[_nextFlash];
        _nextFlash = (_nextFlash + 1) % _flashes.Length;
        f.Light.Position = position;
        f.Light.Color = Palette.ToLinear(color);
        f.Light.Distance = distance;
        f.Peak = intensity;
        f.Life = 0;
        f.MaxLife = duration;
    }

    private static Vector3 RandomDir(float yMin, float yMax)
    {
        var v = new Vector3(R.Spread(1), R.Range(yMin, yMax), R.Spread(1));
        return v.LengthSquared() > 1e-8f ? Vector3.Normalize(v) : Vector3.Up;
    }

    /// <summary>Big fiery explosion with smoke, sparks and an optional voxel debris burst.</summary>
    public void Explosion(Vector3 p, float scale = 1, uint? debrisColor = null, int debrisCount = 0)
    {
        for (var i = 0; i < 14 * scale; i++)
        {
            var v = RandomDir(0.2f, 1) * R.Range(1, 4.5f) * scale;
            Fireballs.Emit(new ParticleSpec
            {
                Position = p + new Vector3(R.Spread(0.3f * scale), R.Spread(0.3f * scale), R.Spread(0.3f * scale)),
                Velocity = v, Drag = 3, Life = R.Range(0.4f, 0.8f), Size0 = R.Range(1.3f, 2.2f) * scale, Size1 = R.Range(2.6f, 4.0f) * scale,
                Color0 = new Vector4(2.4f, 2.1f, 1.9f, 1), Color1 = new Vector4(0.9f, 0.5f, 0.35f, 0), HasColor1 = true, RotVel = R.Spread(2), Aspect = 1,
            });
        }
        Fire.Emit(new ParticleSpec { Position = p, Life = 0.16f, Size0 = 2.2f * scale, Size1 = 4.4f * scale, Aspect = 1, Color0 = new Vector4(2.6f, 1.8f, 0.9f, 1), Color1 = new Vector4(1.4f, 0.5f, 0.1f, 0), HasColor1 = true });
        for (var i = 0; i < 12 * scale; i++)
        {
            Smoke.Emit(new ParticleSpec
            {
                Position = p + new Vector3(R.Spread(0.6f * scale), R.Range(0, 0.6f), R.Spread(0.6f * scale)),
                Velocity = new Vector3(R.Spread(1.2f), R.Range(1.2f, 2.6f), R.Spread(1.2f)), Drag = 1.2f,
                Life = R.Range(1.2f, 2.2f), Size0 = R.Range(0.8f, 1.3f) * scale, Size1 = R.Range(2.4f, 3.6f) * scale, Aspect = 1,
                Color0 = new Vector4(0.2f, 0.19f, 0.18f, 0.9f), Color1 = new Vector4(0.55f, 0.55f, 0.57f, 0), HasColor1 = true, RotVel = R.Spread(0.8f),
            });
        }
        SparkBurst(p, (int)(22 * scale), 13 * scale, new Vector4(4, 2.4f, 0.8f, 1));
        if (debrisColor.HasValue && debrisCount > 0) Shatter(p, debrisColor.Value, debrisCount, 1);
        FlashLight(p, 0xff9a3c, 45 * scale, 0.45f, 9 * scale);
    }

    public void SparkBurst(Vector3 position, int count, float speed, Vector4? color = null)
    {
        var c = color ?? new Vector4(4, 2.6f, 0.9f, 1);
        for (var i = 0; i < count; i++)
        {
            var v = RandomDir(-0.2f, 1) * R.Range(0.35f, 1) * speed;
            Sparks.Emit(new ParticleSpec
            {
                Position = position, Velocity = v, Gravity = 14, Drag = 1.5f, Life = R.Range(0.25f, 0.6f),
                Size0 = 0.11f, Size1 = 0.05f, Aspect = 2, Stretch = 0.045f,
                Color0 = c, Color1 = new Vector4(c.X * 0.6f, c.Y * 0.3f, c.Z * 0.1f, 0), HasColor1 = true,
            });
        }
    }

    /// <summary>Voxel chunks flying off a block / cargo of a given colour (sRGB hex).</summary>
    public void Shatter(Vector3 position, uint color, int count, float power = 1, float minSize = 0.18f, float maxSize = 0.42f)
    {
        var baseColor = Palette.ToLinear(color);
        for (var i = 0; i < count; i++)
        {
            var v = new Vector3(R.Spread(1), R.Range(0.4f, 1.3f), R.Spread(1)) * (R.Range(3, 8) * power);
            Debris.Spawn(v * 0.04f + position, v, R.Range(minSize, maxSize), baseColor * R.Range(1.1f, 1.45f), R.Range(2.5f, 4.5f));
        }
    }

    /// <summary>Short muzzle flash at a barrel tip.</summary>
    public void MuzzleFlash(Vector3 position, Vector3 direction, Vector4? color = null, float size = 0.7f)
    {
        var c = color ?? new Vector4(4, 2.6f, 0.9f, 1);
        Fire.Emit(new ParticleSpec { Position = position, Life = 0.07f, Size0 = size, Size1 = size * 1.6f, Aspect = 1, Color0 = c, Color1 = new Vector4(c.X, c.Y * 0.5f, c.Z * 0.2f, 0), HasColor1 = true });
        Sparks.Emit(new ParticleSpec
        {
            Position = position, Velocity = direction * 12, Life = 0.06f, Size0 = size * 0.8f, Size1 = size * 0.5f, Aspect = 1.5f, Stretch = 0.06f,
            Color0 = c, Color1 = new Vector4(c.X, c.Y, c.Z, 0), HasColor1 = true,
        });
    }

    /// <summary>Small impact: sparks + puff, no debris.</summary>
    public void Impact(Vector3 position, Vector4? tint = null)
    {
        var t = tint ?? new Vector4(4, 2.4f, 0.8f, 1);
        SparkBurst(position, 7, 7, t);
        Fire.Emit(new ParticleSpec { Position = position, Life = 0.14f, Size0 = 0.6f, Size1 = 1.3f, Aspect = 1, Color0 = t, Color1 = new Vector4(t.X * 0.4f, t.Y * 0.2f, t.Z * 0.1f, 0), HasColor1 = true });
    }

    /// <summary>Puffs of chimney smoke (called continuously by the train).</summary>
    public void ChimneySmoke(Vector3 position, float intensity = 1)
    {
        Smoke.Emit(new ParticleSpec
        {
            Position = position + new Vector3(R.Spread(0.1f), 0, R.Spread(0.1f)),
            Velocity = new Vector3(R.Spread(0.5f), R.Range(2.4f, 3.6f) * intensity, R.Range(-1.6f, -0.6f)), Drag = 0.45f,
            Life = R.Range(3.6f, 5.2f), Size0 = R.Range(1.2f, 1.8f), Size1 = R.Range(8, 12), Aspect = 1,
            Color0 = new Vector4(0.3f, 0.3f, 0.31f, 1), Color1 = new Vector4(0.86f, 0.86f, 0.88f, 0), HasColor1 = true, RotVel = R.Spread(0.6f),
        });
    }

    /// <summary>White powder puff (snow knocked off blocks).</summary>
    public void SnowPuff(Vector3 position, int amount = 6)
    {
        for (var i = 0; i < amount; i++)
        {
            Smoke.Emit(new ParticleSpec
            {
                Position = position + new Vector3(R.Spread(0.4f), R.Spread(0.2f), R.Spread(0.4f)),
                Velocity = new Vector3(R.Spread(1.5f), R.Range(0.5f, 2), R.Spread(1.5f)), Drag = 2, Gravity = 0.6f,
                Life = R.Range(0.6f, 1.1f), Size0 = 0.4f, Size1 = R.Range(1.0f, 1.6f), Aspect = 1,
                Color0 = new Vector4(1.3f, 1.35f, 1.4f, 0.9f), Color1 = new Vector4(1.2f, 1.25f, 1.3f, 0), HasColor1 = true,
            });
        }
    }
}
