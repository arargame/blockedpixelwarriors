using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Gameplay;

public enum ProjectileKind { Plasma, Tracer, Nova, Rocket, Shell, Cannonball, Missile }

public enum Owner { Player, Enemy }

/// <summary>Gameplay data per projectile kind (PROJECTILE_KINDS table).</summary>
public sealed record ProjectileDef(float Speed, float Damage, float Life, float Radius, Owner Owner, float Gravity = 0, float Homing = 0)
{
    public static readonly ProjectileDef[] All =
    {
        new(17, 1.4f, 1.6f, 0.25f, Owner.Player),
        new(36, 0.8f, 1.0f, 0.15f, Owner.Player),
        new(22, 1.2f, 0.8f, 0.2f, Owner.Player),
        new(15, 3.5f, 2.2f, 0.3f, Owner.Player),
        new(17, 4, 2.2f, 0.25f, Owner.Enemy),
        new(11, 10, 3.2f, 0.35f, Owner.Enemy, Gravity: 1.2f),
        new(10, 2.4f, 4.0f, 0.2f, Owner.Player, Homing: 5),
    };

    public static ProjectileDef Of(ProjectileKind k) => All[(int)k];
}

/// <summary>Per-shot options (gem colour, crit, aimed flag, damage multiplier).</summary>
public struct ShotStyle
{
    public Vector3? Tint;
    public GemKind? Gem;
    public bool Crit;
    public bool Aimed;
    public float DamageMul;

    public static ShotStyle Plain => new() { DamageMul = 1 };
}

public sealed class Projectile
{
    public ProjectileKind Kind;
    public ProjectileDef Def;
    public Vector3 Pos, Prev, Vel;
    public float Life, TrailTimer, Seed, Damage;
    public AimTarget? Target;
    public bool Aimed, Crit;
    public GemKind? Gem;
    public Vector3? Tint;
}

/// <summary>
/// Moves projectiles (sub-stepped against tunnelling), draws them as billboards / instanced
/// meshes and resolves hits through an injected collision handler (Mediator: this system knows
/// nothing about blocks, trains or the helicopter). Projectiles are pooled.
/// </summary>
public sealed class ProjectileSystem : IRenderable
{
    private readonly Effects _fx;
    private readonly List<Projectile> _items = new(256);
    private readonly ObjectPool<Projectile> _pool = new(() => new Projectile(), 128);
    private readonly BillboardBatch _comets, _tracerBolts, _glows, _orbs, _tracerBodies, _streaks;
    private readonly (GpuMesh mesh, InstanceBuffer buffer, bool spin)[] _models = new (GpuMesh, InstanceBuffer, bool)[7];
    private static readonly Vector3 SpinAxis = Vector3.Normalize(new Vector3(1, 0.3f, 0));

    /// <summary>Returns true when the projectile hit something (it is consumed).</summary>
    public Func<Projectile, Vector3, bool> CollisionHandler = (_, _) => false;
    public IReadOnlyList<Projectile> Items => _items;

    public ProjectileSystem(GraphicsDevice device, ModelLibrary models, Effects fx)
    {
        _fx = fx;
        BillboardBatch B(string tex, int cap, bool additive, int order, bool anchorTop = false)
        {
            var (t, srgb) = models.Texture(tex);
            return new BillboardBatch(device, t, srgb, cap, additive, order, anchorTop);
        }
        _comets = B("plasmaBolt", 400, false, 16, true);
        _tracerBolts = B("tracerBolt", 400, false, 15, true);
        _glows = B("glow", 600, true, 15);
        _orbs = B("orb", 400, false, 16);
        _tracerBodies = B("streak", 400, false, 14, true);
        _streaks = B("streak", 600, true, 14, true);
        void Model(ProjectileKind k, string name, int max, bool spin)
        {
            var mesh = models.Mesh(name);
            if (mesh != null) _models[(int)k] = (mesh, new InstanceBuffer(device, max, true), spin);
        }
        Model(ProjectileKind.Missile, "projectile_missile", 64, false);
        Model(ProjectileKind.Shell, "projectile_shell", 96, false);
        Model(ProjectileKind.Cannonball, "projectile_cannonball", 32, true);
    }

