using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Gameplay.Combat;

/// <summary>What the tank level's projectiles and the fighter see (TankLevel.combatWorld).</summary>
public interface ICombatWorld
{
    Effects Effects { get; }
    TankBlock BlockAt(float x, float z);
    float BlockTop(TankBlock b);
    void DamageBlock(TankBlock b, float amount, Vector3 at);
    float FloorAt(float x, float z);
    bool WallAt(Vector3 p);
    bool IsWater(float x, float z);
    bool TankHit(Vector3 p);
    void DamageTank(float amount, Vector3 at);
    void BombBlast(Vector3 p, float radius, float damage);
    /// <summary>The fighter while it is a valid target (else null).</summary>
    JetFighter FlyingEnemy { get; }
    Enemy ClosestEnemy(Vector3 p);
    void ShakeAt(Vector3 p, float amount);
}

public enum HitKind { None, Block, Wall, Floor, Tank, Air }

public readonly record struct Hit(HitKind Kind, TankBlock Block = null, Enemy Enemy = null);

/// <summary>
/// Projectile class hierarchy of the tank level (src/combat/Projectiles.js, Template Method): the
/// base class moves the projectile in sub-steps (no tunnelling through a block), asks the subclass
/// what it hit and lets it react. Subclasses fill in Init / Integrate / Collide / Impact / Trail.
/// Instances come from per-class pools; ProjectileManager draws one instance buffer per class.
/// </summary>
public abstract class Projectile
{
    public Vector3 Pos, Vel;
    public float Age;
    protected float TrailTimer;

    protected virtual float MaxLife => 3;
    protected virtual float StepLength => 0.45f;

    public Projectile Launch(Vector3 pos, Vector3 vel)
    {
        Pos = pos;
        Vel = vel;
        Age = 0;
        TrailTimer = 0;
        Init();
        return this;
    }

    protected virtual void Init() { }

    /// <summary>Advances the projectile; false once it is spent (hit something or timed out).</summary>
    public bool Update(float dt, ICombatWorld w)
    {
        Age += dt;
        var speed = Vel.Length();
        var n = Math.Max(1, (int)MathF.Ceiling(speed * dt / StepLength));
        var h = dt / n;
        for (var k = 0; k < n; k++)
        {
            Integrate(h, w);
            var hit = Collide(w);
            if (hit.Kind != HitKind.None)
            {
                Impact(w, hit);
                return false;
            }
        }
        if (Age > MaxLife)
        {
            Expire(w);
            return false;
        }
        Trail(dt, w);
        return true;
    }

    protected virtual void Integrate(float h, ICombatWorld w) => Pos += Vel * h;

    protected abstract Hit Collide(ICombatWorld w);

    protected virtual void Impact(ICombatWorld w, Hit hit) { }

    protected virtual void Expire(ICombatWorld w) { }

    protected virtual void Trail(float dt, ICombatWorld w) { }

    public virtual void Release() { }

    /// <summary>Orientation for drawing: the model's forward axis along the velocity.</summary>
    public virtual Quaternion Orientation(Vector3 forward) => FromTo(forward, Vel);

    public static Quaternion FromTo(Vector3 a, Vector3 b)
    {
        if (b.LengthSquared() < 1e-8f) return Quaternion.Identity;
        a = Vector3.Normalize(a);
        b = Vector3.Normalize(b);
        var d = Vector3.Dot(a, b);
        if (d > 0.99999f) return Quaternion.Identity;
        if (d < -0.99999f)
        {
            var axis = Vector3.Cross(Vector3.UnitX, a);
            if (axis.LengthSquared() < 1e-6f) axis = Vector3.Cross(Vector3.UnitY, a);
            return Quaternion.CreateFromAxisAngle(Vector3.Normalize(axis), MathF.PI);
        }
        var c = Vector3.Cross(a, b);
        return Quaternion.Normalize(new Quaternion(c, 1 + d));
    }

