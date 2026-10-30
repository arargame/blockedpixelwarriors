using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

public enum TargetKind { Gem, Turret, Hull, Cargo }

/// <summary>A destructible part of a train car (car-local box).</summary>
public sealed class TrainTarget
{
    public TargetKind Kind;
    public BoundingBox Box;
    public float Hp, MaxHp;
    public bool Alive = true;
    public Turret Turret;
    // Cargo cubes
    public BlockColor Color;
    public bool Snow;
    public float Size;
    public float CubeYaw;
    public Vector3 Center => (Box.Min + Box.Max) * 0.5f;
}

/// <summary>Twin-barrel turret: base on the car roof, head (yaw group) tracking the helicopter.</summary>
public sealed class Turret
{
    public Vector3 Mount;
    public Vector3[] Muzzles;
    public float Yaw;
    public float Cooldown = 1 + Rng.Shared.Next();
    public bool Alive = true;
    public float Recoil, SmokeTimer, BurnTimer;
    public TrainTarget Target;
    public Vector3 HeadOffset;
    public Matrix BaseWorld, HeadWorld;
}

public sealed class Cannon
{
    public Vector3 Muzzle, Dir;
}

public enum CarKind { Locomotive, Armored, Cargo }

public sealed class TrainCar
{
    public CarKind Kind;
    public GpuMesh Body;
    public float Length, OffsetZ;
    public Vector3[] Chimneys;
    public Cannon[] Cannons;
    public List<Turret> Turrets = new();
    public List<TrainTarget> Targets = new();
    public Matrix World, InverseWorld;

    public Vector3 ToWorld(Vector3 local) => Vector3.Transform(local, World);
}

/// <summary>
/// Builds train cars from the exported prefabs (Factory): bodies + metadata come from the web
/// export, cargo stacks are generated with the same seeded mulberry32 as TrainModels.js.
/// </summary>
public sealed class TrainFactory
{
    private readonly ModelLibrary _models;
    private readonly PrefabData _prefabs;
    public GpuMesh TurretBase { get; }
    public GpuMesh TurretHead { get; }
    public GpuMesh CargoCube { get; }
    public GpuMesh CargoSnow { get; }
    public RenderMaterial CubeMaterial { get; }
    public GpuMesh Shield { get; }

    public TrainFactory(ModelLibrary models, PrefabData prefabs)
    {
        _models = models;
        _prefabs = prefabs;
        TurretBase = models.Mesh("turret_base");
        TurretHead = models.Mesh("turret_head");
        CargoCube = models.Mesh("cargo_cube");
        CargoSnow = models.Mesh("cargo_snowcap");
        // Cube colour comes per instance (materials.block(color) = palette * 1.12).
        CubeMaterial = CargoCube.Material.Clone();
        CubeMaterial.BaseColor = Vector4.One;
        Shield = Procedural.Icosphere(models.Device, "gem_shield", 2, new Vector3(1.05f, 1.05f, 0.55f), new RenderMaterial
        {
            Name = "GemShield", Unlit = true, Blend = BlendMode.Additive, DepthWrite = false, CastShadow = false,
            BaseColor = new Vector4(Palette.ToLinear(0x5cc8ff), 0.2f),
        });
    }

    public static Vector3 BlockLinear(BlockColor c) => Palette.ToLinear(Palette.Block(c)) * 1.12f;