    public void Spawn(ProjectileKind kind, Vector3 position, Vector3 direction, AimTarget? target = null, ShotStyle? style = null)
    {
        var def = ProjectileDef.Of(kind);
        var s = style ?? ShotStyle.Plain;
        var p = _pool.Rent();
        p.Kind = kind;
        p.Def = def;
        p.Target = target;
        p.Aimed = s.Aimed;
        p.Gem = s.Gem;
        p.Crit = s.Crit;
        p.Tint = s.Tint;
        p.Damage = def.Damage * (s.DamageMul == 0 ? 1 : s.DamageMul);
        p.Pos = p.Prev = position;
        p.Vel = (direction.LengthSquared() > 1e-10f ? Vector3.Normalize(direction) : Vector3.Forward) * def.Speed;
        p.Life = 0;
        p.TrailTimer = 0;
        p.Seed = Rng.Shared.Next() * 10;
        _items.Add(p);
    }

    public void Update(float dt)
    {
        var rng = Rng.Shared;
        var write = 0;
        for (var i = 0; i < _items.Count; i++)
        {
            var p = _items[i];
            p.Life += dt;
            p.Prev = p.Pos;
            if (p.Target.HasValue && p.Def.Homing > 0)
            {
                var t = p.Target.Value;
                if (t.Alive)
                {
                    var to = t.Position - p.Pos;
                    var dist = to.Length();
                    var desired = (dist > 1e-5f ? to / dist : Vector3.Zero) * p.Def.Speed * (1 + p.Life * 0.6f);
                    p.Vel = Vector3.Lerp(p.Vel, desired, MathF.Min(1, dt * p.Def.Homing * (dist < 3 ? 2.5f : 1)));
                }
            }
            else if (p.Kind == ProjectileKind.Rocket)
            {
                p.Vel *= 1 + dt * 1.6f;
                p.Vel.Y -= dt * 1.5f;
            }
            else if (p.Def.Gravity > 0)
            {
                p.Vel.Y -= p.Def.Gravity * dt;
            }
            var steps = Math.Max(1, (int)MathF.Ceiling(p.Vel.Length() * dt / 0.35f));
            var consumed = false;
            for (var s = 0; s < steps && !consumed; s++)
            {
                p.Pos += p.Vel * (dt / steps);
                consumed = CollisionHandler(p, p.Pos);
            }
            if (consumed || p.Life > p.Def.Life || p.Pos.Y < -2)
            {
                _pool.Return(p);
                continue;
            }
            EmitTrail(p, dt, rng);
            _items[write++] = p;
        }
        _items.RemoveRange(write, _items.Count - write);
        BuildVisuals();
    }