    /// <summary>Shared hit test for player weapons: a channel block, a wall or the ground.</summary>
    protected static Hit GroundHit(ICombatWorld w, Vector3 p)
    {
        var b = w.BlockAt(p.X, p.Z);
        if (b != null && p.Y <= w.BlockTop(b)) return new Hit(HitKind.Block, b);
        if (w.WallAt(p)) return new Hit(HitKind.Wall);
        if (p.Y <= w.FloorAt(p.X, p.Z) + 0.05f) return new Hit(HitKind.Floor);
        return default;
    }
}

/// <summary>The tank's main gun: straight, fast, one block per shell.</summary>
public sealed class TankShell : Projectile
{
    public float Damage = GameConfig.Tank.ShellDamage;
    protected override float MaxLife => GameConfig.Tank.ShellRange / GameConfig.Tank.ShellSpeed;

    protected override Hit Collide(ICombatWorld w) => GroundHit(w, Pos);

    protected override void Impact(ICombatWorld w, Hit hit)
    {
        if (hit.Block != null) w.DamageBlock(hit.Block, Damage, Pos);
        var fx = w.Effects;
        fx.Explosion(Pos, 0.9f, hit.Block != null ? null : hit.Kind == HitKind.Wall ? 0xb9b6adu : 0x7a6a52u, hit.Block != null ? 0 : 6);
        if (hit.Kind == HitKind.Floor) fx.SnowPuff(Pos + new Vector3(0, 0.1f, 0), 6);
        w.ShakeAt(Pos, 0.4f);
    }

    protected override void Expire(ICombatWorld w) => w.Effects.Explosion(Pos, 0.6f);

    protected override void Trail(float dt, ICombatWorld w) =>
        w.Effects.Fire.Emit(new ParticleSpec { Position = Pos, Life = 0.12f, Size0 = 0.45f, Size1 = 0.1f, Aspect = 1, Color0 = new Vector4(3, 1.8f, 0.6f, 1), Color1 = new Vector4(1, 0.4f, 0.1f, 0), HasColor1 = true });
}

/// <summary>
/// R power-up: a homing missile (the heli's Blender rocket) launched up and out of the turret,
/// curving onto its target (any Enemy: a channel block or the fighter). Splash on the neighbours.
/// </summary>
public sealed class HomingMissile : Projectile
{
    public Enemy Target;
    public float Damage = GameConfig.Tank.MissileDamage;
    protected override float MaxLife => 4;
    protected override float StepLength => 0.35f;

    protected override void Integrate(float h, ICombatWorld w)
    {
        if (Target != null && Target.IsAlive)
        {
            var to = Target.AimPoint - Pos;
            var dist = to.Length();
            var want = to / MathF.Max(dist, 1e-4f) * GameConfig.Tank.MissileSpeed * (1 + Age * 0.6f);
            Vel = Vector3.Lerp(Vel, want, MathF.Min(1, h * 5 * (dist < 3 ? 2.5f : 1)));
        }
        else if (Age > 0.4f)
        {
            // Target gone: pick the nearest other one.
            Target = w.ClosestEnemy(Pos);
            if (Target == null) Vel.Y -= 6 * h;
        }
        base.Integrate(h, w);
    }

    protected override Hit Collide(ICombatWorld w)
    {
        if (Age < 0.25f) return default;
        var jet = w.FlyingEnemy;
        if (jet != null && jet.HitTest(Pos)) return new Hit(HitKind.Air, Enemy: jet);
        return GroundHit(w, Pos);
    }