    public TrainCar Build(CarKind kind, uint seed)
    {
        var (name, data) = kind switch
        {
            CarKind.Locomotive => ("car_locomotive", _prefabs.Locomotive),
            CarKind.Armored => ("car_armored", _prefabs.Armored),
            _ => ("car_cargo", _prefabs.Cargo),
        };
        var car = new TrainCar
        {
            Kind = kind,
            Body = _models.Mesh(name),
            Length = data.Length,
            Chimneys = data.Chimneys.Select(MathX.V3).ToArray(),
            Cannons = data.Cannons.Select(c => new Cannon { Muzzle = MathX.V3(c.Muzzle), Dir = MathX.V3(c.Dir) }).ToArray(),
        };
        foreach (var t in data.Turrets)
            car.Turrets.Add(new Turret { Mount = MathX.V3(t.Position), Muzzles = t.Muzzles.Select(MathX.V3).ToArray() });
        var turretIndex = 0;
        // Target order matches TrainModels.js (the HUD lists ticks in this order).
        if (kind == CarKind.Armored)
        {
            var rand = new Rng(seed);
            var color = Palette.BlockColors[(int)MathF.Floor(rand.Next() * 4)];
            AddCube(car, new Vector3(0.45f, 2.25f + 0.4f, 0.5f), 0.8f, color, rand.Next() < 0.6f);
        }
        foreach (var t in data.Targets)
        {
            var target = new TrainTarget
            {
                Kind = t.Kind switch { "gem" => TargetKind.Gem, "turret" => TargetKind.Turret, _ => TargetKind.Hull },
                Box = new BoundingBox(MathX.V3(t.Min), MathX.V3(t.Max)),
                Hp = t.Hp < 0 ? float.PositiveInfinity : t.Hp,
                MaxHp = t.Hp < 0 ? float.PositiveInfinity : t.Hp,
            };
            if (target.Kind == TargetKind.Turret && turretIndex < car.Turrets.Count)
            {
                target.Turret = car.Turrets[turretIndex++];
                target.Turret.Target = target;
            }
            if (kind == CarKind.Cargo && target.Kind == TargetKind.Hull) BuildCargoStacks(car, seed, 0.6f);
            car.Targets.Add(target);
        }
        return car;
    }

    /// <summary>Flatcar stacks: 2 wide x 3 long, 1-3 high, mostly one colour (buildCargoWagon).</summary>
    private static void BuildCargoStacks(TrainCar car, uint seed, float stackChance)
    {
        var rand = new Rng(seed);
        const float s = 0.88f;
        var color = Palette.BlockColors[(int)MathF.Floor(rand.Next() * 4)];
        foreach (var x in new[] { -0.47f, 0.47f })
        {
            foreach (var z in new[] { -1.05f, 0f, 1.05f })
            {
                var layers = 1 + (rand.Next() < stackChance ? 1 : 0) + (rand.Next() < stackChance * 0.35f ? 1 : 0);
                var c = rand.Next() < 0.7f ? color : Palette.BlockColors[(int)MathF.Floor(rand.Next() * 4)];
                for (var l = 0; l < layers; l++)
                    AddCube(car, new Vector3(x, 1.0f + s * 0.5f + l * s, z), s, c, l == layers - 1 && rand.Next() < 0.55f);
            }
        }
    }

    private static void AddCube(TrainCar car, Vector3 center, float size, BlockColor color, bool snow)
    {
        var h = size / 2;
        car.Targets.Add(new TrainTarget
        {
            Kind = TargetKind.Cargo,
            Box = new BoundingBox(center - new Vector3(h), center + new Vector3(h)),
            Hp = 2, MaxHp = 2,
            Color = color, Snow = snow, Size = size,
            CubeYaw = (int)(Rng.Shared.Next() * 4) * MathHelper.PiOver2,
        });
    }
}

/// <summary>
/// Armored train (Train.js): rolls along the railway, fires its twin turrets at the helicopter,
/// lobs cannonballs from brass side cannons and carries cargo cubes. Its weak spot is the ruby
/// gem on the locomotive front, shielded until every turret is broken.
/// </summary>
public sealed class Train : IRenderable
{
    private readonly Effects _effects;
    private readonly TrainFactory _factory;
    private readonly List<(Matrix world, Vector3 vel, Vector3 spin, Vector3 rot, Vector3 pos, float scale, float life)> _wreckage = new();
    private readonly InstanceBuffer _cubes, _snowCaps;
    private readonly PointLight _gemLight;
    private readonly LightRig _lights;
    private float _smokeTimer, _cannonTimer = 1, _shieldTime, _shieldHit, _stopTimer;
    private float? _stopAtZ;
    private float _cruise, _rotationY;
    private bool _shieldVisible = true;
    private Matrix _groupWorld;

    public int Wave { get; }
    public List<TrainCar> Cars { get; } = new();
    public float BaseSpeed { get; }
    public float Speed;
    public int Dir { get; private set; } = 1;
    public int Lap { get; private set; } = 1;
    public float HeadZ;
    public float TotalLength { get; }
    public bool Destroyed { get; private set; }
    public bool Finished { get; private set; }
    public string Mode { get; private set; } = "NORMAL";
    public float Scale => GameConfig.Train.Scale;
    public float X => GameConfig.Track.X;
    public TrainCar Locomotive => Cars[0];
    public bool Stopped => _stopTimer > 0;

