using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Audio;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;

namespace BlockedPixelWarriors.Gameplay;

public enum TankLevelState { Playing, Won, Lost }

/// <summary>
/// Tank level (src/tank/TankLevel.js + PlayerTank.js), menu card IRON TRACKS, phase 1 "the
/// channel". The tank drives in a sloped concrete channel with shallow flowing water. Trains cross
/// the rail at the far end and drop blocks into the lanes; the blocks slide down toward the dam
/// (pushing each other and the tank) and whatever gets past the lip tumbles into the oval drain
/// and piles up there (physics).
///   1000 blocks come in phase 1: break 900. 100 blocks in the drain loses.
///   Same-coloured neighbours chain-explode; weak / normal / strong (caged) / supply (star) blocks.
///   Supplies: T triple shells, D rapid fire, R heavy shells (splash), H drain pump (-10 blocks).
/// W/S drive, A/D turn, the mouse aims the turret, click / SPACE fires, ENTER restarts a finished
/// phase. Phones: the left stick drives, a tap aims and fires. Own camera, lights and effects.
/// </summary>
public sealed class TankLevel
{
    private const float Gravity = 18, TankR = 2.25f;
    private static readonly Dictionary<SupplyType, string> PowerNames = new()
    {
        [SupplyType.T] = "TRIPLE SHELLS", [SupplyType.D] = "RAPID FIRE", [SupplyType.R] = "HEAVY SHELLS", [SupplyType.H] = "DRAIN PUMP -10", [SupplyType.G] = "RAPID FIRE",
    };

    private readonly GpuMesh _hull, _turret, _barrel, _link, _arena, _shellMesh;
    private readonly List<InstancedModel> _arenaSets = new();
    private readonly Matrix _turretBase, _barrelBase;
    private readonly Vector3 _barrelAxis, _muzzleLocal;
    private readonly TankTrackData _track;
    private readonly InstanceBuffer _links;
    private readonly List<(RenderMaterial mat, Vector3 baseEmissive, bool red)> _lamps = new();
    private readonly List<(Vector3 pos, Vector3 vel, float t, float T, bool heavy)> _shells = new();
    private readonly float[] _trackOffset = new float[2];
    private readonly TrainFactory _trainFactory;
    private readonly Microsoft.Xna.Framework.Graphics.GraphicsDevice _device;
    private readonly Func<GameSettings> _settings;
    private ArenaTrain _train;
    private float _trainTimer;
    private int _trainDir, _trainCount;
    private Vector3 _camPos, _aim;
    private float _shake, _dustTimer, _bannerTimer;

    public Camera3D Camera { get; } = new() { BaseFov = GameConfig.Tank.CameraFov, Near = 0.5f, Far = 500 };
    public LightRig Lights { get; }
    public Effects Effects { get; }
    public BlockFlow Blocks { get; }
    public DrainPile Pile { get; }
    public SupplyCrates Supplies { get; }
    public Vector3 Position;
    public float Heading, Speed, TurnRate, TurretYaw, Recoil, RecoilVel, Cooldown, Pitch, ReloadTime = GameConfig.Tank.Reload;
    public float Time { get; private set; }
    public bool Available => _hull != null && _track != null;
    public float ReloadRatio => 1 - Cooldown / ReloadTime;
    public TankLevelState State { get; private set; }
    public int Dropped { get; private set; }
    public int Broken { get; private set; }
    public bool TrainActive => _train != null;
    /// <summary>Seconds left on T / D / R.</summary>
    public readonly Dictionary<SupplyType, float> Powers = new() { [SupplyType.T] = 0, [SupplyType.D] = 0, [SupplyType.R] = 0 };
    /// <summary>Banner: title, sub line, kind ("won", "lost", "power"); visible while Banner != null.</summary>
    public (string title, string sub, string kind)? Banner { get; private set; }
    public Vector3 Aim => _aim;