    private void EmitTrail(Projectile p, float dt, Rng rng)
    {
        p.TrailTimer -= dt;
        if (p.TrailTimer > 0) return;
        if (p.Gem is GemKind.Red or GemKind.Green)
        {
            p.TrailTimer = 0.03f;
            var acid = p.Gem == GemKind.Green;
            _fx.Fire.Emit(new ParticleSpec
            {
                Position = p.Pos, Velocity = new Vector3(rng.Spread(0.5f), acid ? -1.5f : rng.Spread(0.5f), rng.Spread(0.5f)),
                Life = acid ? 0.35f : 0.25f, Size0 = acid ? 0.22f : 0.35f, Size1 = 0.04f, Aspect = 1,
                Color0 = acid ? new Vector4(0.6f, 3, 0.4f, 1) : new Vector4(5, 1.8f, 0.3f, 1), Color1 = acid ? new Vector4(0.2f, 1, 0.1f, 0) : new Vector4(2, 0.4f, 0.05f, 0), HasColor1 = true,
            });
        }
        switch (p.Kind)
        {
            case ProjectileKind.Plasma:
                p.TrailTimer = 0.03f;
                _fx.Fire.Emit(new ParticleSpec
                {
                    Position = p.Pos, Velocity = new Vector3(rng.Spread(0.4f), rng.Spread(0.4f), rng.Spread(0.4f)), Life = 0.25f, Size0 = 0.32f, Size1 = 0.05f, Aspect = 1,
                    Color0 = new Vector4(0.6f, 0.9f, 2.6f, 1), Color1 = new Vector4(0.9f, 0.2f, 1.6f, 0), HasColor1 = true,
                });
                break;
            case ProjectileKind.Rocket:
                p.TrailTimer = 0.02f;
                _fx.Smoke.Emit(new ParticleSpec { Position = p.Pos, Velocity = new Vector3(rng.Spread(0.3f), rng.Range(0.2f, 0.6f), rng.Spread(0.3f)), Life = 0.9f, Size0 = 0.3f, Size1 = 1.1f, Aspect = 1, Color0 = new Vector4(0.9f, 0.9f, 0.92f, 0.7f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true });
                _fx.Fire.Emit(new ParticleSpec { Position = p.Pos, Life = 0.08f, Size0 = 0.55f, Size1 = 0.2f, Aspect = 1, Color0 = new Vector4(5, 2.6f, 0.6f, 1), Color1 = new Vector4(2, 0.6f, 0.1f, 0), HasColor1 = true });
                break;
            case ProjectileKind.Missile:
            {
                p.TrailTimer = 0.016f;
                var dir = Vector3.Normalize(p.Vel);
                var tp = p.Pos - dir * 0.45f;
                _fx.Smoke.Emit(new ParticleSpec { Position = tp, Velocity = new Vector3(rng.Spread(0.25f), rng.Range(0.1f, 0.4f), rng.Spread(0.25f)), Drag = 1, Life = rng.Range(0.9f, 1.3f), Size0 = 0.25f, Size1 = 1.1f, Aspect = 1, Color0 = new Vector4(0.95f, 0.95f, 0.97f, 0.75f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true });
                _fx.Fire.Emit(new ParticleSpec { Position = tp, Velocity = -dir * 3, Life = 0.08f, Size0 = 0.55f, Size1 = 0.2f, Aspect = 1, Color0 = new Vector4(5, 2.4f, 0.6f, 1), Color1 = new Vector4(2, 0.5f, 0.1f, 0), HasColor1 = true });
                break;
            }
            case ProjectileKind.Shell:
                p.TrailTimer = 0.03f;
                _fx.Smoke.Emit(new ParticleSpec { Position = p.Pos, Velocity = new Vector3(0, 0.2f, 0), Life = 0.35f, Size0 = 0.14f, Size1 = 0.4f, Aspect = 1, Color0 = new Vector4(0.9f, 0.9f, 0.92f, 0.35f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true });
                break;
            case ProjectileKind.Cannonball:
                p.TrailTimer = 0.025f;
                _fx.Smoke.Emit(new ParticleSpec { Position = p.Pos, Velocity = new Vector3(rng.Spread(0.2f), rng.Range(0.1f, 0.4f), rng.Spread(0.2f)), Drag = 1, Life = 0.8f, Size0 = 0.3f, Size1 = 0.9f, Aspect = 1, Color0 = new Vector4(0.55f, 0.55f, 0.58f, 0.55f), Color1 = new Vector4(0.9f, 0.9f, 0.92f, 0), HasColor1 = true });
                break;
        }
    }

    /// <summary>Quaternion turning -Z onto <paramref name="dir"/> (Three setFromUnitVectors).</summary>
    private static Quaternion FromForward(Vector3 dir)
    {
        var a = Vector3.Forward;
        var r = Vector3.Dot(a, dir) + 1;
        Quaternion q;
        if (r < 1e-6f)
        {
            q = new Quaternion(0, 1, 0, 0); // 180 degrees about Y
        }
        else
        {
            var c = Vector3.Cross(a, dir);
            q = new Quaternion(c.X, c.Y, c.Z, r);
        }
        return Quaternion.Normalize(q);
    }

    private void BuildVisuals()
    {
        foreach (var m in _models) if (m.buffer != null) m.buffer.Count = 0;
        _comets.Begin();
        _tracerBolts.Begin();
        _orbs.Begin();
        _tracerBodies.Begin();
        _glows.Begin();
        _streaks.Begin();
        foreach (var p in _items)
        {
            var model = _models[(int)p.Kind];
            if (model.buffer != null)
            {
                var q = FromForward(Vector3.Normalize(p.Vel));
                if (model.spin) q *= Quaternion.CreateFromAxisAngle(SpinAxis, p.Life * 14 + p.Seed);
                model.buffer.Add(Matrix.CreateFromQuaternion(q) * Matrix.CreateTranslation(p.Pos), Vector4.One);
            }
            var v = p.Vel;
            float x = p.Pos.X, y = p.Pos.Y, z = p.Pos.Z;
            if (p.Tint.HasValue && p.Kind is ProjectileKind.Tracer or ProjectileKind.Plasma or ProjectileKind.Nova)
            {
                var c = p.Tint.Value;
                var big = (p.Kind == ProjectileKind.Plasma ? 1.5f : p.Kind == ProjectileKind.Nova ? 1.2f : 1) * (p.Gem == GemKind.Red ? 1.6f : 1) * (p.Crit ? 1.3f : 1);
                if (p.Gem == GemKind.Black)
                {
                    _tracerBodies.Push(x, y, z, 0.34f * big, 1.9f * big, 0.04f, 0.03f, 0.06f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 1.0f * big, 1.0f * big, p.Crit ? 3 : 1.2f, p.Crit ? 0.4f : 0.6f, p.Crit ? 0.6f : 2.6f, 1);
                    continue;
                }
                if (p.Gem == GemKind.Red)
                {
                    _streaks.Push(x, y, z, 0.5f * big, 2.2f * big, 5, 1.6f, 0.4f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 1.1f * big, 1.1f * big, 4, 1.2f, 0.3f, 1);
                    _glows.Push(x, y, z, 0.4f * big, 0.4f * big, 5, 4, 3, 1);
                    continue;
                }
                _streaks.Push(x, y, z, 0.42f * big, 1.9f * big, c.X * 4, c.Y * 4, c.Z * 4, 1, 0, v.X, v.Y, v.Z);
                _glows.Push(x, y, z, 0.95f * big, 0.95f * big, c.X * 3, c.Y * 3, c.Z * 3, 1);
                _glows.Push(x, y, z, 0.32f * big, 0.32f * big, 4, 4, 4, 1);
                continue;
            }
            switch (p.Kind)
            {
                case ProjectileKind.Plasma:
                {
                    var pulse = 1 + MathF.Sin(p.Life * 40 + p.Seed) * 0.12f;
                    _glows.Push(x, y, z, 1.6f * pulse, 1.6f * pulse, 1.4f, 0.15f, 1.3f, 0.9f);
                    _comets.Push(x, y, z, 0.95f, 3.0f, 1.8f, 1.8f, 1.9f, 1, 0, v.X, v.Y, v.Z);
                    break;
                }
                case ProjectileKind.Tracer:
                    _tracerBolts.Push(x, y, z, 0.3f, 2.0f, 2.6f, 2.2f, 1.8f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 0.7f, 0.7f, 2.6f, 1.2f, 0.3f, 0.7f);
                    break;
                case ProjectileKind.Rocket:
                    _streaks.Push(x, y, z, 0.32f, 1.2f, 4.5f, 3.2f, 1.6f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 0.9f, 0.9f, 4, 2, 0.6f, 1);
                    break;
                case ProjectileKind.Nova:
                    _streaks.Push(x, y, z, 0.42f, 1.6f, 1.2f, 3.2f, 4.2f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 0.9f, 0.9f, 0.6f, 2.2f, 3.4f, 0.9f);
                    break;
                case ProjectileKind.Missile:
                    if (model.buffer == null) _streaks.Push(x, y, z, 0.22f, 0.8f, 4.5f, 3.0f, 1.4f, 1, 0, v.X, v.Y, v.Z);
                    _glows.Push(x, y, z, 0.6f, 0.6f, 4, 2, 0.5f, 1);
                    break;
                case ProjectileKind.Cannonball:
                    if (model.buffer == null) _glows.Push(x, y, z, 1.0f, 1.0f, 1.2f, 1.1f, 1, 1);
                    break;
                case ProjectileKind.Shell:
                    if (model.buffer == null) _glows.Push(x, y, z, 0.95f, 0.95f, 4.5f, 1.8f, 0.4f, 1);
                    else _streaks.Push(x, y, z, 0.12f, 0.9f, 1.4f, 1.3f, 1.2f, 0.5f, 0, v.X, v.Y, v.Z);
                    break;
            }
        }
        foreach (var m in _models) m.buffer?.Upload();
        _comets.End();
        _tracerBolts.End();
        _orbs.End();
        _tracerBodies.End();
        _glows.End();
        _streaks.End();
    }

    public void Clear()
    {
        foreach (var p in _items) _pool.Return(p);
        _items.Clear();
        BuildVisuals();
    }

    public void Submit(RenderQueue queue)
    {
        foreach (var (mesh, buffer, _) in _models)
            if (buffer != null) queue.Add(mesh, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, buffer);
        queue.Add(_comets);
        queue.Add(_tracerBolts);
        queue.Add(_glows);
        queue.Add(_orbs);
        queue.Add(_tracerBodies);
        queue.Add(_streaks);
    }
}