    // Events (Observer): the session reacts to fire, knocked cargo and destroyed parts.
    public Action<Vector3, Vector3> OnFire;
    public Action<Vector3, Vector3> OnCannonFire;
    public Func<Vector3, BlockColor, bool> OnCargoKnocked;
    public Action<TargetKind, Vector3> OnTargetDestroyed;
    public Action OnShieldDown;

    public Train(TrainFactory factory, Effects effects, LightRig lights, Microsoft.Xna.Framework.Graphics.GraphicsDevice device, int wave, uint seed)
    {
        _factory = factory;
        _effects = effects;
        _lights = lights;
        Wave = wave;
        BaseSpeed = GameConfig.Train.Speed * (1 + (wave - 1) * 0.08f);
        Speed = BaseSpeed;
        var pattern = new[] { CarKind.Armored, CarKind.Cargo, CarKind.Armored, CarKind.Cargo, CarKind.Cargo, CarKind.Armored, CarKind.Cargo };
        Cars.Add(factory.Build(CarKind.Locomotive, 0));
        var wagons = WagonsForWave(wave);
        for (var i = 0; i < wagons; i++)
        {
            var kind = pattern[i % pattern.Length];
            Cars.Add(factory.Build(kind, kind == CarKind.Armored ? seed * 31 + (uint)i : seed * 17 + (uint)i));
        }
        float offset = 0;
        foreach (var car in Cars)
        {
            car.OffsetZ = -offset - car.Length / 2;
            offset += car.Length + 0.35f;
        }
        TotalLength = offset * Scale;
        HeadZ = GameConfig.Track.StartZ + TotalLength;
        var cubes = Cars.Sum(c => c.Targets.Count(t => t.Kind == TargetKind.Cargo));
        _cubes = new InstanceBuffer(device, Math.Max(1, cubes), true);
        _snowCaps = new InstanceBuffer(device, Math.Max(1, cubes), true);
        _gemLight = new PointLight { Color = Palette.ToLinear(0xff0a1e), Intensity = 4, Distance = 5, Decay = 2 };
        lights.Points.Add(_gemLight);
        PlanTrip();
        UpdateTransforms();
    }

    /// <summary>Wagons behind the locomotive on a wave: one more every GrowEvery waves.</summary>
    public static int WagonsForWave(int wave) =>
        Math.Min(GameConfig.Train.MaxWagons, GameConfig.Train.WagonCount + (Math.Max(1, wave) - 1) / GameConfig.Train.GrowEvery);

    public float MinZ => Dir > 0 ? HeadZ - TotalLength : HeadZ;
    public float MaxZ => Dir > 0 ? HeadZ : HeadZ + TotalLength;

    /// <summary>Health of the persistent parts (gem + turrets), 0..1.</summary>
    public float Integrity
    {
        get
        {
            if (Destroyed) return 0;
            float hp = 0, max = 0;
            foreach (var car in Cars)
            foreach (var t in car.Targets)
            {
                if (t.Kind is TargetKind.Cargo or TargetKind.Hull) continue;
                max += t.MaxHp;
                hp += t.Alive ? MathF.Max(0, t.Hp) : 0;
            }
            return hp / MathF.Max(1, max);
        }
    }

    public bool GemShielded
    {
        get
        {
            if (Destroyed) return false;
            foreach (var c in Cars)
            foreach (var t in c.Turrets)
                if (t.Alive) return true;
            return false;
        }
    }

    /// <summary>The same train comes round again the other way, cargo reloaded, damage kept.</summary>
    public void RestartLap()
    {
        Lap++;
        Finished = false;
        Dir = -Dir;
        _rotationY = Dir > 0 ? 0 : MathF.PI;
        SetHeadZ(Dir > 0 ? GameConfig.Track.StartZ + TotalLength : GameConfig.Track.EndZ - TotalLength);
        PlanTrip();
        foreach (var car in Cars)
        foreach (var t in car.Targets)
        {
            if (t.Kind != TargetKind.Cargo) continue;
            t.Alive = true;
            t.Hp = t.MaxHp;
        }
    }