    public TankLevel(ModelLibrary models, SceneData scene, Microsoft.Xna.Framework.Graphics.Texture2D envMap, RenderQuality quality, Func<GameSettings> settings)
    {
        var data = scene.Prefabs.Tank;
        _device = models.Device;
        _settings = settings;
        _hull = models.Mesh("tank_hull");
        _turret = models.Mesh("tank_turret");
        _barrel = models.Mesh("tank_barrel");
        _link = models.Mesh("tank_link");
        _arena = models.Mesh("tank_arena");
        _shellMesh = models.Mesh("tank_shell");
        _track = data?.Track;
        if (scene.InstanceSets != null && scene.InstanceSets.TryGetValue("tank_arena", out var sets))
            foreach (var name in sets)
                if (models.Instanced(name) is { } inst) _arenaSets.Add(inst);

        // Light: sky / ground hemisphere, a warm sun with shadows that follows the tank, the room
        // environment at 0.35 for reflections on water, blocks and trees (TankLevel.js).
        var rig = LightRig.From(scene);
        rig.EnvMap = envMap;
        rig.EnvIntensity = 0.35f;
        rig.HemiSky = Palette.ToLinear(0xe2f0ff) * 1.15f / MathF.PI;
        rig.HemiGround = Palette.ToLinear(0x58663f) * 1.15f / MathF.PI;
        rig.SunColor = Palette.ToLinear(0xfff0d8) * 2.7f;
        rig.FillColor = Vector3.Zero;
        rig.FogColor = Palette.ToLinear(0x9cc4e4);
        rig.FogNear = 90;
        rig.FogFar = 190;
        rig.Shadow = new ShadowData { Left = -34, Right = 34, Top = 34, Bottom = -34, Near = 1, Far = 120, Bias = -0.0004f };
        rig.Points.Clear();
        Lights = rig;

        BillboardBatch Batch(string tex, int cap, bool additive, int order)
        {
            var (t, srgb) = models.Texture(tex);
            return new BillboardBatch(models.Device, t, srgb, cap, additive, order);
        }
        var cube = models.Mesh("cargo_cube");
        var debrisMaterial = cube.Material.Clone();
        debrisMaterial.BaseColor = Vector4.One;
        debrisMaterial.Roughness = 0.9f;
        var debris = new DebrisSystem(cube, debrisMaterial, new InstanceBuffer(models.Device, 400, true), (_, z) => GameConfig.TankArena.FloorHeight(z));
        Effects = new Effects(new ParticleSystem(Batch("smoke", 2000, false, 11)), new ParticleSystem(Batch("glow", 1200, true, 12)),
            new ParticleSystem(Batch("streak", 900, true, 13)), new ParticleSystem(Batch("fireball0", 500, false, 12)), debris, rig, 3);

        Blocks = new BlockFlow(models, Effects)
        {
            ResolveTank = PushTank,
            OnDrain = OnDrain,
            OnDestroyed = OnBlockDestroyed,
        };
        Pile = new DrainPile(models, Effects);
        Supplies = new SupplyCrates(models.Device, models, scene.Prefabs.SupplyCrateTextures, Effects) { OnPickup = OnPickup };
        _trainFactory = new TrainFactory(models, scene.Prefabs);

        if (!Available) return;
        _turretBase = MathX.FromThree(data.TurretMatrix);
        _barrelBase = MathX.FromThree(data.BarrelMatrix);
        _muzzleLocal = MathX.V3(data.Muzzle);
        // The barrel's pitch is baked into its mesh: its axis is the direction to the muzzle.
        _barrelAxis = Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, _barrelBase));
        _links = new InstanceBuffer(models.Device, _track.Count * 2, true);
        // Blinking lamps: TankRed (tail lamps) and TankAmber (turret rear lamps).
        foreach (var mesh in new[] { _hull, _turret })
        foreach (var part in mesh.Parts)
        {
            var m = part.Material;
            if (m?.Name is "TankRed" or "TankAmber") _lamps.Add((m, m.Emissive, m.Name == "TankRed"));
        }
    }

    private static float HalfW => GameConfig.TankArena.Width / 2;

    /// <summary>Starts (or restarts) phase 1: tank at the bottom of the channel, everything cleared.</summary>
    public void Start()
    {
        Position = new Vector3(0, GameConfig.TankArena.FloorHeight(8), 8);
        Heading = Speed = TurnRate = TurretYaw = Recoil = RecoilVel = Cooldown = Pitch = 0;
        ReloadTime = GameConfig.Tank.Reload;
        _shells.Clear();
        Effects.Clear();
        Blocks.Reset();
        Pile.Reset();
        Supplies.Clear();
        _train = null;
        _trainTimer = 1.5f;
        _trainDir = 1;
        _trainCount = 0;
        Dropped = 0;
        Broken = 0;
        foreach (var k in Powers.Keys.ToList()) Powers[k] = 0;
        State = TankLevelState.Playing;
        Banner = null;
        _aim = new Vector3(0, 0, 24);
        UpdateCamera(0, true);
    }

    public void Update(float dt, GameInput input, Rectangle viewport)
    {
        if (State != TankLevelState.Playing && (input.Pressed(Keys.Enter) || (input.TouchMode && input.Taps.Count > 0)))
        {
            Start();
            return;
        }
        var playing = State == TankLevelState.Playing;
        float throttle = (input.Down(Keys.W) || input.Down(Keys.Up) ? 1 : 0) - (input.Down(Keys.S) || input.Down(Keys.Down) ? 1 : 0);
        float turn = (input.Down(Keys.D) || input.Down(Keys.Right) ? 1 : 0) - (input.Down(Keys.A) || input.Down(Keys.Left) ? 1 : 0);
        var cmd = input.Command;
        if (cmd.StickActive && throttle == 0 && turn == 0)
        {
            throttle = MathHelper.Clamp(-cmd.Stick.Y, -1, 1);
            turn = MathHelper.Clamp(cmd.Stick.X, -1, 1);
        }
        if (!playing) throttle = turn = 0;
        // Aim: the point under the pointer / tap one unit above the floor; a click or tap also fires.
        var fire = input.Down(Keys.Space);
        foreach (var tap in input.Taps)
        {
            if (Ground(tap.Position, viewport) is { } p) _aim = p;
            fire = true;
        }
        if (input.PointerMoved && Ground(input.Pointer, viewport) is { } q) _aim = q;
        Step(dt, throttle, turn, null, playing && fire);
    }

    /// <summary>One simulation step (also driven directly by capture scenarios).</summary>
    public void Step(float dt, float throttle, float turn, Vector3? aim, bool fire)
    {
        Time += dt;
        if (aim.HasValue) _aim = aim.Value;
        Drive(dt, throttle, turn);
        foreach (var k in Powers.Keys.ToList()) Powers[k] = MathF.Max(0, Powers[k] - dt);
        if (fire) Fire();
        if (State == TankLevelState.Playing) UpdateTrains(dt);
        Blocks.Update(dt);
        Pile.Update(dt);
        UpdateShells(dt);
        Supplies.Update(dt, Position + new Vector3(0, 1.2f, 0), State == TankLevelState.Playing);
        UpdateDust(dt);
        Effects.Update(dt);
        UpdateCamera(dt);
        CheckEnd();
        if (_bannerTimer > 0)
        {
            _bannerTimer -= dt;
            if (_bannerTimer <= 0 && State == TankLevelState.Playing) Banner = null;
        }
    }

    private Vector3? Ground(Vector2 screen, Rectangle vp)
    {
        var ndc = new Vector2(screen.X / vp.Width * 2 - 1, 1 - screen.Y / vp.Height * 2);
        var dir = Camera.RayDirection(ndc.X, ndc.Y);
        if (!(dir.Y < -1e-4f)) return null; // also rejects NaN (camera not set up yet)
        var planeY = GameConfig.TankArena.FloorHeight(_aim.Z) + 1;
        var p = Camera.Position + dir * ((planeY - Camera.Position.Y) / dir.Y);
        return float.IsFinite(p.X) && float.IsFinite(p.Z) ? p : null;
    }

    // ---- Tank ----------------------------------------------------------------------------------

    private void Drive(float dt, float throttle, float turn)
    {
        var target = throttle * GameConfig.Tank.Speed * (throttle < 0 ? GameConfig.Tank.ReverseMul : 1);
        var acc = MathF.Abs(target) > MathF.Abs(Speed) ? GameConfig.Tank.Accel : GameConfig.Tank.Brake;
        Speed += Math.Clamp(target - Speed, -acc * dt, acc * dt);
        var turnTarget = -turn * GameConfig.Tank.TurnSpeed * (MathF.Abs(Speed) > 0.1f && Speed < 0 ? -1 : 1);
        TurnRate += (turnTarget - TurnRate) * (1 - MathF.Exp(-8 * dt));
        Heading += TurnRate * dt;
        Position.X += MathF.Sin(Heading) * Speed * dt;
        Position.Z += MathF.Cos(Heading) * Speed * dt;
        ClampToBounds();
        Position.Y = GameConfig.TankArena.FloorHeight(Position.Z);
        // Slight pitch with acceleration (nose lifts pulling away, dips braking).
        Pitch = MathHelper.Lerp(Pitch, -Math.Clamp((target - Speed) * 0.012f, -0.04f, 0.04f), 1 - MathF.Exp(-6 * dt));

        // Turret toward the aim point at a limited rate.
        var aimYaw = MathF.Atan2(_aim.X - Position.X, _aim.Z - Position.Z) - Heading;
        var d = Wrap(aimYaw - TurretYaw);
        var step = GameConfig.Tank.TurretSpeed * dt;
        TurretYaw = Wrap(TurretYaw + Math.Clamp(d, -step, step));

        // Barrel recoil spring.
        RecoilVel += (-Recoil * GameConfig.Tank.RecoilSpring - RecoilVel * GameConfig.Tank.RecoilDamping) * dt;
        Recoil = MathF.Max(0, Recoil + RecoilVel * dt);
        Cooldown = MathF.Max(0, Cooldown - dt);

        // Tracks: a point at hull x moves at Speed - TurnRate * x along the hull.
        for (var s = 0; s < 2; s++)
            _trackOffset[s] = (_trackOffset[s] + (Speed - TurnRate * _track.X[s]) * dt) % _track.Perimeter;

        // Lamps: tail lamps blink (steady while reversing), amber lamps alternate.
        var phase = Time * MathF.PI * 2 * GameConfig.Tank.BlinkHz;
        var reversing = Speed < -0.2f;
        foreach (var (mat, baseE, red) in _lamps)
        {
            var on = MathF.Sin(phase + (red ? 0 : MathF.PI)) > 0 ? 1 : 0.12f;
            mat.Emissive = baseE * (red && reversing ? 1.4f : on);
        }
    }

    /// <summary>Keeps the hull inside the channel (walls, dam lip, rail end).</summary>
    private void ClampToBounds()
    {
        Position.X = Math.Clamp(Position.X, -HalfW + TankR, HalfW - TankR);
        Position.Z = Math.Clamp(Position.Z, 2.4f, GameConfig.TankArena.TopZ - 2);
    }

    private Matrix HullWorld => MathX.RotationXYZ(Pitch, Heading, 0) * Matrix.CreateTranslation(Position);
    private Matrix TurretWorld => Matrix.CreateRotationY(TurretYaw) * _turretBase * HullWorld;
    private Matrix BarrelWorld => Matrix.CreateTranslation(-_barrelAxis * Recoil) * _barrelBase * TurretWorld;
    private float GunYaw => Heading + TurretYaw;

    // ---- Trains --------------------------------------------------------------------------------

    private void UpdateTrains(float dt)
    {
        if (_train != null)
        {
            _train.Update(dt);
            if (_train.Done)
            {
                _train = null;
                _trainTimer = GameConfig.TankArena.TrainGap;
            }
            return;
        }
        if (Dropped >= GameConfig.TankArena.PhaseBlocks) return;
        _trainTimer -= dt;
        if (_trainTimer > 0) return;
        _trainCount++;
        var wagons = Rng.Shared.Int(GameConfig.TankArena.TrainCarsMin, GameConfig.TankArena.TrainCarsMax);
        _train = new ArenaTrain(_trainFactory, Effects, _device, GameConfig.TankArena.RailY, _trainDir, wagons, (uint)_trainCount) { OnDrop = TrainDrop };
        _trainDir = -_trainDir;
    }

    /// <summary>A wagon over a lane: a block (or two back to back), or a gap.</summary>
    private void TrainDrop(int lane, Vector3 from)
    {
        var r = Rng.Shared;
        if (Dropped >= GameConfig.TankArena.PhaseBlocks || r.Next() > GameConfig.TankArena.DropChance) return;
        var z = GameConfig.TankArena.TopZ - GameConfig.TankArena.Block * (0.5f + r.Next() * 1.5f);
        Blocks.Drop(lane, z, from);
        Dropped++;
        if (Dropped < GameConfig.TankArena.PhaseBlocks && r.Next() < GameConfig.TankArena.DoubleChance)
        {
            Blocks.Drop(lane, z, from + new Vector3(0, 1.4f, 0));
            Dropped++;
        }
    }

    // ---- Blocks vs tank, drain, scoring ---------------------------------------------------------

    /// <summary>
    /// A sliding block touching the tank pushes it (out of the block's square). Returns how far the
    /// block has to be held back when the tank cannot give way (pinned against the bottom / walls).
    /// </summary>
    private float PushTank(TankBlock b)
    {
        var h = Blocks.Size * 0.5f;
        var cx = Math.Clamp(Position.X, b.X - h, b.X + h);
        var cz = Math.Clamp(Position.Z, b.Z - h, b.Z + h);
        var dx = Position.X - cx;
        var dz = Position.Z - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 >= TankR * TankR) return 0;
        var d = MathF.Sqrt(d2);
        if (d < 1e-4f)
        {
            dx = 0;
            dz = -1;
            d = 1;
        }
        var over = TankR - d;
        Position.X += dx / d * over;
        Position.Z += dz / d * over;
        ClampToBounds();
        // Whatever overlap is left holds the block back up the lane.
        var cz2 = Math.Clamp(Position.Z, b.Z - h, b.Z + h);
        var cx2 = Math.Clamp(Position.X, b.X - h, b.X + h);
        var rest = MathF.Sqrt((Position.X - cx2) * (Position.X - cx2) + (Position.Z - cz2) * (Position.Z - cz2));
        if (rest >= TankR - 1e-3f || Position.Z > b.Z) return 0;
        return TankR - rest;
    }

    private void OnDrain(TankBlock b)
    {
        Pile.Add(b.X, GameConfig.TankArena.FloorHeight(0) + Blocks.Size / 2, -0.2f, b.Color);
        Effects.SnowPuff(new Vector3(b.X, 0.3f, -0.3f), 5);
    }

    private void OnBlockDestroyed(TankBlock b, int depth, Vector3 at)
    {
        Broken++;
        _shake = MathF.Max(_shake, depth > 0 ? 0.12f : 0.18f);
        if (b.Type == TankBlockType.Supply && State == TankLevelState.Playing) Supplies.SpawnRandom(at, false, true);
    }

    private void OnPickup(SupplyType type, SupplyCrates.Item item)
    {
        var st = _settings?.Invoke();
        var gain = st == null ? 0.64f : st.Master / 10f * (st.Sfx / 10f);
        PickupSfx.Play(gain, 0, type == SupplyType.H ? -0.1f : 0);
        if (type == SupplyType.H) Pile.Remove(10);
        else Powers[type == SupplyType.G ? SupplyType.D : type] = GameConfig.TankArena.PowerTime;
        FlashBanner(PowerNames.TryGetValue(type, out var n) ? n : type.ToString(), 1.4f);
    }

    private void CheckEnd()
    {
        if (State != TankLevelState.Playing) return;
        if (Pile.Count >= GameConfig.TankArena.DrainLimit)
        {
            State = TankLevelState.Lost;
            Banner = ("DRAIN OVERFLOW", "The drain is full · ENTER to try again", "lost");
        }
        else if (Dropped >= GameConfig.TankArena.PhaseBlocks && _train == null && Blocks.Count == 0)
        {
            var won = Broken >= GameConfig.TankArena.BreakGoal;
            State = won ? TankLevelState.Won : TankLevelState.Lost;
            Banner = won
                ? ("PHASE 1 CLEAR!", $"{Broken} blocks broken · {Pile.Count} in the drain · ENTER to play again", "won")
                : ("NOT ENOUGH", $"Only {Broken} / {GameConfig.TankArena.BreakGoal} broken · ENTER to try again", "lost");
        }
    }

    private void FlashBanner(string text, float seconds)
    {
        if (State != TankLevelState.Playing) return;
        Banner = (text, null, "power");
        _bannerTimer = seconds;
    }

    // ---- Shooting --------------------------------------------------------------------------------

    /// <summary>Shot: barrel kick, muzzle flash, shells lobbed to land on the aim point (3 with T).</summary>
    private void Fire()
    {
        if (Cooldown > 0 || !Available) return;
        ReloadTime = GameConfig.Tank.Reload * (Powers[SupplyType.D] > 0 ? 0.4f : 1);
        Cooldown = ReloadTime;
        RecoilVel = GameConfig.Tank.RecoilKick;
        var bw = _barrelBase * TurretWorld;
        var muzzle = Vector3.Transform(_muzzleLocal, bw);
        var dir = Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, bw));
        var r = Rng.Shared;
        Effects.MuzzleFlash(muzzle, dir, new Vector4(4, 2.6f, 0.9f, 1), 1.6f);
        Effects.FlashLight(muzzle, 0xffb060, 70, 0.25f, 12);
        for (var i = 0; i < 8; i++)
        {
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = muzzle + dir * 0.4f,
                Velocity = new Vector3(dir.X * r.Range(2, 6) + r.Spread(1.6f), dir.Y * r.Range(2, 6) + r.Range(0, 1), dir.Z * r.Range(2, 6) + r.Spread(1.6f)), Drag = 2.4f,
                Life = r.Range(0.6f, 1.2f), Size0 = r.Range(0.5f, 0.8f), Size1 = r.Range(1.8f, 2.6f), Aspect = 1,
                Color0 = new Vector4(0.7f, 0.68f, 0.64f, 0.8f), Color1 = new Vector4(0.85f, 0.85f, 0.86f, 0), HasColor1 = true, RotVel = r.Spread(1),
            });
        }
        _shake = MathF.Max(_shake, 0.3f);
        var dist = Math.Clamp(MathF.Sqrt((_aim.X - Position.X) * (_aim.X - Position.X) + (_aim.Z - Position.Z) * (_aim.Z - Position.Z)), 5, GameConfig.Tank.ShellRange);
        var spreads = Powers[SupplyType.T] > 0 ? new[] { -0.14f, 0f, 0.14f } : new[] { 0f };
        foreach (var off in spreads)
        {
            var yaw = GunYaw + off;
            var tx = Position.X + MathF.Sin(yaw) * dist;
            var tz = Position.Z + MathF.Cos(yaw) * dist;
            var ty = GameConfig.TankArena.FloorHeight(tz) + (Blocks.BlockAt(tx, tz) != null ? Blocks.Size : 0.1f);
            var T = MathF.Max(0.2f, MathF.Sqrt((tx - muzzle.X) * (tx - muzzle.X) + (tz - muzzle.Z) * (tz - muzzle.Z)) / GameConfig.Tank.ShellSpeed);
            var vel = new Vector3((tx - muzzle.X) / T, (ty - muzzle.Y + 0.5f * Gravity * T * T) / T, (tz - muzzle.Z) / T);
            _shells.Add((muzzle, vel, 0, T, Powers[SupplyType.R] > 0));
        }
    }

    private void UpdateShells(float dt)
    {
        for (var i = _shells.Count - 1; i >= 0; i--)
        {
            var s = _shells[i];
            s.t += dt;
            s.vel.Y -= Gravity * dt;
            s.pos += s.vel * dt;
            Effects.Fire.Emit(new ParticleSpec { Position = s.pos, Life = 0.12f, Size0 = 0.45f, Size1 = 0.1f, Aspect = 1, Color0 = new Vector4(3, 1.8f, 0.6f, 1), Color1 = new Vector4(1, 0.4f, 0.1f, 0), HasColor1 = true });
            if (s.t < s.T)
            {
                _shells[i] = s;
                continue;
            }
            _shells.RemoveAt(i);
            Impact(s.pos, s.heavy);
        }
    }

    private void Impact(Vector3 at, bool heavy)
    {
        var dmg = GameConfig.Tank.ShellDamage;
        var b = Blocks.BlockAt(at.X, at.Z);
        if (b != null) Blocks.Damage(b, dmg * (heavy ? 2 : 1), at);
        if (heavy)
        {
            // Splash: the four neighbours take a hit too.
            var S = Blocks.Size;
            foreach (var (dx, dz) in new[] { (S, 0f), (-S, 0f), (0f, S), (0f, -S) })
            {
                var n = Blocks.BlockAt(at.X + dx, at.Z + dz);
                if (n != null) Blocks.Damage(n, dmg, new Vector3(n.X, at.Y, n.Z));
            }
        }
        Effects.Explosion(at, heavy ? 1.3f : 0.9f, b != null ? null : 0x7a6a52u, b != null ? 0 : 6);
        if (b == null) Effects.SnowPuff(at + new Vector3(0, 0.1f, 0), 6);
        var d = Vector3.Distance(at, Position);
        _shake = MathF.Max(_shake, Math.Clamp(0.4f - d * 0.01f, 0.06f, 0.4f));
    }

    /// <summary>Spray behind the tracks while driving (shallow water).</summary>
    private void UpdateDust(float dt)
    {
        _dustTimer -= dt * (MathF.Abs(Speed) + MathF.Abs(TurnRate) * 1.5f);
        if (_dustTimer > 0) return;
        _dustTimer = 0.3f;
        var r = Rng.Shared;
        var hull = HullWorld;
        foreach (var x in _track.X)
        {
            var p = Vector3.Transform(new Vector3(x, 0.2f, -2.3f * (Speed < 0 ? -1 : 1)), hull);
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(p.X + r.Spread(0.3f), GameConfig.TankArena.FloorHeight(p.Z) + 0.3f, p.Z + r.Spread(0.3f)),
                Velocity = new Vector3(r.Spread(0.8f), r.Range(0.8f, 1.8f), r.Spread(0.8f)), Drag = 1.8f, Gravity = 4,
                Life = r.Range(0.5f, 0.9f), Size0 = 0.4f, Size1 = r.Range(1.2f, 1.8f), Aspect = 1,
                Color0 = new Vector4(1.15f, 1.3f, 1.4f, 0.6f), Color1 = new Vector4(1.1f, 1.2f, 1.3f, 0), HasColor1 = true,
            });
        }
    }

    /// <summary>Follow camera looking up the channel: x partly, z at `follow` (the drain stays in view).</summary>
    private void UpdateCamera(float dt, bool snap = false)
    {
        var want = new Vector3(Math.Clamp(Position.X * 0.4f, -HalfW * 0.3f, HalfW * 0.3f), GameConfig.Tank.CameraHeight,
            Position.Z * GameConfig.Tank.CameraFollow - GameConfig.Tank.CameraBack);
        _camPos = snap ? want : Vector3.Lerp(_camPos, want, 1 - MathF.Exp(-4 * dt));
        _shake = MathF.Max(0, _shake - dt * 1.6f);
        var r = Rng.Shared;
        Camera.Position = _camPos + (_shake > 0 ? new Vector3(r.Spread(1), r.Spread(1), r.Spread(1)) * _shake * 0.35f : Vector3.Zero);
        // lookAt(camPos.x, 0, camPos.z + ahead): yaw PI faces +Z, pitched down.
        var pitch = MathF.Atan2(GameConfig.Tank.CameraHeight, GameConfig.Tank.CameraAhead);
        Camera.Rotation = new Vector3(-pitch, MathF.PI, 0);
        Lights.SunPosition = new Vector3(Position.X - 20, Position.Y + 40, Position.Z - 6);
        Lights.SunTarget = new Vector3(Position.X, Position.Y, Position.Z + 10);
        Lights.SunDirection = Vector3.Normalize(Lights.SunPosition - Lights.SunTarget);
    }

    // ---- Rendering --------------------------------------------------------------------------------

    public void Submit(RenderQueue queue)
    {
        if (_arena != null) queue.Add(_arena, Matrix.Identity, DrawOverrides.None, true);
        foreach (var set in _arenaSets) queue.Add(set.Mesh, set.World, DrawOverrides.None, true, 0, RenderLayer.World, set.Instances);
        Blocks.Submit(queue);
        Pile.Submit(queue);
        _train?.Submit(queue);
        Supplies.Submit(queue);
        if (Available)
        {
            var hull = HullWorld;
            queue.Add(_hull, hull);
            queue.Add(_turret, TurretWorld);
            queue.Add(_barrel, BarrelWorld);
            // Track links round both loops.
            _links.Count = 0;
            var t = _track;
            var straight = 2 * t.Zc;
            var arc = MathF.PI * t.R;
            for (var s = 0; s < 2; s++)
            {
                var off = -_trackOffset[s];
                for (var k = 0; k < t.Count; k++)
                {
                    var dd = (k * t.Perimeter / t.Count + off) % t.Perimeter;
                    if (dd < 0) dd += t.Perimeter;
                    float z, y, ang;
                    if (dd < straight) { z = -t.Zc + dd; y = t.Yc - t.R; ang = 0; }
                    else if (dd < straight + arc) { var a = (dd - straight) / t.R; z = t.Zc + MathF.Sin(a) * t.R; y = t.Yc - MathF.Cos(a) * t.R; ang = a; }
                    else if (dd < 2 * straight + arc) { z = t.Zc - (dd - straight - arc); y = t.Yc + t.R; ang = MathF.PI; }
                    else { var a = (dd - 2 * straight - arc) / t.R; z = -t.Zc - MathF.Sin(a) * t.R; y = t.Yc + MathF.Cos(a) * t.R; ang = MathF.PI + a; }
                    _links.Add(Matrix.CreateRotationX(-ang) * Matrix.CreateTranslation(t.X[s], y, z) * hull, Vector4.One);
                }
            }
            _links.Upload();
            queue.Add(_link, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _links);
        }
        foreach (var s in _shells)
        {
            var dir = Vector3.Normalize(s.vel);
            var yaw = MathF.Atan2(dir.X, dir.Z);
            var pitch = -MathF.Asin(Math.Clamp(dir.Y, -1, 1));
            if (_shellMesh != null) queue.Add(_shellMesh, Matrix.CreateRotationX(pitch) * Matrix.CreateRotationY(yaw) * Matrix.CreateTranslation(s.pos), DrawOverrides.None, false);
        }
        Effects.Submit(queue);
    }

    private static float Wrap(float a)
    {
        while (a > MathF.PI) a -= MathF.PI * 2;
        while (a < -MathF.PI) a += MathF.PI * 2;
        return a;
    }
}
