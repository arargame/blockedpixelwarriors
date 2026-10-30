using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

public enum TargetKind { Gem, Turret, Hull, Cargo, Crane }

/// <summary>A destructible part of a train car (car-local box).</summary>
public sealed class TrainTarget
{
    public TargetKind Kind;
    public BoundingBox Box;
    public float Hp, MaxHp;
    public bool Alive = true;
    public Turret Turret;
    public Crane Crane;
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

/// <summary>
/// BLOCK HAULER crane: the slewing part (cab + lattice boom) swings from side to side, the
/// wrecking ball hangs from the boom tip on a chain and swings as a pendulum in world space.
/// </summary>
public sealed class Crane
{
    public Vector3 Pivot, Tip;
    public float Yaw, Tilt, Phase, Amp, Speed, Time;
    public bool Alive = true;
    public TrainTarget Target;
    public bool Placed;
    public Vector3 Pos, Prev, Dir = -Vector3.UnitY, Center, TipWorld;
    public float DropTime, BurnTimer, BallScale = 1;
    public Matrix SlewWorld;
}

public enum CarKind { Locomotive, Armored, Cargo, Hauler }

public sealed class TrainCar
{
    public CarKind Kind;
    public GpuMesh Body;
    public float Length, OffsetZ;
    public Vector3[] Chimneys;
    public Cannon[] Cannons;
    public List<Turret> Turrets = new();
    public List<TrainTarget> Targets = new();
    public List<Crane> Cranes = new();
    /// <summary>Hauler locomotive: the furnace-eye weak point (car space).</summary>
    public Vector3? Core;
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
    public GpuMesh CraneSlew { get; }
    public GpuMesh Chain { get; }
    public GpuMesh Ball { get; }
    public bool HasHauler => _prefabs.Hauler is { Count: > 0 };

    /// <summary>Stage-2 train order (HaulerModels.js HAULER_ORDER).</summary>
    public static readonly string[] HaulerOrder = { "HaulerLoco", "HaulerHopper", "HaulerCrane", "HaulerCage", "HaulerHopper", "HaulerCrane", "HaulerOre" };