    /// <summary>Speed plan for this trip: FAST (never stops), NORMAL or SLOW (may halt once).</summary>
    private void PlanTrip()
    {
        var r = Rng.Shared.Next();
        Mode = r < GameConfig.Train.FastChance ? "FAST" : r < GameConfig.Train.FastChance + GameConfig.Train.SlowChance ? "SLOW" : "NORMAL";
        _cruise = BaseSpeed * (Mode == "FAST" ? GameConfig.Train.FastMul : Mode == "SLOW" ? GameConfig.Train.SlowMul : 1);
        Speed = _cruise;
        _stopTimer = 0;
        _stopAtZ = Mode != "FAST" && Rng.Shared.Next() < GameConfig.Train.StopChance
            ? GameConfig.Board.MinZ + 3 + Rng.Shared.Next() * (GameConfig.Board.MaxZ - GameConfig.Board.MinZ - 6)
            : null;
    }

    /// <summary>Poster mode: steady cruise at base speed, no halt.</summary>
    public void ForceCruise()
    {
        _cruise = Speed = BaseSpeed;
        _stopAtZ = null;
    }

    public void SetHeadZ(float z)
    {
        HeadZ = z;
        UpdateTransforms();
    }

    private void UpdateSpeed(float dt)
    {
        if (Destroyed)
        {
            _stopTimer = 0;
            Speed = MathF.Min(GameConfig.Train.WreckSpeed, MathF.Max(Speed, 2) + GameConfig.Train.WreckAccel * dt);
            return;
        }
        if (_stopTimer > 0)
        {
            _stopTimer -= dt;
            Speed = 0;
            return;
        }
        var target = _cruise;
        if (_stopAtZ.HasValue)
        {
            var ahead = (_stopAtZ.Value - HeadZ) * Dir;
            if (ahead < 0.05f)
            {
                _stopAtZ = null;
                _stopTimer = GameConfig.Train.StopDuration;
                Speed = 0;
                return;
            }
            target = MathF.Min(target, MathF.Sqrt(2 * 2.2f * ahead));
        }
        Speed += MathF.Sign(target - Speed) * MathF.Min(MathF.Abs(target - Speed), 2.4f * dt);
    }

    private void UpdateTransforms()
    {
        _groupWorld = Matrix.CreateScale(Scale) * Matrix.CreateRotationY(_rotationY) * Matrix.CreateTranslation(X, GameConfig.Track.RailTop - 0.05f, HeadZ);
        foreach (var car in Cars)
        {
            car.World = Matrix.CreateTranslation(0, 0, car.OffsetZ) * _groupWorld;
            car.InverseWorld = Matrix.Invert(car.World);
            foreach (var t in car.Turrets)
            {
                t.BaseWorld = Matrix.CreateTranslation(t.Mount) * car.World;
                t.HeadWorld = Matrix.CreateRotationY(t.Yaw) * Matrix.CreateTranslation(t.HeadOffset) * t.BaseWorld;
            }
        }
        _gemLight.Position = Locomotive.ToWorld(new Vector3(0, 1.4f, 2.9f));
    }

    public void Update(float dt, Vector3 heliPosition, bool heliAlive)
    {
        var rng = Rng.Shared;
        UpdateSpeed(dt);
        UpdateShield(dt);
        HeadZ += Dir * Speed * dt;
        UpdateTransforms();
        if (Dir > 0 ? MinZ > GameConfig.Track.EndZ : MaxZ < GameConfig.Track.StartZ) Finished = true;

        _smokeTimer -= dt;
        if (_smokeTimer <= 0)
        {
            _smokeTimer = Destroyed ? 0.03f : 0.035f;
            if (Destroyed)
            {
                var car = Cars[(int)(rng.Next() * Cars.Count)];
                var w = car.ToWorld(new Vector3((rng.Next() - 0.5f) * 1.6f, 2 + rng.Next(), (rng.Next() - 0.5f) * 3));
                _effects.Fire.Emit(new ParticleSpec { Position = w, Velocity = new Vector3(0, 2, 0), Life = 0.5f, Size0 = 1.2f, Size1 = 0.4f, Aspect = 1, Color0 = new Vector4(4, 1.8f, 0.4f, 1), Color1 = new Vector4(1.5f, 0.3f, 0.05f, 0), HasColor1 = true });
                _effects.ChimneySmoke(w, 0.8f);
            }
            foreach (var car in Cars)
            foreach (var c in car.Chimneys)
                if (rng.Next() < (car == Locomotive ? 0.9f : 0.55f)) _effects.ChimneySmoke(car.ToWorld(c), Destroyed ? 0.6f : 1);
        }

        if (!Destroyed) UpdateCannons(dt);
        UpdateTurrets(dt, heliPosition, heliAlive);
        UpdateWreckage(dt);
    }