    protected override void Impact(ICombatWorld w, Hit hit)
    {
        var fx = w.Effects;
        if (hit.Enemy != null)
        {
            hit.Enemy.TakeDamage(Damage, Pos);
            fx.Explosion(Pos, 0.8f);
            return;
        }
        if (hit.Block != null) w.DamageBlock(hit.Block, Damage, Pos);
        // Splash: the four neighbours take a hit.
        var s = GameConfig.TankArena.Block;
        foreach (var (dx, dz) in new[] { (s, 0f), (-s, 0f), (0f, s), (0f, -s) })
        {
            var n = w.BlockAt(Pos.X + dx, Pos.Z + dz);
            if (n != null && n != hit.Block) w.DamageBlock(n, 1, new Vector3(n.X, Pos.Y, n.Z));
        }
        fx.Explosion(Pos, 1.1f, hit.Block != null ? null : 0x7a6a52u, hit.Block != null ? 0 : 6);
        w.ShakeAt(Pos, 0.3f);
    }

    protected override void Expire(ICombatWorld w) => w.Effects.Explosion(Pos, 0.6f);

    protected override void Trail(float dt, ICombatWorld w)
    {
        TrailTimer -= dt;
        if (TrailTimer > 0) return;
        TrailTimer = 0.016f;
        var r = Rng.Shared;
        var d = Vector3.Normalize(Vel);
        var t = Pos - d * 0.45f;
        w.Effects.Smoke.Emit(new ParticleSpec
        {
            Position = t, Velocity = new Vector3(r.Spread(0.25f), r.Range(0.1f, 0.4f), r.Spread(0.25f)), Drag = 1,
            Life = r.Range(0.9f, 1.3f), Size0 = 0.3f, Size1 = 1.3f, Aspect = 1,
            Color0 = new Vector4(0.95f, 0.95f, 0.97f, 0.75f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true,
        });
        w.Effects.Fire.Emit(new ParticleSpec { Position = t, Velocity = -d * 3, Life = 0.08f, Size0 = 0.65f, Size1 = 0.2f, Aspect = 1, Color0 = new Vector4(5, 2.4f, 0.6f, 1), Color1 = new Vector4(2, 0.5f, 0.1f, 0), HasColor1 = true });
    }

    public override void Release() => Target = null;
}

/// <summary>The fighter's machine-gun round: a tracer that hurts the tank and kicks up water / dust.</summary>
public sealed class JetBullet : Projectile
{
    protected override float MaxLife => 1.6f;
    protected override float StepLength => 0.6f;

    protected override Hit Collide(ICombatWorld w)
    {
        if (w.TankHit(Pos)) return new Hit(HitKind.Tank);
        if (Pos.Y <= w.FloorAt(Pos.X, Pos.Z) + 0.05f) return new Hit(HitKind.Floor);
        var b = w.BlockAt(Pos.X, Pos.Z);
        if (b != null && Pos.Y <= w.BlockTop(b)) return new Hit(HitKind.Block, b);
        return default;
    }

    protected override void Impact(ICombatWorld w, Hit hit)
    {
        var fx = w.Effects;
        if (hit.Kind == HitKind.Tank)
        {
            w.DamageTank(GameConfig.Fighter.BulletDamage, Pos);
            fx.SparkBurst(Pos, 6, 5, new Vector4(4, 3, 1.5f, 1));
            return;
        }
        if (hit.Kind == HitKind.Block)
        {
            fx.SparkBurst(Pos, 3, 3, new Vector4(3, 2.4f, 1.4f, 1));
            return;
        }
        // Ground: a spurt of water in the channel, dust outside.
        var wet = w.IsWater(Pos.X, Pos.Z);
        var r = Rng.Shared;
        for (var i = 0; i < 3; i++)
        {
            fx.Smoke.Emit(new ParticleSpec
            {
                Position = Pos + new Vector3(0, 0.1f, 0), Velocity = new Vector3(r.Spread(1), r.Range(2, 4.5f), r.Spread(1)), Drag = 1.5f, Gravity = 9,
                Life = r.Range(0.35f, 0.6f), Size0 = 0.2f, Size1 = r.Range(0.6f, 0.9f), Aspect = 1,
                Color0 = wet ? new Vector4(1.2f, 1.35f, 1.45f, 0.85f) : new Vector4(0.62f, 0.55f, 0.44f, 0.7f),
                Color1 = wet ? new Vector4(1.1f, 1.2f, 1.3f, 0) : new Vector4(0.7f, 0.64f, 0.55f, 0), HasColor1 = true,
            });
        }
    }