    public TrainFactory(ModelLibrary models, PrefabData prefabs)
    {
        _models = models;
        _prefabs = prefabs;
        if (HasHauler)
        {
            CraneSlew = models.Mesh("hauler_crane_slew");
            Chain = models.Mesh("hauler_chain");
            Ball = models.Mesh("hauler_ball");
        }
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

    /// <summary>
    /// The BLOCK HAULER's cars (HaulerModelFactory.buildTrain): one mulberry32 stream drives the
    /// hopper cube stacks and the crane swing phases, in the same order as the web build.
    /// </summary>
    public List<TrainCar> BuildHauler(uint seed)
    {
        var rand = new Rng(seed * 977 + 13);
        var cars = new List<TrainCar>();
        foreach (var name in HaulerOrder)
        {
            var data = _prefabs.Hauler[name];
            var car = new TrainCar
            {
                Kind = CarKind.Hauler,
                Body = _models.Mesh(data.Model),
                Length = data.Length,
                Chimneys = (data.Chimneys ?? new()).Select(MathX.V3).ToArray(),
                Cannons = Array.Empty<Cannon>(),
                Core = data.Core != null ? MathX.V3(data.Core) : null,
            };
            foreach (var t in data.Turrets ?? new())
                car.Turrets.Add(new Turret { Mount = MathX.V3(t.Position), Muzzles = t.Muzzles.Select(MathX.V3).ToArray() });
            if (name == "HaulerHopper" && data.Deck != null)
            {
                const float s = 0.88f;
                var deckY = data.Deck[1];
                var color = Palette.BlockColors[(int)MathF.Floor(rand.Next() * 4)];
                foreach (var x in new[] { -0.47f, 0.47f })
                foreach (var z in new[] { -1.5f, -0.5f, 0.5f, 1.5f })
                {
                    var layers = 1 + (rand.Next() < 0.55f ? 1 : 0);
                    var k = rand.Next() < 0.6f ? color : Palette.BlockColors[(int)MathF.Floor(rand.Next() * 4)];
                    for (var l = 0; l < layers; l++)
                        AddCube(car, new Vector3(x, deckY + s * 0.5f + l * s, z), s, k, l == layers - 1 && rand.Next() < 0.4f);
                }
            }
            Crane crane = null;
            if (data.Crane != null)
            {
                crane = new Crane
                {
                    Pivot = MathX.V3(data.Crane.Pivot), Tip = MathX.V3(data.Crane.Tip),
                    Phase = rand.Next() * MathF.PI * 2, Amp = 1.25f + rand.Next() * 0.2f, Speed = 0.5f + rand.Next() * 0.15f,
                };
                car.Cranes.Add(crane);
            }
            var turretIndex = 0;
            foreach (var t in data.Targets)
            {
                var target = new TrainTarget
                {
                    Kind = t.Kind switch { "gem" => TargetKind.Gem, "turret" => TargetKind.Turret, "crane" => TargetKind.Crane, _ => TargetKind.Hull },
                    Box = new BoundingBox(MathX.V3(t.Min), MathX.V3(t.Max)),
                    Hp = t.Hp < 0 ? float.PositiveInfinity : t.Hp,
                    MaxHp = t.Hp < 0 ? float.PositiveInfinity : t.Hp,
                };
                if (target.Kind == TargetKind.Turret && turretIndex < car.Turrets.Count)
                {
                    target.Turret = car.Turrets[turretIndex++];
                    target.Turret.Target = target;
                }
                if (target.Kind == TargetKind.Crane && crane != null)
                {
                    target.Crane = crane;
                    crane.Target = target;
                }
                car.Targets.Add(target);
            }
            cars.Add(car);
        }
        return cars;
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
    private readonly float _pathStart, _pathEnd, _arenaMinZ, _arenaMaxZ;
    private readonly Vector3 _core;
    private bool _hauler, _reversing;

    public int Wave { get; }
    /// <summary>"ARMORED TRAIN" or "BLOCK HAULER" (HUD panel / kill feed).</summary>
    public string Title => _hauler ? "BLOCK HAULER" : "ARMORED TRAIN";
    public bool IsHauler => _hauler;
    /// <summary>Stage cleared: no more fire / ramming, it leaves the line at speed.</summary>
    public bool Departing { get; private set; }
    /// <summary>A swinging wrecking ball touched the helicopter (ball centre).</summary>
    public Action<Vector3> OnBallHit;
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

    public Train(TrainFactory factory, Effects effects, LightRig lights, Microsoft.Xna.Framework.Graphics.GraphicsDevice device, int wave, uint seed, bool hauler = false)
    {
        _factory = factory;
        _effects = effects;
        _lights = lights;
        Wave = wave;
        _hauler = hauler && factory.HasHauler;
        // Line + platform: stage 1 board, or the stage-2 terrace with the hauler's long approach.
        _pathStart = _hauler ? GameConfig.Stages.HaulerStartZ : GameConfig.Track.StartZ;
        _pathEnd = _hauler ? GameConfig.Stages.HaulerEndZ : GameConfig.Track.EndZ;
        _arenaMinZ = _hauler ? GameConfig.Stages.TerraceMinZ : GameConfig.Board.MinZ;
        _arenaMaxZ = _hauler ? GameConfig.Stages.TerraceMaxZ : GameConfig.Board.MaxZ;
        BaseSpeed = GameConfig.Train.Speed * (1 + (wave - 1) * 0.08f);
        Speed = BaseSpeed;
        if (_hauler)
        {
            Cars.AddRange(factory.BuildHauler(seed));
        }
        else
        {
            var pattern = new[] { CarKind.Armored, CarKind.Cargo, CarKind.Armored, CarKind.Cargo, CarKind.Cargo, CarKind.Armored, CarKind.Cargo };
            Cars.Add(factory.Build(CarKind.Locomotive, 0));
            var wagons = WagonsForWave(wave);
            for (var i = 0; i < wagons; i++)
            {
                var kind = pattern[i % pattern.Length];
                Cars.Add(factory.Build(kind, kind == CarKind.Armored ? seed * 31 + (uint)i : seed * 17 + (uint)i));
            }
        }
        _core = Locomotive.Core ?? new Vector3(0, 1.5f, 2.55f);
        float offset = 0;
        foreach (var car in Cars)
        {
            car.OffsetZ = -offset - car.Length / 2;
            offset += car.Length + 0.35f;
        }
        TotalLength = offset * Scale;
        HeadZ = _pathStart + TotalLength;
        var cubes = Cars.Sum(c => c.Targets.Count(t => t.Kind == TargetKind.Cargo));
        _cubes = new InstanceBuffer(device, Math.Max(1, cubes), true);
        _snowCaps = new InstanceBuffer(device, Math.Max(1, cubes), true);
        _gemLight = new PointLight { Color = Palette.ToLinear(_hauler ? 0xff7a20u : 0xff0a1eu), Intensity = 4, Distance = 5, Decay = 2 };
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
            {
                foreach (var t in c.Turrets)
                    if (t.Alive) return true;
                foreach (var k in c.Cranes)
                    if (k.Alive) return true;
            }
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
        SetHeadZ(Dir > 0 ? _pathStart + TotalLength : _pathEnd - TotalLength);
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
            ? _arenaMinZ + 3 + Rng.Shared.Next() * (_arenaMaxZ - _arenaMinZ - 6)
            : null;
    }

    /// <summary>Poster mode: steady cruise at base speed, no halt.</summary>
    public void ForceCruise()
    {
        _cruise = Speed = BaseSpeed;
        _stopAtZ = null;
    }

    /// <summary>Stage clear: stop shooting and leave the line at speed (no restart).</summary>
    public void Depart()
    {
        Departing = true;
        _reversing = Dir < 0;
        _stopAtZ = null;
        _stopTimer = 0;
    }

    public void SetHeadZ(float z)
    {
        HeadZ = z;
        UpdateTransforms();
    }

    private void UpdateSpeed(float dt)
    {
        if (Destroyed || Departing)
        {
            _stopTimer = 0;
            // A departing train (stage clear) clears the line twice as fast.
            var top = GameConfig.Train.WreckSpeed * (Departing ? 1.8f : 1);
            Speed = MathF.Min(top, MathF.Max(Speed, 2) + GameConfig.Train.WreckAccel * (Departing ? 2 : 1) * dt);
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
        _gemLight.Position = Locomotive.ToWorld(_hauler ? new Vector3(0, _core.Y, _core.Z + 0.4f) : new Vector3(0, 1.4f, 2.9f));
        foreach (var car in Cars)
        foreach (var c in car.Cranes)
        {
            c.SlewWorld = MathX.RotationXYZ(0, c.Yaw, c.Tilt) * Matrix.CreateTranslation(c.Pivot) * car.World;
            c.TipWorld = Vector3.Transform(c.Tip, c.SlewWorld);
        }
    }

    public void Update(float dt, Vector3 heliPosition, bool heliAlive)
    {
        var rng = Rng.Shared;
        UpdateSpeed(dt);
        UpdateShield(dt);
        // A departing train that was heading up the line backs out the way it came instead.
        var move = Dir * (_reversing ? -1 : 1);
        HeadZ += move * Speed * dt;
        UpdateTransforms();
        if (move > 0 ? MinZ > _pathEnd : MaxZ < _pathStart) Finished = true;

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
            foreach (var c in Departing ? Array.Empty<Vector3>() : car.Chimneys)
                if (rng.Next() < (car == Locomotive ? 0.9f : 0.55f)) _effects.ChimneySmoke(car.ToWorld(c), Destroyed ? 0.6f : 1);
        }

        if (!Destroyed) UpdateCannons(dt);
        UpdateTurrets(dt, heliPosition, heliAlive);
        UpdateWreckage(dt);
        UpdateCranes(dt, heliPosition, heliAlive);
    }

    private float ChainWorld => GameConfig.Stages.ChainLength * Scale;

    /// <summary>
    /// Cranes slew from side to side over the balconies; the wrecking ball hangs on its chain as a
    /// position-based pendulum (Verlet step, then the chain-length constraint). Touching the heli
    /// raises OnBallHit. A wrecked crane drops its ball, which bounces and sinks away.
    /// </summary>
    private void UpdateCranes(float dt, Vector3 heliPosition, bool heliAlive)
    {
        var len = ChainWorld;
        var ballR = 0.46f * Scale;
        var reach = 0.2f * Scale + ballR;
        var rng = Rng.Shared;
        foreach (var car in Cars)
        foreach (var c in car.Cranes)
        {
            c.Time += dt;
            if (c.Alive && !Destroyed) c.Yaw = MathF.Sin(c.Time * c.Speed + c.Phase) * c.Amp;
            if (!c.Alive && c.BurnTimer > 0)
            {
                c.BurnTimer -= dt;
                if (rng.Next() < dt * 9)
                {
                    var p = c.SlewWorld.Translation;
                    _effects.Smoke.Emit(new ParticleSpec { Position = p + new Vector3(0, 1.6f, 0), Velocity = new Vector3(0, 1.5f, 0), Drag = 0.7f, Life = 1.3f, Size0 = 0.5f, Size1 = 1.7f, Aspect = 1, Color0 = new Vector4(0.08f, 0.08f, 0.09f, 0.7f), Color1 = new Vector4(0.3f, 0.3f, 0.32f, 0), HasColor1 = true });
                    _effects.Fire.Emit(new ParticleSpec { Position = p + new Vector3(0, 1.2f, 0), Velocity = new Vector3(0, 1.6f, 0), Life = 0.4f, Size0 = 0.8f, Size1 = 0.3f, Aspect = 1, Color0 = new Vector4(4, 1.8f, 0.4f, 1), Color1 = new Vector4(1.5f, 0.3f, 0.05f, 0), HasColor1 = true });
                }
            }
            c.SlewWorld = MathX.RotationXYZ(0, c.Yaw, c.Tilt) * Matrix.CreateTranslation(c.Pivot) * car.World;
            c.TipWorld = Vector3.Transform(c.Tip, c.SlewWorld);
            if (!c.Placed)
            {
                c.Placed = true;
                c.Pos = c.TipWorld - Vector3.UnitY * len;
                c.Prev = c.Pos;
            }
            var vel = (c.Pos - c.Prev) * 0.995f;
            c.Prev = c.Pos;
            c.Pos += vel;
            c.Pos.Y -= 18 * dt * dt;
            if (c.Alive)
            {
                var d = c.Pos - c.TipWorld;
                var l = d.Length();
                if (l < 1e-5f) l = 1;
                c.Dir = d / l;
                c.Pos = c.TipWorld + c.Dir * len;
            }
            else
            {
                c.Dir = -Vector3.UnitY;
                if (c.Pos.Y < reach && c.Prev.Y >= c.Pos.Y)
                {
                    var vy = c.Pos.Y - c.Prev.Y;
                    c.Pos.Y = reach;
                    c.Prev.Y = reach + vy * 0.35f;
                    if (MathF.Abs(vy) > 0.02f) _effects.SnowPuff(c.Pos, 8);
                }
                c.DropTime += dt;
                if (c.DropTime > 4) c.BallScale *= MathF.Exp(-3 * dt);
            }
            c.Center = c.Pos + c.Dir * reach;
            if (c.Alive && heliAlive && !Departing)
            {
                var hit = ballR + 0.9f;
                if (Vector3.DistanceSquared(c.Center, heliPosition) < hit * hit) OnBallHit?.Invoke(c.Center);
            }
        }
    }

    /// <summary>Crane cab shot to pieces: the boom stops, smoke pours out, the ball drops.</summary>
    private void BreakCrane(Crane crane)
    {
        crane.Alive = false;
        var w = crane.SlewWorld.Translation + new Vector3(0, 1.2f, 0);
        _effects.Explosion(w, 1.3f, 0xd8a020, 14);
        _effects.Shatter(w, 0xf0b21c, 14, 1.3f, 0.12f, 0.3f);
        _effects.FlashLight(w, 0xffa040, 40, 0.3f, 9);
        crane.Tilt = 0.12f;
        crane.BurnTimer = 8;
    }

    /// <summary>Rotation that turns the chain's -Y axis onto <paramref name="dir"/>.</summary>
    private static Matrix HangRotation(Vector3 dir)
    {
        var from = -Vector3.UnitY;
        var dot = MathHelper.Clamp(Vector3.Dot(from, dir), -1, 1);
        if (dot > 0.99999f) return Matrix.Identity;
        if (dot < -0.99999f) return Matrix.CreateRotationX(MathF.PI);
        var axis = Vector3.Normalize(Vector3.Cross(from, dir));
        return Matrix.CreateFromAxisAngle(axis, MathF.Acos(dot));
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
                if (!Departing && w.Z > _arenaMinZ - 3 && w.Z < _arenaMaxZ + 1) options[n++] = (ci, k);
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
            var inBoard = !Departing && world.Z > _arenaMinZ - 4 && world.Z < _arenaMaxZ;
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
        else if (target.Kind is TargetKind.Turret or TargetKind.Crane)
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
        else if (target.Kind == TargetKind.Crane)
        {
            BreakCrane(target.Crane);
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
            foreach (var c in car.Cranes)
                if (c.Alive) BreakCrane(c);
        }
        _shieldVisible = false;
    }

    private void BreakShield()
    {
        if (!_shieldVisible) return;
        _shieldVisible = false;
        var w = Locomotive.ToWorld(ShieldCenter);
        _effects.Shatter(w, 0x7fd8ff, 22, 1.3f, 0.1f, 0.26f);
        _effects.FlashLight(w, 0x60c8ff, 50, 0.4f, 10);
        _effects.SparkBurst(w, 30, 7, new Vector4(1, 2.6f, 5, 1));
        OnShieldDown?.Invoke();
    }

    private Vector3 ShieldCenter => _hauler ? new Vector3(0, _core.Y, _core.Z + 0.05f) : new Vector3(0, 1.5f, 2.55f);

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
        foreach (var car in Cars)
        foreach (var c in car.Cranes)
        {
            queue.Add(_factory.CraneSlew, c.SlewWorld);
            if (c.BallScale < 0.02f) continue;
            var hang = HangRotation(c.Dir);
            if (c.Alive) queue.Add(_factory.Chain, Matrix.CreateScale(Scale, ChainWorld, Scale) * hang * Matrix.CreateTranslation(c.TipWorld));
            queue.Add(_factory.Ball, Matrix.CreateScale(Scale * c.BallScale) * hang * Matrix.CreateTranslation(c.Pos));
        }
        foreach (var w in _wreckage)
        {
            var m = Matrix.CreateScale(w.scale) * MathX.RotationXYZ(w.rot.X, w.rot.Y, w.rot.Z) * WithTranslation(w.world, w.pos);
            queue.Add(_factory.TurretHead, m);
        }
        if (_shieldVisible && !Destroyed)
        {
            var pulse = 1 + MathF.Sin(_shieldTime * 2.2f) * 0.03f + _shieldHit * 0.06f;
            var opacity = 0.16f + MathF.Sin(_shieldTime * 3) * 0.04f + _shieldHit * 0.45f;
            var world = Matrix.CreateScale(pulse) * Matrix.CreateTranslation(ShieldCenter) * Locomotive.World;
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