    /// <summary>Brass under-cannons: a random cannon over the board fires straight along its barrel.</summary>
    private void UpdateCannons(float dt)
    {
        var rng = Rng.Shared;
        _cannonTimer -= dt;
        if (_cannonTimer > 0) return;
        _cannonTimer = GameConfig.Train.CannonIntervalMin + rng.Next() * (GameConfig.Train.CannonIntervalMax - GameConfig.Train.CannonIntervalMin);
        Span<(int car, int cannon)> options = stackalloc (int, int)[32];
        var n = 0;
        for (var ci = 0; ci < Cars.Count; ci++)
        {
            var car = Cars[ci];
            for (var k = 0; k < car.Cannons.Length && n < options.Length; k++)
            {
                var w = car.ToWorld(car.Cannons[k].Muzzle);
                if (w.Z > GameConfig.Board.MinZ - 3 && w.Z < GameConfig.Board.MaxZ + 1) options[n++] = (ci, k);
            }
        }
        if (n == 0) return;
        var pick = options[(int)(rng.Next() * n)];
        var pc = Cars[pick.car];
        var cannon = pc.Cannons[pick.cannon];
        var muzzle = pc.ToWorld(cannon.Muzzle);
        var aim = Vector3.Normalize(Vector3.TransformNormal(cannon.Dir, pc.World));
        OnCannonFire?.Invoke(muzzle, aim);
        _effects.MuzzleFlash(muzzle, aim, new Vector4(5, 2.6f, 0.8f, 1), 1.4f);
        _effects.FlashLight(muzzle, 0xffa040, 18, 0.15f, 6);
        for (var i = 0; i < 5; i++)
        {
            _effects.Smoke.Emit(new ParticleSpec
            {
                Position = muzzle, Velocity = new Vector3(aim.X * 3 + (rng.Next() - 0.5f), 0.8f + rng.Next(), aim.Z * 3 + (rng.Next() - 0.5f)), Drag = 1.5f,
                Life = 1.0f, Size0 = 0.4f, Size1 = 1.6f, Aspect = 1, Color0 = new Vector4(0.85f, 0.85f, 0.87f, 0.7f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true,
            });
        }
    }

    /// <summary>Turrets track the helicopter; each volley fires both barrels along the barrels.</summary>
    private void UpdateTurrets(float dt, Vector3 heliPosition, bool heliAlive)
    {
        var rng = Rng.Shared;
        foreach (var car in Cars)
        foreach (var turret in car.Turrets)
        {
            if (!turret.Alive || Destroyed) continue;
            var world = turret.BaseWorld.Translation;
            var aim = heliPosition - world;
            var desired = MathF.Atan2(aim.X, aim.Z) - _rotationY;
            turret.Yaw = MathX.LerpAngle(turret.Yaw, desired, MathX.Damp(5, dt));
            turret.Cooldown -= dt;
            TurretDamageFx(turret, world, dt);
            var inBoard = world.Z > GameConfig.Board.MinZ - 4 && world.Z < GameConfig.Board.MaxZ;
            var facing = MathF.Abs(MathX.WrapAngle(desired - turret.Yaw)) < 0.4f;
            turret.HeadWorld = Matrix.CreateRotationY(turret.Yaw) * Matrix.CreateTranslation(turret.HeadOffset) * turret.BaseWorld;
            if (turret.Cooldown <= 0 && heliAlive && inBoard && facing && aim.Length() < 26)
            {
                var rage = Stopped ? GameConfig.Train.StoppedFireMul : 1;
                turret.Cooldown = GameConfig.Train.TurretFireInterval * rage * (0.75f + rng.Next() * 0.5f) / (1 + (Wave - 1) * 0.1f);
                var barrel = Vector3.Normalize(Vector3.TransformNormal(Vector3.UnitZ, turret.HeadWorld));
                var flat = MathF.Sqrt(aim.X * aim.X + aim.Z * aim.Z);
                if (flat < 1e-4f) flat = 1;
                foreach (var m in turret.Muzzles)
                {
                    var muzzle = Vector3.Transform(m, turret.HeadWorld);
                    var d = new Vector3(barrel.X, 0, barrel.Z);
                    if (d.LengthSquared() > 1e-8f) d.Normalize();
                    d.Y = (heliPosition.Y - muzzle.Y) / flat;
                    OnFire?.Invoke(muzzle, Vector3.Normalize(d));
                }
                turret.Recoil = 1;
            }
            if (turret.Recoil > 0)
            {
                turret.Recoil = MathF.Max(0, turret.Recoil - dt * 6);
                var r = -turret.Recoil * 0.12f;
                turret.HeadOffset = new Vector3(MathF.Sin(turret.Yaw) * r, 0, MathF.Cos(turret.Yaw) * r);
            }
        }
    }

    private void TurretDamageFx(Turret turret, Vector3 at, float dt)
    {
        var t = turret.Target;
        if (t == null || t.Hp >= t.MaxHp * 0.7f) return;
        turret.SmokeTimer -= dt;
        if (turret.SmokeTimer > 0) return;
        var heavy = t.Hp < t.MaxHp * 0.35f;
        turret.SmokeTimer = heavy ? 0.05f : 0.12f;
        var rng = Rng.Shared;
        _effects.Smoke.Emit(new ParticleSpec
        {
            Position = new Vector3(at.X + (rng.Next() - 0.5f) * 0.6f, at.Y + 1.1f, at.Z + (rng.Next() - 0.5f) * 0.6f), Velocity = new Vector3(0, 1.4f, 0), Drag = 0.8f,
            Life = 1.1f, Size0 = 0.4f, Size1 = heavy ? 1.6f : 1.1f, Aspect = 1,
            Color0 = new Vector4(0.08f, 0.08f, 0.09f, heavy ? 0.8f : 0.5f), Color1 = new Vector4(0.3f, 0.3f, 0.32f, 0), HasColor1 = true,
        });
        if (heavy && rng.Next() < 0.3f) _effects.SparkBurst(at + new Vector3(0, 1, 0), 3, 3);
    }

    /// <summary>The gun head is torn off and tumbles away; chunks scatter around the base.</summary>
    private void BreakTurret(Turret turret)
    {
        turret.Alive = false;
        var world = turret.HeadWorld.Translation;
        _effects.Explosion(world, 1.2f, 0x3a3d42, 14);
        _effects.Shatter(world, 0x55595f, 16, 1.4f, 0.14f, 0.34f);
        _effects.Shatter(world, 0x2a2b2e, 10, 1.1f, 0.1f, 0.24f);
        _effects.FlashLight(world, 0xffa040, 40, 0.3f, 9);
        var rng = Rng.Shared;
        var side = rng.Next() < 0.5f ? -1 : 1;
        // Decompose the head transform into position + Euler so it can tumble.
        _wreckage.Add((turret.HeadWorld,
            new Vector3(side * (2 + rng.Next() * 2), 5 + rng.Next() * 2, Dir * Speed + (rng.Next() - 0.5f) * 2),
            new Vector3((rng.Next() - 0.5f) * 9, (rng.Next() - 0.5f) * 7, (rng.Next() - 0.5f) * 9),
            Vector3.Zero, world, 1, 0));
        turret.BurnTimer = 6;
    }

    private void UpdateWreckage(float dt)
    {
        var rng = Rng.Shared;
        for (var i = _wreckage.Count - 1; i >= 0; i--)
        {
            var w = _wreckage[i];
            w.life += dt;
            w.vel.Y -= 14 * dt;
            w.pos += w.vel * dt;
            w.rot += w.spin * dt;
            if (w.pos.Y < 0.15f && w.vel.Y < 0)
            {
                w.pos.Y = 0.15f;
                w.vel.Y *= -0.35f;
                w.vel.X *= 0.5f;
                w.vel.Z *= 0.5f;
                w.spin *= 0.5f;
                if (MathF.Abs(w.vel.Y) > 1) _effects.SnowPuff(w.pos, 5);
            }
            if (rng.Next() < dt * 14)
            {
                _effects.Smoke.Emit(new ParticleSpec
                {
                    Position = w.pos + new Vector3(0, 0.3f, 0), Velocity = new Vector3(0, 1.2f, 0), Drag = 0.8f, Life = 1.0f, Size0 = 0.4f, Size1 = 1.3f, Aspect = 1,
                    Color0 = new Vector4(0.07f, 0.07f, 0.08f, 0.7f), Color1 = new Vector4(0.3f, 0.3f, 0.32f, 0), HasColor1 = true,
                });
            }
            if (w.life > 3.5f) w.scale *= MathF.Exp(-2.2f * dt);
            if (w.life > 5) _wreckage.RemoveAt(i);
            else _wreckage[i] = w;
        }
        foreach (var car in Cars)
        foreach (var turret in car.Turrets)
        {
            if (turret.Alive || turret.BurnTimer <= 0) continue;
            turret.BurnTimer -= dt;
            if (rng.Next() < dt * 10)
            {
                var p = turret.BaseWorld.Translation;
                _effects.Fire.Emit(new ParticleSpec { Position = p + new Vector3(0, 0.4f, 0), Velocity = new Vector3(0, 1.6f, 0), Life = 0.4f, Size0 = 0.8f, Size1 = 0.3f, Aspect = 1, Color0 = new Vector4(4, 1.8f, 0.4f, 1), Color1 = new Vector4(1.5f, 0.3f, 0.05f, 0), HasColor1 = true });
                _effects.Smoke.Emit(new ParticleSpec { Position = p + new Vector3(0, 0.6f, 0), Velocity = new Vector3(0, 1.5f, 0), Drag = 0.7f, Life = 1.2f, Size0 = 0.5f, Size1 = 1.5f, Aspect = 1, Color0 = new Vector4(0.08f, 0.08f, 0.09f, 0.7f), Color1 = new Vector4(0.3f, 0.3f, 0.32f, 0), HasColor1 = true });
            }
        }
    }

    /// <summary>Point hit test against every live target (car-local boxes, forgiving in Y).</summary>
    public (TrainCar car, TrainTarget target)? HitTest(Vector3 point, bool exact)
    {
        if (point.Z > MaxZ + 3.5f || point.Z < MinZ - 3.5f) return null;
        if (MathF.Abs(point.X - X) > 1.6f * Scale) return null;
        foreach (var car in Cars)
        {
            var local = Vector3.Transform(point, car.InverseWorld);
            foreach (var target in car.Targets)
            {
                if (!target.Alive) continue;
                if (exact && target.Kind == TargetKind.Hull) continue;
                var b = target.Box;
                var below = exact ? 0.2f : target.Kind == TargetKind.Turret ? 3.2f : 0.5f;
                if (local.X >= b.Min.X && local.X <= b.Max.X && local.Z >= b.Min.Z && local.Z <= b.Max.Z
                    && local.Y <= b.Max.Y + (exact ? 0.2f : 1.6f) && local.Y >= b.Min.Y - below)
                    return (car, target);
            }
        }
        return null;
    }

    /// <summary>Applies damage to a part; returns the destroyed kind, if any.</summary>
    public TargetKind? Damage(TrainCar car, TrainTarget target, float amount, Vector3 hitPoint)
    {
        if (target.Kind == TargetKind.Hull)
        {
            _effects.Impact(hitPoint, new Vector4(3, 3.2f, 3.6f, 1));
            return null;
        }
        if (target.Kind == TargetKind.Gem && GemShielded)
        {
            amount *= GameConfig.Train.GemShieldMul;
            _shieldHit = 1;
            _effects.Impact(hitPoint, new Vector4(0.8f, 2.4f, 5, 1));
            _effects.SparkBurst(hitPoint, 3, 4, new Vector4(1, 2.6f, 5, 1));
        }
        target.Hp -= amount;
        if (target.Kind == TargetKind.Gem)
        {
            _effects.Impact(hitPoint, new Vector4(5, 0.8f, 0.5f, 1));
            _effects.FlashLight(hitPoint, 0xff2010, 25, 0.12f, 6);
        }
        else if (target.Kind == TargetKind.Turret)
        {
            _effects.Impact(hitPoint, new Vector4(4, 3, 2, 1));
            if (Rng.Shared.Next() < 0.35f) _effects.SparkBurst(hitPoint, 4, 4);
        }
        else
        {
            _effects.Impact(hitPoint);
        }
        if (target.Hp > 0) return null;

        target.Alive = false;
        var world = car.ToWorld(target.Center);
        if (target.Kind == TargetKind.Cargo)
        {
            _effects.Impact(world);
            if (OnCargoKnocked == null || !OnCargoKnocked(world, target.Color))
            {
                _effects.Explosion(world, 0.7f);
                _effects.Shatter(world, PackedColor(target.Color), 14, 1.1f);
            }
        }
        else if (target.Kind == TargetKind.Turret)
        {
            BreakTurret(target.Turret);
            if (!GemShielded) BreakShield();
        }
        else if (target.Kind == TargetKind.Gem)
        {
            _gemLight.Intensity = 0;
            Destroy();
        }
        OnTargetDestroyed?.Invoke(target.Kind, world);
        return target.Kind;
    }

    public static uint PackedColor(BlockColor c)
    {
        var col = Palette.Block(c);
        return (uint)(col.R << 16 | col.G << 8 | col.B);
    }

    private void Destroy()
    {
        if (Destroyed) return;
        Destroyed = true;
        foreach (var car in Cars)
        {
            var w = car.World.Translation + new Vector3(0, 1.5f, 0);
            _effects.Explosion(w, 1.6f, 0x4c5056, 18);
            foreach (var t in car.Targets)
            {
                if (t.Kind != TargetKind.Cargo || !t.Alive) continue;
                t.Alive = false;
                _effects.Shatter(car.ToWorld(t.Center), PackedColor(t.Color), 8, 1.4f);
            }
            foreach (var turret in car.Turrets) turret.Alive = false;
        }
        _shieldVisible = false;
    }

    private void BreakShield()
    {
        if (!_shieldVisible) return;
        _shieldVisible = false;
        var w = Locomotive.ToWorld(new Vector3(0, 1.5f, 2.55f));
        _effects.Shatter(w, 0x7fd8ff, 22, 1.3f, 0.1f, 0.26f);
        _effects.FlashLight(w, 0x60c8ff, 50, 0.4f, 10);
        _effects.SparkBurst(w, 30, 7, new Vector4(1, 2.6f, 5, 1));
        OnShieldDown?.Invoke();
    }

    private void UpdateShield(float dt)
    {
        if (!_shieldVisible) return;
        _shieldTime += dt;
        _shieldHit = MathF.Max(0, _shieldHit - dt * 3);
    }

    public void Submit(RenderQueue queue)
    {
        _cubes.Count = 0;
        _snowCaps.Count = 0;
        foreach (var car in Cars)
        {
            queue.Add(car.Body, car.World);
            foreach (var t in car.Turrets)
            {
                queue.Add(_factory.TurretBase, t.BaseWorld);
                if (t.Alive) queue.Add(_factory.TurretHead, t.HeadWorld);
            }
            foreach (var t in car.Targets)
            {
                if (t.Kind != TargetKind.Cargo || !t.Alive) continue;
                var m = Matrix.CreateScale(t.Size) * Matrix.CreateRotationY(t.CubeYaw) * Matrix.CreateTranslation(t.Center) * car.World;
                _cubes.Add(m, new Vector4(TrainFactory.BlockLinear(t.Color), 1));
                if (t.Snow) _snowCaps.Add(m, Vector4.One);
            }
        }
        _cubes.Upload();
        _snowCaps.Upload();
        queue.Add(_factory.CargoCube, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _cubes, _factory.CubeMaterial);
        queue.Add(_factory.CargoSnow, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _snowCaps);
        foreach (var w in _wreckage)
        {
            var m = Matrix.CreateScale(w.scale) * MathX.RotationXYZ(w.rot.X, w.rot.Y, w.rot.Z) * WithTranslation(w.world, w.pos);
            queue.Add(_factory.TurretHead, m);
        }
        if (_shieldVisible && !Destroyed)
        {
            var pulse = 1 + MathF.Sin(_shieldTime * 2.2f) * 0.03f + _shieldHit * 0.06f;
            var opacity = 0.16f + MathF.Sin(_shieldTime * 3) * 0.04f + _shieldHit * 0.45f;
            var world = Matrix.CreateScale(pulse) * Matrix.CreateTranslation(0, 1.5f, 2.55f) * Locomotive.World;
            queue.Add(_factory.Shield, world, new DrawOverrides { ColorMul = new Vector4(1, 1, 1, opacity / 0.2f) }, false, 12);
        }
    }

    private static Matrix WithTranslation(Matrix m, Vector3 t)
    {
        m.Translation = t;
        return m;
    }

    public void Dispose()
    {
        _lights.Points.Remove(_gemLight);
        _cubes.Dispose();
        _snowCaps.Dispose();
    }
}