    protected override void Trail(float dt, ICombatWorld w) =>
        w.Effects.Fire.Emit(new ParticleSpec { Position = Pos, Life = 0.05f, Size0 = 0.35f, Size1 = 0.12f, Aspect = 1, Color0 = new Vector4(4, 3, 1.2f, 1), Color1 = new Vector4(2, 0.8f, 0.2f, 0), HasColor1 = true });
}

/// <summary>
/// The fighter's WW2 bomb: falls with the throw it got at release, nose pitching down along the
/// flight path; a big blast where it lands (the tank by distance, every block in reach).
/// </summary>
public sealed class AerialBomb : Projectile
{
    protected override float MaxLife => 6;
    protected override float StepLength => 0.3f;

    protected override void Integrate(float h, ICombatWorld w)
    {
        Vel.Y -= GameConfig.Fighter.BombGravity * h;
        base.Integrate(h, w);
    }

    protected override Hit Collide(ICombatWorld w)
    {
        var b = w.BlockAt(Pos.X, Pos.Z);
        if (b != null && Pos.Y <= w.BlockTop(b)) return new Hit(HitKind.Block, b);
        if (w.TankHit(Pos)) return new Hit(HitKind.Tank);
        if (Pos.Y <= w.FloorAt(Pos.X, Pos.Z) + 0.1f) return new Hit(HitKind.Floor);
        return default;
    }

    protected override void Impact(ICombatWorld w, Hit hit) => w.BombBlast(Pos, GameConfig.Fighter.BombRadius, GameConfig.Fighter.BombDamage);

    protected override void Trail(float dt, ICombatWorld w)
    {
        TrailTimer -= dt;
        if (TrailTimer > 0) return;
        TrailTimer = 0.05f;
        w.Effects.Smoke.Emit(new ParticleSpec { Position = Pos + new Vector3(0, 0.3f, 0), Velocity = new Vector3(0, 0.3f, 0), Life = 0.6f, Size0 = 0.2f, Size1 = 0.6f, Aspect = 1, Color0 = new Vector4(0.8f, 0.8f, 0.82f, 0.35f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true });
    }

    public override Quaternion Orientation(Vector3 forward) => FromTo(forward, Vel.LengthSquared() < 1e-6f ? -Vector3.UnitY : Vel);
}

/// <summary>Owns the pools and the active list; one instance buffer per projectile class.</summary>
public sealed class ProjectileManager
{
    private sealed class Kind
    {
        public Func<Projectile> Rent;
        public Action<Projectile> Return;
        public GpuMesh Mesh;
        public InstanceBuffer Instances;
        public Vector3 Forward, Scale;
        public bool Shadow;
    }

    private readonly Dictionary<Type, Kind> _kinds = new();
    private readonly List<Projectile> _active = new();
    private readonly GraphicsDevice _device;

    public ProjectileManager(GraphicsDevice device) => _device = device;

    public IReadOnlyList<Projectile> Active => _active;

    public void Register<T>(GpuMesh mesh, Vector3 forward, Vector3 scale, int max, bool shadow, int prewarm = 16) where T : Projectile, new()
    {
        var pool = new ObjectPool<T>(() => new T(), prewarm);
        _kinds[typeof(T)] = new Kind
        {
            Rent = () => pool.Rent(), Return = p => pool.Return((T)p),
            Mesh = mesh, Instances = mesh != null ? new InstanceBuffer(_device, max, true) : null, Forward = forward, Scale = scale, Shadow = shadow,
        };
    }

    /// <summary>A pooled projectile of type T, launched at pos with velocity vel.</summary>
    public T Spawn<T>(Vector3 pos, Vector3 vel) where T : Projectile
    {
        var p = (T)_kinds[typeof(T)].Rent();
        p.Launch(pos, vel);
        _active.Add(p);
        return p;
    }

    public void Update(float dt, ICombatWorld w)
    {
        var write = 0;
        for (var i = 0; i < _active.Count; i++)
        {
            var p = _active[i];
            if (p.Update(dt, w)) _active[write++] = p;
            else Release(p);
        }
        _active.RemoveRange(write, _active.Count - write);
    }

    private void Release(Projectile p)
    {
        p.Release();
        _kinds[p.GetType()].Return(p);
    }

    public void Clear()
    {
        foreach (var p in _active) Release(p);
        _active.Clear();
    }

    public void Submit(RenderQueue queue)
    {
        foreach (var k in _kinds.Values)
        {
            if (k.Mesh == null) continue;
            k.Instances.Count = 0;
        }
        foreach (var p in _active)
        {
            var k = _kinds[p.GetType()];
            if (k.Mesh == null || k.Instances.Count >= k.Instances.Capacity) continue;
            k.Instances.Add(Matrix.CreateScale(k.Scale) * Matrix.CreateFromQuaternion(p.Orientation(k.Forward)) * Matrix.CreateTranslation(p.Pos), Vector4.One);
        }
        foreach (var k in _kinds.Values)
        {
            if (k.Mesh == null || k.Instances.Count == 0) continue;
            k.Instances.Upload();
            queue.Add(k.Mesh, Matrix.Identity, DrawOverrides.None, k.Shadow, 0, RenderLayer.World, k.Instances);
        }
    }
}

/// <summary>Context the fighter needs each frame (TankLevel.updateFighter).</summary>
public sealed class FighterContext
{
    public ProjectileManager Projectiles;
    public Effects Effects;
    public Vector3 TankPosition;
    public Func<float, float, float> FloorAt;
    public bool Armed;
    public Action<Vector3> CrashAt;
}

/// <summary>
/// The Blocked Pixel Panzer "FighterJet" enemy (src/combat/JetFighter.js): a WW2 prop fighter
/// (fighter_body / _prop / _disc / _bomb, Blender) making a strafing pass over the tank - in from
/// one side, across the tank's position, out the other side; 3-4 s of wing-gun fire on the way in
/// (aimed where the tank is as each round leaves), a bomb released to land where the tank is.
/// It can be shot down (homing missiles): it rolls over, trails fire and smoke and crashes.
/// </summary>
public sealed class JetFighter : Enemy
{
    private readonly GpuMesh _body, _prop, _disc, _bomb;
    private readonly Matrix _propM, _discM, _bombM;
    private readonly Vector3[] _guns;
    private Vector3 _dir = Vector3.UnitX, _pass, _vel, _pos;
    private float _s, _strafe, _fireTimer, _roll, _smokeTimer, _propSpin, _discSpin;
    private int _gun;
    private bool _bombDropped, _falling;
    public bool Done { get; private set; } = true;
    public Matrix World { get; private set; }
    public Vector3 Position => _pos;
    public bool Available => _body != null;
    /// <summary>Distance along the pass (negative before the pass point).</summary>
    public float PassS => _s;

    public JetFighter(ModelLibrary models, FighterData data) : base(GameConfig.Fighter.Hp, true, "fighter")
    {
        _body = models.Mesh("fighter_body");
        _prop = models.Mesh("fighter_prop");
        _disc = models.Mesh("fighter_disc");
        _bomb = models.Mesh("fighter_bomb");
        if (data == null) return;
        _propM = MathX.FromThree(data.PropMatrix);
        _discM = MathX.FromThree(data.DiscMatrix);
        _bombM = MathX.FromThree(data.BombMatrix);
        _guns = data.Guns.Select(MathX.V3).ToArray();
    }

    /// <summary>A target while flying (not once it is shot down and falling, or gone).</summary>
    public override bool IsAlive => Alive && !Done && !_falling;
    public override Vector3 AimPoint => _pos;

    public bool HitTest(Vector3 p) => Vector3.DistanceSquared(p, _pos) < GameConfig.Fighter.HitRadius * GameConfig.Fighter.HitRadius;

    /// <summary>Starts a pass over `target` from the left (side -1) or the right (+1).</summary>
    public void Start(Vector3 target, int side)
    {
        var r = Rng.Shared;
        _dir = Vector3.Normalize(new Vector3(-side, 0, r.Spread(0.35f)));
        _pass = new Vector3(target.X + r.Spread(GameConfig.Fighter.PassOffset), 0, target.Z + r.Spread(GameConfig.Fighter.PassOffset));
        _s = -GameConfig.Fighter.Approach;
        _strafe = r.Range(GameConfig.Fighter.StrafeMin, GameConfig.Fighter.StrafeMax);
        _fireTimer = 0;
        _gun = 0;
        _bombDropped = false;
        Hp = MaxHp;
        Alive = true;
        Done = false;
        _falling = false;
        _roll = 0;
        _smokeTimer = 0;
        Place(0);
    }

    private static float Altitude(float s)
    {
        var f = GameConfig.Fighter.Speed;
        var x = (s + f * 0.8f) / (f * 2.4f);
        return GameConfig.Fighter.Altitude - GameConfig.Fighter.Dive * MathF.Exp(-(x * x));
    }

    private void Place(float dt)
    {
        var prev = _pos;
        _pos = _pass + _dir * _s;
        _pos.Y = Altitude(_s);
        _vel = dt > 0 ? (_pos - prev) / dt : _dir * GameConfig.Fighter.Speed;
        var yaw = MathF.Atan2(_dir.X, _dir.Z);
        var pitch = -MathF.Atan2(_vel.Y, MathF.Sqrt(_vel.X * _vel.X + _vel.Z * _vel.Z));
        var bank = _s > 0 ? MathF.Min(0.6f, _s / 40) * MathF.Sign(_dir.Z == 0 ? 1 : _dir.Z) : MathF.Sin(_s * 0.05f) * 0.08f;
        SetWorld(pitch, yaw, bank + _roll);
    }

    private void SetWorld(float pitch, float yaw, float roll) =>
        World = Matrix.CreateScale(GameConfig.Fighter.Scale) * MathX.RotationYXZ(pitch, yaw, roll) * Matrix.CreateTranslation(_pos);

    public void Update(float dt, FighterContext ctx)
    {
        if (Done) return;
        var F = GameConfig.Fighter.Speed;
        _propSpin += dt * 46;
        _discSpin -= dt * 3;
        if (_falling)
        {
            Crash(dt, ctx);
            return;
        }
        _s += F * dt;
        Place(dt);
        var tank = ctx.TankPosition;
        // Strafe: the last `strafe` seconds before the pass point.
        var tLeft = -_s / F;
        if (ctx.Armed && tLeft > 0.15f && tLeft < _strafe + 0.15f)
        {
            _fireTimer -= dt;
            while (_fireTimer <= 0)
            {
                _fireTimer += 1 / GameConfig.Fighter.FireRate;
                Fire(ctx, tank);
            }
        }
        // Bomb: released so that it lands on the tank's current position.
        if (ctx.Armed && !_bombDropped && _bomb != null)
        {
            var b = Vector3.Transform(_bombM.Translation, World);
            var h = b.Y - ctx.FloorAt(tank.X, tank.Z);
            var T = MathF.Sqrt(2 * MathF.Max(h, 1) / GameConfig.Fighter.BombGravity);
            var ahead = Vector3.Dot(new Vector3(tank.X - b.X, 0, tank.Z - b.Z), _dir);
            if (ahead <= F * T)
            {
                _bombDropped = true;
                ctx.Projectiles.Spawn<AerialBomb>(b, new Vector3((tank.X - b.X) / T, 0, (tank.Z - b.Z) / T));
            }
        }
        if (Hp < MaxHp * 0.5f) Smoke(dt, ctx, 0.05f);
        if (_s > GameConfig.Fighter.Exit) Done = true;
    }

    private void Fire(FighterContext ctx, Vector3 tank)
    {
        var r = Rng.Shared;
        var g = Vector3.Transform(_guns[_gun++ % 2], World);
        var sp = GameConfig.Fighter.Spread;
        var d = Vector3.Normalize(new Vector3(tank.X + r.Spread(sp), tank.Y + 1.1f + r.Spread(0.4f), tank.Z + r.Spread(sp)) - g);
        ctx.Projectiles.Spawn<JetBullet>(g, d * GameConfig.Fighter.BulletSpeed);
        ctx.Effects.MuzzleFlash(g, d, new Vector4(5, 3.4f, 1.2f, 1), 0.7f);
    }

    private void Smoke(float dt, FighterContext ctx, float every)
    {
        _smokeTimer -= dt;
        if (_smokeTimer > 0) return;
        _smokeTimer = every;
        var r = Rng.Shared;
        var p = Vector3.Transform(new Vector3(0, 0.1f, 1.6f), World);
        ctx.Effects.Smoke.Emit(new ParticleSpec
        {
            Position = p, Velocity = new Vector3(r.Spread(0.4f), r.Range(0.2f, 0.8f), r.Spread(0.4f)), Drag = 0.8f,
            Life = r.Range(1.2f, 2), Size0 = 0.8f, Size1 = r.Range(2.4f, 3.4f), Aspect = 1,
            Color0 = new Vector4(0.12f, 0.11f, 0.1f, 0.85f), Color1 = new Vector4(0.3f, 0.3f, 0.3f, 0), HasColor1 = true,
        });
    }

    /// <summary>Shot down: stays in the scene (falling) until it hits the ground.</summary>
    protected override void OnDeath(Vector3 at)
    {
        _falling = true;
        _vel = _dir * GameConfig.Fighter.Speed * 0.9f;
        _vel.Y = 2;
    }

    private void Crash(float dt, FighterContext ctx)
    {
        _vel.Y -= 14 * dt;
        _pos += _vel * dt;
        _roll += dt * 4;
        SetWorld(-MathF.Atan2(_vel.Y, MathF.Sqrt(_vel.X * _vel.X + _vel.Z * _vel.Z)), MathF.Atan2(_dir.X, _dir.Z), _roll);
        Smoke(dt, ctx, 0.025f);
        var r = Rng.Shared;
        var p = Vector3.Transform(new Vector3(0, 0, 1.2f), World);
        ctx.Effects.Fire.Emit(new ParticleSpec { Position = p, Velocity = new Vector3(r.Spread(1), r.Range(0, 1), r.Spread(1)), Life = 0.3f, Size0 = 1.1f, Size1 = 0.3f, Aspect = 1, Color0 = new Vector4(5, 2.2f, 0.5f, 1), Color1 = new Vector4(2, 0.4f, 0.1f, 0), HasColor1 = true });
        if (_pos.Y <= ctx.FloorAt(_pos.X, _pos.Z) + 0.5f)
        {
            ctx.CrashAt?.Invoke(_pos);
            Done = true;
        }
    }

    public void Submit(RenderQueue queue)
    {
        if (Done || _body == null) return;
        queue.Add(_body, World);
        if (_prop != null) queue.Add(_prop, Matrix.CreateRotationZ(_propSpin) * _propM * World);
        if (_disc != null) queue.Add(_disc, Matrix.CreateRotationZ(_discSpin) * _discM * World, DrawOverrides.None, false, 5);
        if (_bomb != null && !_bombDropped) queue.Add(_bomb, _bombM * World);
    }
}
