using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Audio;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Gameplay.Combat;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;

namespace BlockedPixelWarriors.Gameplay;

public enum TankLevelState { Playing, Won, Lost, Phase2 }

/// <summary>
/// Tank level (src/tank/TankLevel.js + PlayerTank.js), menu card IRON TRACKS, phase 1 "the
/// channel". The tank drives in a sloped concrete channel with shallow flowing water. Trains cross
/// the rail at the far end and drop blocks into the lanes; the blocks slide down toward the dam
/// (pushing each other and the tank) and whatever gets past the lip tumbles into the oval drain
/// and piles up there (physics).
///   1000 blocks come in phase 1: break 900. 100 blocks in the drain loses.
///   Same-coloured neighbours chain-explode; weak / normal / strong (caged) / supply (star) blocks.
///   Supplies: T triple shells, D rapid fire, R homing missiles (like the heli's), H repair + drain
///   pump (-10 blocks).
/// The tank starts in a round base among the trees at the bottom left and drives in along a dirt
/// road through a gap in the left wall. Every 7-20 s the Blocked Pixel Panzer fighter makes a pass:
/// 3-4 s of machine-gun fire and a bomb aimed where the tank is (keep moving). Winning the phase
/// opens the fence gate in the right wall; the road behind it leads on to phase 2.
/// Enemies (Enemy.cs): channel blocks (targets only), trains, the fighter. Projectiles
/// (TankCombat.cs): TankShell, HomingMissile, JetBullet, AerialBomb - pooled, instanced per class.
/// The tank is solid: blocks sliding into it stop in front of it (holding up their lane) and it
/// cannot drive through them. Auto aim (like the heli's gunner): the turret locks onto the best block
/// by itself (reticle), swings onto it, depresses the barrel and fires when on target; Q / E (arrows,
/// the touch buttons) turn it onto another block - when let go, the block nearest the gun is the new
/// lock. Shells fly straight and hit the first block in their path. The mouse does not aim.
/// W/S drive, A/D turn, SPACE / click / tap fires, ENTER restarts a finished phase. Phones: the left
/// stick drives, the turret buttons pick targets. Own camera, lights and effects.
/// </summary>
public sealed class TankLevel : ICombatWorld, UI.IHudModel
{
    /// <summary>Score: per broken block, per fighter shot down.</summary>
    private const int BlockScore = 10, FighterScore = 500;
    private static Color Rgb(uint c) => new((int)(c >> 16) & 255, (int)(c >> 8) & 255, (int)c & 255);

    private static readonly Dictionary<SupplyType, string> PowerNames = new()
    {
        [SupplyType.T] = "TRIPLE SHELLS", [SupplyType.D] = "RAPID FIRE", [SupplyType.R] = "HOMING MISSILES", [SupplyType.H] = "REPAIR · DRAIN PUMP", [SupplyType.G] = "RAPID FIRE",
    };

    private readonly GpuMesh _hull, _turret, _barrel, _link, _arena;
    private readonly (GpuMesh mesh, Vector3 hinge, int dir)[] _gate;
    private readonly int _gateSide = -1;
    private readonly List<Vector2> _roadIn = new(), _roadOut = new();
    private float _gateT;
    private bool _gateOpen;
    private readonly ProjectileManager _projectiles;
    private readonly JetFighter _fighter;
    private readonly FighterContext _fighterCtx;
    private bool _fighterActive;
    private float _fighterTimer, _homingTimer;
    private int _fighterSide = 1, _homingSide = 1;
    private readonly List<InstancedModel> _arenaSets = new();
    private readonly Matrix _turretBase, _barrelBase;
    private readonly Vector3 _barrelAxis, _muzzleLocal;
    private readonly TankTrackData _track;
    private readonly InstanceBuffer _links;
    private readonly List<(RenderMaterial mat, Vector3 baseEmissive, bool red)> _lamps = new();
    private readonly BillboardBatch _reticle;
    private float _reticleSpin, _elevation0;
    private (TankBlock block, int serial, float at, bool auto)? _lock;
    private float _manualAim;
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
    public TankSupplies Supplies { get; }
    /// <summary>The upgrade-card picker (set by the game): tank skill cards every CardEvery blocks.</summary>
    public ICardPicker Cards { get; set; }
    /// <summary>Tank skill cards (all card defs; the tank ones have Level "tank").</summary>
    public IReadOnlyList<CardDefData> CardDefs { get; set; } = Array.Empty<CardDefData>();
    public readonly HashSet<string> Skills = new();
    private int _nextCardAt = GameConfig.TankArena.CardEvery;
    public Vector3 Position;
    public float Heading, Speed, TurnRate, TurretYaw, Recoil, RecoilVel, Cooldown, Pitch, ReloadTime = GameConfig.Tank.Reload;
    /// <summary>Barrel elevation (rad, + up) and where it is heading.</summary>
    public float Elevation = -0.12f, AimElevation = -0.12f;
    public bool Locked => _lock != null;
    public float Time { get; private set; }
    public bool Available => _hull != null && _track != null;
    public float ReloadRatio => 1 - Cooldown / ReloadTime;
    public TankLevelState State { get; private set; }
    public int Dropped { get; private set; }
    public int Broken { get; private set; }
    /// <summary>The shared HUD's events (toasts, kill feed, notices, the damage vignette).</summary>
    public IHudEvents Hud;
    private float _drainWarned;
    private readonly List<ActivePower> _activePowers = new();

    // ---- IHudModel (the heli game's HUD, tank panels) ----
    public bool HudPlaying => State is TankLevelState.Playing or TankLevelState.Won;
    public bool Paused { get; set; }
    public int ScoreValue { get; private set; }
    public string WaveLabel => "PHASE";
    public int Wave => 1;
    public Train Train => null;
    public UI.ChannelPanel? Channel => new UI.ChannelPanel(
        State is TankLevelState.Won or TankLevelState.Phase2 ? "THE CHANNEL · CLEAR" : "THE CHANNEL",
        Broken, GameConfig.TankArena.BreakGoal, Pile.Count, GameConfig.TankArena.DrainLimit, Math.Max(0, GameConfig.TankArena.PhaseBlocks - Dropped));
    public int Lives => 0;
    public float HealthRatio => Hp / GameConfig.Tank.Hp;
    public Logistics Logistics => null;
    public Vector3? TrainWarnPoint => null;
    public string TrainWarnSide => null;

    /// <summary>Objective checklist (bottom left, like the heli stages).</summary>
    public (string title, IReadOnlyList<Objective> items) Objectives()
    {
        var A = GameConfig.TankArena.BreakGoal;
        var won = State is TankLevelState.Won or TankLevelState.Phase2;
        return ("PHASE 1 · THE CHANNEL", new[]
        {
            new Objective($"Break {A} blocks", Broken >= A, $"{Math.Min(Broken, A)}/{A}"),
            new Objective($"Keep the drain under {GameConfig.TankArena.DrainLimit}", won, $"{Pile.Count}/{GameConfig.TankArena.DrainLimit}", BlockColor.Teal),
            new Objective("Survive the fighter", won),
            new Objective("Drive out through the gate", State == TankLevelState.Phase2),
        });
    }

    /// <summary>T / D / R with time left, named and coloured as the tank's supplies.</summary>
    public IReadOnlyList<ActivePower> ActivePowers
    {
        get
        {
            foreach (var (k, v) in Powers)
            {
                var i = _activePowers.FindIndex(p => p.Type == k);
                if (v <= 0)
                {
                    if (i >= 0) _activePowers.RemoveAt(i);
                    continue;
                }
                if (i < 0) _activePowers.Add(new ActivePower { Type = k, Duration = GameConfig.TankArena.PowerTime, Name = PowerNames[k], Color = Rgb(TankSupplies.Color(k)) });
                _activePowers[i < 0 ? ^1 : i].Remaining = v;
            }
            return _activePowers;
        }
    }
    public bool TrainActive => _train != null;
    /// <summary>Seconds left on T / D / R.</summary>
    public readonly Dictionary<SupplyType, float> Powers = new() { [SupplyType.T] = 0, [SupplyType.D] = 0, [SupplyType.R] = 0 };
    /// <summary>Banner: title, sub line, kind ("won", "lost", "power"); visible while Banner != null.</summary>
    public (string title, string sub, string kind)? Banner { get; private set; }
    public Vector3 Aim => _aim;
    /// <summary>Armour (the fighter's guns and bombs are the only things that hurt the tank).</summary>
    public float Hp { get; private set; } = GameConfig.Tank.Hp;
    /// <summary>Red screen-edge flash after a hit (0..1).</summary>
    public float HitFlash { get; private set; }
    public bool FighterActive => _fighterActive;
    public JetFighter Fighter => _fighter;
    public IReadOnlyList<Combat.Projectile> Projectiles => _projectiles.Active;
    /// <summary>Capture helper: units the fighter still has to fly to its pass point.</summary>
    public float FighterPassLeft => _fighterActive ? -_fighter.PassS : float.PositiveInfinity;

    /// <summary>Capture helper: phase won (the gate opens).</summary>
    public void ForceWin()
    {
        State = TankLevelState.Won;
        _gateOpen = true;
        Banner = ("PHASE 1 CLEAR!", "the gate on the right is open - drive out", "won");
    }

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
        var debris = new DebrisSystem(cube, debrisMaterial, new InstanceBuffer(models.Device, 400, true), (x, z) => FloorAt(x, z));
        Effects = new Effects(new ParticleSystem(Batch("smoke", 2000, false, 11)), new ParticleSystem(Batch("glow", 1200, true, 12)),
            new ParticleSystem(Batch("streak", 900, true, 13)), new ParticleSystem(Batch("fireball0", 500, false, 12)), debris, rig, 3);

        Blocks = new BlockFlow(models, Effects)
        {
            ResolveTank = HoldBlock,
            OnDrain = OnDrain,
            OnDestroyed = OnBlockDestroyed,
        };
        Pile = new DrainPile(models, Effects);
        Supplies = new TankSupplies(models, Effects, FloorAt) { OnPickup = OnPickup };
        CardDefs = scene.Prefabs.Cards ?? new List<CardDefData>();
        _trainFactory = new TrainFactory(models, scene.Prefabs);
        var (ret, retSrgb) = models.Texture("ui_reticle");
        _reticle = new BillboardBatch(models.Device, ret, retSrgb, 1, false, 30) { DepthTest = false };

        // Way in / out: road lines and the gate leaves (hinge space models) from the export.
        var arenaData = scene.Prefabs.TankArena;
        if (arenaData != null)
        {
            _gateSide = arenaData.GateSide == 0 ? -1 : arenaData.GateSide;
            foreach (var p in arenaData.RoadIn ?? new()) _roadIn.Add(new Vector2(p[0], p[1]));
            foreach (var p in arenaData.RoadOut ?? new()) _roadOut.Add(new Vector2(p[0], p[1]));
            _gate = (arenaData.Hinges ?? new()).Select((h, i) => (models.Mesh($"tank_gate_leaf{i}"), new Vector3(h[0], h[1], h[2]), (int)h[3])).ToArray();
        }
        else _gate = Array.Empty<(GpuMesh, Vector3, int)>();

        // Projectiles: pooled class hierarchy, one instance buffer per class.
        _projectiles = new ProjectileManager(models.Device);
        var shellMesh = models.Mesh("tank_shell");
        _projectiles.Register<TankShell>(shellMesh, Vector3.UnitZ, Vector3.One, 24, false);
        _projectiles.Register<HomingMissile>(models.Mesh("projectile_missile"), -Vector3.UnitZ, new Vector3(1.6f / 1.25f), 32, true);
        _projectiles.Register<JetBullet>(shellMesh, Vector3.UnitZ, new Vector3(0.45f, 0.45f, 1.6f), 96, false, 48);
        _projectiles.Register<AerialBomb>(models.Mesh("fighter_bomb"), Vector3.UnitZ, new Vector3(GameConfig.Fighter.Scale), 6, true, 4);
        _fighter = new JetFighter(models, scene.Prefabs.Fighter);
        _fighterCtx = new FighterContext
        {
            Projectiles = _projectiles, Effects = Effects, FloorAt = FloorAt,
            CrashAt = p =>
            {
                BombBlast(p, GameConfig.Fighter.BombRadius * 0.8f, GameConfig.Fighter.BombDamage * 0.5f);
                ScoreValue += FighterScore;
                Hud?.Kill("TANK", FeedColors.Heli, "FIGHTER", FeedColors.Train, $"+{FighterScore}", FeedColors.Gold);
            },
        };

        if (!Available) return;
        _turretBase = MathX.FromThree(data.TurretMatrix);
        _barrelBase = MathX.FromThree(data.BarrelMatrix);
        _muzzleLocal = MathX.V3(data.Muzzle);
        // The barrel's pitch is baked into its mesh: its axis is the direction to the muzzle.
        _barrelAxis = Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, _barrelBase));
        _elevation0 = MathF.Asin(Math.Clamp(_barrelAxis.Y, -1, 1));
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
        // In the base, facing the road (toward the channel).
        Position = new Vector3(GameConfig.TankArena.BaseX, 0, GameConfig.TankArena.BaseZ);
        Speed = TurnRate = TurretYaw = Recoil = RecoilVel = Cooldown = Pitch = 0;
        Heading = -MathF.Sign(GameConfig.TankArena.BaseX) * MathF.PI / 2;
        Elevation = AimElevation = -0.12f;
        _lock = null;
        _manualAim = 0;
        ReloadTime = GameConfig.Tank.Reload;
        _projectiles.Clear();
        Hp = GameConfig.Tank.Hp;
        HitFlash = 0;
        _homingTimer = 0;
        _fighterActive = false;
        _fighterTimer = GameConfig.Fighter.FirstDelay;
        _fighterSide = 1;
        _gateOpen = false;
        _gateT = 0;
        Effects.Clear();
        Blocks.Reset();
        Pile.Reset();
        Supplies.Clear();
        // Skill cards: none taken, the first offer at CardEvery broken blocks.
        Skills.Clear();
        Blocks.ChainEnabled = false;
        _nextCardAt = GameConfig.TankArena.CardEvery;
        Cards?.Cancel();
        _train = null;
        _trainTimer = 1.5f;
        _trainDir = 1;
        _trainCount = 0;
        Dropped = 0;
        Broken = 0;
        foreach (var k in Powers.Keys.ToList()) Powers[k] = 0;
        State = TankLevelState.Playing;
        Banner = null;
        ScoreValue = 0;
        _drainWarned = 0;
        _activePowers.Clear();
        Hud?.ClearLog();
        Hud?.Toast($"PHASE 1 - BREAK {GameConfig.TankArena.BreakGoal} BLOCKS");
        _aim = new Vector3(GameConfig.TankArena.BaseX - MathF.Sign(GameConfig.TankArena.BaseX) * 20, 0, GameConfig.TankArena.BaseZ + 4);
        UpdateCamera(0, true);
    }

    public void Update(float dt, GameInput input, Rectangle viewport)
    {
        // Choosing a skill card: the level waits.
        if (Cards?.Active == true) return;
        if ((State == TankLevelState.Lost || State == TankLevelState.Phase2) && (input.Pressed(Keys.Enter) || (input.TouchMode && input.Taps.Count > 0)))
        {
            Start();
            return;
        }
        var playing = State == TankLevelState.Playing || State == TankLevelState.Won;
        // Hull: W / S drive, A / D turn (the arrow keys never move the hull). Turret: Q / E or the
        // left / right arrows (phones: the two buttons on the right). Phones: the left stick drives.
        float throttle = (input.Down(Keys.W) ? 1 : 0) - (input.Down(Keys.S) ? 1 : 0);
        float turn = (input.Down(Keys.D) ? 1 : 0) - (input.Down(Keys.A) ? 1 : 0);
        float turret = (input.Down(Keys.Q) || input.Down(Keys.Left) || input.Touch.TurnLeft ? 1 : 0) - (input.Down(Keys.E) || input.Down(Keys.Right) || input.Touch.TurnRight ? 1 : 0);
        var cmd = input.Command;
        if (cmd.StickActive && throttle == 0 && turn == 0) (throttle, turn) = StickDrive(cmd.Stick.X, cmd.Stick.Y);
        if (!playing) throttle = turn = turret = 0;
        // The mouse never aims and taps never fire (the turret aims and fires by itself); SPACE or a
        // mouse click fires at will.
        var fire = input.Down(Keys.Space) || (!input.TouchMode && input.Taps.Count > 0);
        Step(dt, throttle, turn, null, playing && fire, turret);
    }

    /// <summary>
    /// Left stick (like the heli's): screen-relative - the hull turns toward the stick direction and
    /// drives forward once it roughly faces it (turns on the spot first for a sharp change).
    /// </summary>
    /// <param name="sx">stick right (+1) / left (-1)</param>
    /// <param name="sy">stick down (+1) / up (-1)</param>
    public (float throttle, float turn) StickDrive(float sx, float sy)
    {
        var mag = MathF.Min(1, MathF.Sqrt(sx * sx + sy * sy));
        if (mag < 0.12f) return (0, 0);
        // Camera looks up the channel (+z = screen up), +x is the screen's left.
        var err = Wrap(MathF.Atan2(-sx, -sy) - Heading);
        var c = MathF.Max(0, MathF.Cos(err));
        return (mag * c * c, -Math.Clamp(err * 2.5f, -1, 1));
    }

    /// <summary>One simulation step (also driven directly by capture scenarios).</summary>
    /// <param name="aim">capture scripts: turn the turret toward this point (else <paramref name="turret"/>).</param>
    /// <param name="turret">+1 turns the turret to the screen's left, -1 to the right.</param>
    public void Step(float dt, float throttle, float turn, Vector3? aim, bool fire, float turret = 0)
    {
        Time += dt;
        // Auto aim (like the heli's gunner): the turret swings onto the best block by itself, the
        // barrel depresses toward it and the gun fires whenever it is on target. Q / E (arrows,
        // touch buttons) take the turret over; the block nearest the gun when they are let go is
        // the new lock.
        var aiming = State == TankLevelState.Playing || State == TankLevelState.Won;
        _manualAim = turret != 0 ? GameConfig.Tank.ManualHold : MathF.Max(0, _manualAim - dt);
        var auto = _manualAim <= 0;
        _aim = Position + new Vector3(MathF.Sin(GunYaw), 0, MathF.Cos(GunYaw)) * 20;
        var lockBlock = aiming ? LockedTarget(auto) : null;
        Vector3? lockPoint = lockBlock != null ? BlockCenter(lockBlock) : null;
        Drive(dt, throttle, turn, aim ?? (auto ? lockPoint : null), turret);
        _aim = Position + new Vector3(MathF.Sin(GunYaw), 0, MathF.Cos(GunYaw)) * 20;
        var target = lockPoint ?? FreeAimPoint();
        AimBarrel(target);
        UpdateReticle(dt, lockBlock != null, target);
        // On target: the gunner fires by himself (SPACE / taps still fire at will).
        if (lockPoint is { } lp && auto && aiming
            && MathF.Abs(Wrap(MathF.Atan2(lp.X - Position.X, lp.Z - Position.Z) - GunYaw)) < GameConfig.Tank.AutoFireAngle) fire = true;
        foreach (var k in Powers.Keys.ToList()) Powers[k] = MathF.Max(0, Powers[k] - dt);
        if (fire) Fire();
        if (State == TankLevelState.Playing)
        {
            UpdateTrains(dt);
            UpdateHoming(dt);
        }
        UpdateFighter(dt);
        Blocks.Update(dt);
        Pile.Update(dt);
        _projectiles.Update(dt, this);
        UpdateGate(dt);
        HitFlash = MathF.Max(0, HitFlash - dt * 1.8f);
        Supplies.Update(dt, Position + new Vector3(0, 1.2f, 0), State == TankLevelState.Playing);
        UpdateDust(dt);
        Effects.Update(dt);
        UpdateCamera(dt);
        CheckEnd();
        // Drain warnings at 50 / 75 / 90 %.
        foreach (var f in new[] { 0.5f, 0.75f, 0.9f })
        {
            if (State == TankLevelState.Playing && Pile.Count >= GameConfig.TankArena.DrainLimit * f && _drainWarned < f)
            {
                _drainWarned = f;
                Hud?.Notice($"DRAIN {Pile.Count}/{GameConfig.TankArena.DrainLimit}!", FeedColors.Train);
            }
        }
        if (_bannerTimer > 0)
        {
            _bannerTimer -= dt;
            if (_bannerTimer <= 0 && State == TankLevelState.Playing) Banner = null;
        }
    }

    // ---- Tank ----------------------------------------------------------------------------------

    private void Drive(float dt, float throttle, float turn, Vector3? aimPoint, float turret)
    {
        var target = throttle * GameConfig.Tank.Speed * (throttle < 0 ? GameConfig.Tank.ReverseMul : 1);
        var acc = MathF.Abs(target) > MathF.Abs(Speed) ? GameConfig.Tank.Accel : GameConfig.Tank.Brake;
        Speed += Math.Clamp(target - Speed, -acc * dt, acc * dt);
        var turnTarget = -turn * GameConfig.Tank.TurnSpeed * (MathF.Abs(Speed) > 0.1f && Speed < 0 ? -1 : 1);
        TurnRate += (turnTarget - TurnRate) * (1 - MathF.Exp(-8 * dt));
        var ox = Position.X;
        var oz = Position.Z;
        var oh = Heading;
        Heading += TurnRate * dt;
        var nx = ox + MathF.Sin(Heading) * Speed * dt;
        var nz = oz + MathF.Cos(Heading) * Speed * dt;
        // Where the hull cannot stand (walls, trees, a closed gate) it slides along one axis or stops.
        if (!CanStand(nx, nz, Heading))
        {
            if (CanStand(nx, oz, Heading)) nz = oz;
            else if (CanStand(ox, nz, Heading)) nx = ox;
            else
            {
                nx = ox;
                nz = oz;
                if (!CanStand(ox, oz, Heading)) Heading = oh;
            }
        }
        Position.X = nx;
        Position.Z = nz;
        // Blocks are solid: the hull is pushed back out of them (never into a wall).
        CollideTank();
        if (!CanStand(Position.X, Position.Z, Heading))
        {
            Position.X = nx;
            Position.Z = nz;
        }
        // Ground: height under the hull and its slope along the hull (ramps tip the nose up / down).
        var fx = MathF.Sin(Heading) * 1.9f;
        var fz = MathF.Cos(Heading) * 1.9f;
        var hf = FloorAt(Position.X + fx, Position.Z + fz);
        var hb = FloorAt(Position.X - fx, Position.Z - fz);
        Position.Y = MathF.Max(FloorAt(Position.X, Position.Z), (hf + hb) / 2);
        _slopePitch = MathHelper.Lerp(_slopePitch, -MathF.Atan2(hf - hb, 3.8f), 1 - MathF.Exp(-10 * dt));
        // Slight pitch with acceleration (nose lifts pulling away, dips braking) on top of the slope.
        _accelPitch = MathHelper.Lerp(_accelPitch, -Math.Clamp((target - Speed) * 0.012f, -0.04f, 0.04f), 1 - MathF.Exp(-6 * dt));
        Pitch = _accelPitch + _slopePitch;

        // Turret: turned by the player, or toward an aim point (capture scripts) at a limited rate.
        var step = GameConfig.Tank.TurretSpeed * dt;
        if (aimPoint is { } ap)
        {
            var aimYaw = MathF.Atan2(ap.X - Position.X, ap.Z - Position.Z) - Heading;
            TurretYaw = Wrap(TurretYaw + Math.Clamp(Wrap(aimYaw - TurretYaw), -step, step));
        }
        else if (turret != 0) TurretYaw = Wrap(TurretYaw + Math.Clamp(turret, -1, 1) * step);

        // Barrel elevation toward AimElevation at a limited rate.
        var de = Math.Clamp(AimElevation - Elevation, -GameConfig.Tank.ElevationSpeed * dt, GameConfig.Tank.ElevationSpeed * dt);
        Elevation = Math.Clamp(Elevation + de, GameConfig.Tank.ElevationMin, GameConfig.Tank.ElevationMax);

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

    private float _accelPitch, _slopePitch;
    /// <summary>Yaw first, then pitch about the hull's own x axis (three.js Euler order 'YXZ').</summary>
    private Matrix HullWorld => MathX.RotationYXZ(Pitch, Heading, 0) * Matrix.CreateTranslation(Position);
    private Matrix TurretWorld => Matrix.CreateRotationY(TurretYaw) * _turretBase * HullWorld;
    /// <summary>Barrel pose without recoil: its model pitch (elevation0) turned to Elevation about its base.</summary>
    private Matrix BarrelRest => Matrix.CreateRotationX(_elevation0 - Elevation) * _barrelBase * TurretWorld;
    /// <summary>Barrel axis in turret space at the current elevation.</summary>
    private Vector3 BarrelAxis => Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, Matrix.CreateRotationX(_elevation0 - Elevation) * _barrelBase));
    private Matrix BarrelWorld => Matrix.CreateRotationX(_elevation0 - Elevation) * _barrelBase * Matrix.CreateTranslation(-BarrelAxis * Recoil) * TurretWorld;
    private Vector3 BarrelPivot => Vector3.Transform(_barrelBase.Translation, TurretWorld);
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

    private static (float x, float z)[] Axes(float heading)
    {
        var c = MathF.Cos(heading);
        var sn = MathF.Sin(heading);
        // Block x, z; hull right (c, -sn), forward (sn, c).
        return new[] { (1f, 0f), (0f, 1f), (c, -sn), (sn, c) };
    }

    /// <summary>Projections of the hull footprint and a block square on a 2D axis.</summary>
    private (float tmin, float tmax, float bmin, float bmax, float tc, float bc) Project(float ax, float az, TankBlock b)
    {
        var c = MathF.Cos(Heading);
        var sn = MathF.Sin(Heading);
        var tr = GameConfig.Tank.HalfX * MathF.Abs(c * ax - sn * az) + GameConfig.Tank.HalfZ * MathF.Abs(sn * ax + c * az);
        var tc = Position.X * ax + Position.Z * az;
        var h = Blocks.Size * 0.475f;
        var br = h * (MathF.Abs(ax) + MathF.Abs(az));
        var bc = b.X * ax + b.Z * az;
        return (tc - tr, tc + tr, bc - br, bc + br, tc, bc);
    }

    private bool Near(TankBlock b) => MathF.Abs(b.X - Position.X) < 4.6f && MathF.Abs(b.Z - Position.Z) < 4.6f;

    /// <summary>
    /// A block sliding into the tank stops in front of it: how far up the lane it has to be held
    /// back (0 when it is clear of the hull or below it).
    /// </summary>
    private float HoldBlock(TankBlock b)
    {
        if (!Near(b) || b.Z <= Position.Z) return 0;
        var need = float.PositiveInfinity;
        foreach (var (ax, az) in Axes(Heading))
        {
            var p = Project(ax, az, b);
            if (p.bmin >= p.tmax || p.bmax <= p.tmin) return 0;
            // Moving the block by dz along +z shifts its projection by dz * az.
            if (az > 1e-4f) need = MathF.Min(need, (p.tmax - p.bmin) / az);
            else if (az < -1e-4f) need = MathF.Min(need, (p.tmin - p.bmax) / az);
        }
        return float.IsFinite(need) ? need + 1e-3f : 0;
    }

    /// <summary>The hull cannot drive into blocks: pushed back out along the axis of least overlap.</summary>
    private void CollideTank()
    {
        for (var pass = 0; pass < 2; pass++)
        foreach (var lane in Blocks.Lanes)
        foreach (var b in lane)
        {
            if (!Near(b)) continue;
            var best = float.PositiveInfinity;
            float bx = 0, bz = 0;
            foreach (var (ax, az) in Axes(Heading))
            {
                var p = Project(ax, az, b);
                var o = MathF.Min(p.tmax - p.bmin, p.bmax - p.tmin);
                if (o <= 0)
                {
                    best = 0;
                    break;
                }
                if (o < best)
                {
                    best = o;
                    var sgn = p.tc < p.bc ? -1 : 1;
                    bx = ax * sgn;
                    bz = az * sgn;
                }
            }
            if (best > 0 && float.IsFinite(best))
            {
                Position.X += bx * best;
                Position.Z += bz * best;
            }
        }
    }

    private void OnDrain(TankBlock b)
    {
        Pile.Add(b.X, GameConfig.TankArena.FloorHeight(0) + Blocks.Size / 2, -0.2f, b.Color);
        Effects.SnowPuff(new Vector3(b.X, 0.3f, -0.3f), 5);
    }

    private void OnBlockDestroyed(TankBlock b, int depth, Vector3 at)
    {
        Broken++;
        ScoreValue += BlockScore;
        if (Broken % 100 == 0) Hud?.Kill("TANK", FeedColors.Heli, $"{Broken} BLOCKS", FeedColors.Grey, $"/ {GameConfig.TankArena.BreakGoal}", FeedColors.Gold);
        _shake = MathF.Max(_shake, depth > 0 ? 0.12f : 0.18f);
        if (b.Type == TankBlockType.Supply && State == TankLevelState.Playing)
        {
            // T triple, D rapid, H repair; R (homing rockets) only after its skill card.
            var pool = Skills.Contains("tankHoming")
                ? new[] { SupplyType.T, SupplyType.D, SupplyType.H, SupplyType.R, SupplyType.R }
                : new[] { SupplyType.T, SupplyType.D, SupplyType.H };
            Supplies.Spawn(pool[(int)(Rng.Shared.Next() * pool.Length)], at);
        }
        if (Broken >= _nextCardAt)
        {
            _nextCardAt += GameConfig.TankArena.CardEvery;
            OfferCards();
        }
    }

    /// <summary>Every CardEvery broken blocks: pick one of the tank skill cards not taken yet.</summary>
    public void OfferCards()
    {
        if (Cards == null || State != TankLevelState.Playing) return;
        var pool = CardDefs.Where(d => d.Level == "tank" && !Skills.Contains(d.Id)).Take(2).ToArray();
        if (pool.Length == 0) return;
        Cards.Show(pool, ApplySkill, "CHOOSE A SKILL", $"{Broken} blocks broken");
    }

    public void ApplySkill(CardDefData def)
    {
        Skills.Add(def.Id);
        if (def.Id == "tankChain") Blocks.ChainEnabled = true;
        Hud?.Toast(def.Id == "tankHoming" ? "HOMING ROCKETS UNLOCKED - LOOK FOR R SUPPLIES" : "CHAIN REACTION - SAME COLOURS GO TOGETHER");
    }

    private void OnPickup(SupplyType type, TankSupplies.Item item)
    {
        var st = _settings?.Invoke();
        var gain = st == null ? 0.64f : st.Master / 10f * (st.Sfx / 10f);
        PickupSfx.Play(gain, 0, type == SupplyType.H ? -0.1f : 0);
        if (type == SupplyType.H)
        {
            Pile.Remove(10);
            Hp = MathF.Min(GameConfig.Tank.Hp, Hp + 25);
        }
        else Powers[type == SupplyType.G ? SupplyType.D : type] = GameConfig.TankArena.PowerTime;
        Hud?.Kill("TANK", FeedColors.Heli, PowerNames.TryGetValue(type, out var n) ? n : type.ToString(), Rgb(TankSupplies.Color(type)));
        if (type == SupplyType.H) Hud?.Notice("+25 ARMOR · DRAIN -10", FeedColors.Heli);
    }

    private void CheckEnd()
    {
        if (State == TankLevelState.Won && Position.X * MathF.Sign(GameConfig.TankArena.BaseX) < -GameConfig.TankArena.Phase2X)
        {
            State = TankLevelState.Phase2;
            Banner = ("PHASE 2", "Coming soon · ENTER to replay phase 1", "won");
            return;
        }
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
            // Won: the gate in the right wall opens; the road behind it leads on to phase 2.
            if (won)
            {
                _gateOpen = true;
                Hud?.Toast("PHASE 1 CLEAR - THE GATE IS OPEN", FeedColors.Gold);
            }
            Banner = won
                ? ("PHASE 1 CLEAR!", $"{Broken} blocks broken · the gate on the right is open - drive out", "won")
                : ("NOT ENOUGH", $"Only {Broken} / {GameConfig.TankArena.BreakGoal} broken · ENTER to try again", "lost");
        }
    }

    private void FlashBanner(string text, float seconds)
    {
        if (State != TankLevelState.Playing) return;
        Banner = (text, null, "power");
        _bannerTimer = seconds;
    }

    // ---- Aiming (smart aim) ---------------------------------------------------------------------

    /// <summary>
    /// The locked block (refreshed every LockRefresh s), or null.
    ///   auto   (the gunner): any block in range, scored by how far the turret has to swing and the
    ///          distance; the current lock is kept while it lives (no hopping between neighbours).
    ///   manual (Q / E held): only within AimCone around the gun, so the player sees what the turret
    ///          will settle on when the keys are let go.
    /// </summary>
    private TankBlock LockedTarget(bool auto)
    {
        var held = _lock is { } l && l.block.Serial == l.serial && l.block.Alive;
        if (held && _lock.Value.auto == auto && Time - _lock.Value.at < GameConfig.Tank.LockRefresh) return _lock.Value.block;
        var yaw = MathF.Atan2(_aim.X - Position.X, _aim.Z - Position.Z);
        TankBlock best = null;
        var bestScore = float.PositiveInfinity;
        foreach (var lane in Blocks.Lanes)
        foreach (var b in lane)
        {
            var dx = b.X - Position.X;
            var dz = b.Z - Position.Z;
            var d = MathF.Sqrt(dx * dx + dz * dz);
            if (d < 2.6f || d > GameConfig.Tank.ShellRange) continue;
            var ang = MathF.Abs(Wrap(MathF.Atan2(dx, dz) - yaw));
            if (!auto && ang > GameConfig.Tank.AimCone) continue;
            var mine = held && _lock.Value.block == b;
            var score = auto
                ? ang * GameConfig.Tank.AutoSwingWeight + d * 0.3f - (mine ? GameConfig.Tank.AutoKeep : 0)
                : ang * 12 + d * 0.35f - (mine ? 0.6f : 0);
            if (score < bestScore)
            {
                bestScore = score;
                best = b;
            }
        }
        _lock = best != null ? (best, best.Serial, Time, auto) : null;
        return best;
    }

    private Vector3 BlockCenter(TankBlock b)
    {
        var s = Blocks.Size * 0.95f * (b.Type == TankBlockType.Weak ? 0.9f : 1);
        return new Vector3(b.X, GameConfig.TankArena.FloorHeight(b.Z) + s / 2, b.Z);
    }

    private float BlockTop(TankBlock b) => GameConfig.TankArena.FloorHeight(b.Z) + Blocks.Size * 0.95f * (b.Type == TankBlockType.Weak ? 0.9f : 1);

    /// <summary>No lock: a point along the aim direction at block-centre height.</summary>
    private Vector3 FreeAimPoint()
    {
        var dx = _aim.X - Position.X;
        var dz = _aim.Z - Position.Z;
        var d = MathF.Max(1e-3f, MathF.Sqrt(dx * dx + dz * dz));
        var r = Math.Clamp(d, 8, 26);
        var x = Position.X + dx / d * r;
        var z = Position.Z + dz / d * r;
        return new Vector3(x, FloorAt(x, z) + 0.9f, z);
    }

    /// <summary>Barrel elevation toward the target (from the barrel's pivot).</summary>
    private void AimBarrel(Vector3 target)
    {
        if (!Available) return;
        var pivot = BarrelPivot;
        var h = MathF.Sqrt((target.X - pivot.X) * (target.X - pivot.X) + (target.Z - pivot.Z) * (target.Z - pivot.Z));
        AimElevation = MathF.Atan2(target.Y - pivot.Y, MathF.Max(h, 0.5f));
    }

    private void UpdateReticle(float dt, bool locked, Vector3 target)
    {
        _reticle.Begin();
        if (State == TankLevelState.Playing || State == TankLevelState.Won)
        {
            _reticleSpin += dt * (locked ? 2 : 0.8f);
            var s = locked ? 2.6f + MathF.Sin(_reticleSpin * 3) * 0.18f : 2.2f;
            var a = locked ? 1 : 0.4f;
            _reticle.Push(target.X, target.Y, target.Z, s, s, 1, 1, 1, a, _reticleSpin);
        }
        _reticle.End();
    }

    // ---- Shooting --------------------------------------------------------------------------------

    /// <summary>Shot: barrel kick, muzzle flash, shells straight at the locked block (3 with T).</summary>
    private void Fire()
    {
        if (Cooldown > 0 || !Available) return;
        ReloadTime = GameConfig.Tank.Reload * (Powers[SupplyType.D] > 0 ? 0.4f : 1);
        Cooldown = ReloadTime;
        RecoilVel = GameConfig.Tank.RecoilKick;
        var bw = BarrelRest;
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
        // Locked: straight at the block's centre (the gunner corrects the last few degrees).
        var lockBlock = _lock is { } l && l.block.Serial == l.serial && l.block.Alive ? l.block : null;
        var aimDir = lockBlock != null ? Vector3.Normalize(BlockCenter(lockBlock) - muzzle) : dir;
        // Point blank: a block between the barrel's base and the muzzle takes the hit at once.
        var close = TraceBlock(BarrelPivot, muzzle);
        if (close != null)
        {
            var c = BlockCenter(close);
            Blocks.Damage(close, GameConfig.Tank.ShellDamage, c);
            Effects.Explosion(c, 0.9f);
            return;
        }
        var spreads = Powers[SupplyType.T] > 0 ? new[] { -0.12f, 0f, 0.12f } : new[] { 0f };
        foreach (var off in spreads)
            _projectiles.Spawn<TankShell>(muzzle, Vector3.Transform(aimDir, Matrix.CreateRotationY(off)) * GameConfig.Tank.ShellSpeed);
    }

    /// <summary>First block on the segment a -> b (0.25 steps), or null.</summary>
    private TankBlock TraceBlock(Vector3 a, Vector3 b)
    {
        var n = Math.Max(1, (int)MathF.Ceiling(Vector3.Distance(a, b) / 0.25f));
        for (var k = 0; k <= n; k++)
        {
            var p = Vector3.Lerp(a, b, k / (float)n);
            var blk = Blocks.BlockAt(p.X, p.Z);
            if (blk != null && p.Y <= BlockTop(blk)) return blk;
        }
        return null;
    }

    // ---- Combat world (ICombatWorld: what the projectiles see) ------------------------------------

    TankBlock ICombatWorld.BlockAt(float x, float z) => Blocks.BlockAt(x, z);
    float ICombatWorld.BlockTop(TankBlock b) => BlockTop(b);
    void ICombatWorld.DamageBlock(TankBlock b, float amount, Vector3 at) => Blocks.Damage(b, amount, at);
    JetFighter ICombatWorld.FlyingEnemy => _fighterActive && _fighter.IsAlive ? _fighter : null;

    public void ShakeAt(Vector3 p, float amount)
    {
        var d = Vector3.Distance(p, Position);
        _shake = MathF.Max(_shake, Math.Clamp(amount - d * 0.01f, 0.06f, amount));
    }

    /// <summary>The hull as a box: footprint (oriented) and 0..2.8 above the ground.</summary>
    public bool TankHit(Vector3 p)
    {
        if (p.Y < Position.Y - 0.2f || p.Y > Position.Y + 2.8f) return false;
        var dx = p.X - Position.X;
        var dz = p.Z - Position.Z;
        var c = MathF.Cos(Heading);
        var sn = MathF.Sin(Heading);
        return MathF.Abs(dx * c - dz * sn) <= GameConfig.Tank.HalfX + 0.1f && MathF.Abs(dx * sn + dz * c) <= GameConfig.Tank.HalfZ + 0.1f;
    }

    public void DamageTank(float amount, Vector3 at)
    {
        if (State != TankLevelState.Playing && State != TankLevelState.Won) return;
        Hp = MathF.Max(0, Hp - amount);
        HitFlash = MathF.Min(1, HitFlash + amount / 25);
        Hud?.DamageFlash(MathF.Min(1, 0.35f + amount / 20));
        _shake = MathF.Max(_shake, MathF.Min(0.5f, 0.08f + amount / 60));
        if (Hp <= 0 && State == TankLevelState.Playing)
        {
            State = TankLevelState.Lost;
            var p = Position + new Vector3(0, 1.5f, 0);
            Effects.Explosion(p, 2.4f, 0x3c4a2au, 22);
            Effects.FlashLight(p, 0xff8040, 120, 0.5f, 18);
            Banner = ("TANK DESTROYED", "The fighter got you - keep moving under fire · ENTER to try again", "lost");
            Hud?.Kill("FIGHTER", FeedColors.Train, "TANK", FeedColors.Heli, "☠", FeedColors.Train);
        }
    }

    /// <summary>A bomb (or the crashing fighter): fireball, crater dust, the tank and blocks in reach hurt.</summary>
    public void BombBlast(Vector3 p, float radius, float damage)
    {
        var r = Rng.Shared;
        Effects.Explosion(p, 2.2f, 0x6a5a40u, 18);
        Effects.Explosion(new Vector3(p.X + r.Spread(1), p.Y + 0.8f, p.Z + r.Spread(1)), 1.4f);
        Effects.FlashLight(p, 0xff9040, 140, 0.45f, 20);
        var wet = IsWater(p.X, p.Z);
        for (var i = 0; i < 26; i++)
        {
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(p.X + r.Spread(1.5f), p.Y + 0.2f, p.Z + r.Spread(1.5f)), Velocity = new Vector3(r.Spread(6), r.Range(4, 11), r.Spread(6)), Drag = 1.4f, Gravity = 10,
                Life = r.Range(0.8f, 1.5f), Size0 = 0.6f, Size1 = r.Range(1.8f, 2.8f), Aspect = 1,
                Color0 = wet ? new Vector4(1.2f, 1.32f, 1.42f, 0.9f) : new Vector4(0.55f, 0.47f, 0.36f, 0.85f),
                Color1 = wet ? new Vector4(1.1f, 1.2f, 1.3f, 0) : new Vector4(0.65f, 0.6f, 0.52f, 0), HasColor1 = true,
            });
        }
        var d = MathF.Sqrt((p.X - Position.X) * (p.X - Position.X) + (p.Z - Position.Z) * (p.Z - Position.Z));
        if (d < radius) DamageTank(damage * MathF.Pow(1 - d / radius, 0.6f), p);
        foreach (var lane in Blocks.Lanes)
        foreach (var b in lane.ToArray())
            if (MathF.Sqrt((b.X - p.X) * (b.X - p.X) + (b.Z - p.Z) * (b.Z - p.Z)) < radius * 0.7f) Blocks.Damage(b, 2, new Vector3(b.X, p.Y + 1, b.Z));
        _shake = MathF.Max(_shake, Math.Clamp(0.9f - d * 0.02f, 0.2f, 0.9f));
    }

    public Enemy ClosestEnemy(Vector3 p)
    {
        TankBlock best = null;
        var bd = GameConfig.Tank.HomingRange;
        foreach (var lane in Blocks.Lanes)
        foreach (var b in lane)
        {
            var d = MathF.Sqrt((b.X - p.X) * (b.X - p.X) + (b.Z - p.Z) * (b.Z - p.Z));
            if (d < bd)
            {
                bd = d;
                best = b;
            }
        }
        return best;
    }

    // ---- Arena layout: ground, water, walls, the way in / out (TankArena.js) ------------------------

    private static float DistToLine(List<Vector2> pts, float x, float z)
    {
        var best = float.PositiveInfinity;
        for (var i = 0; i < pts.Count - 1; i++)
        {
            var a = pts[i];
            var ab = pts[i + 1] - a;
            var t = Math.Clamp(((x - a.X) * ab.X + (z - a.Y) * ab.Y) / MathF.Max(ab.LengthSquared(), 1e-6f), 0, 1);
            var px = a.X + ab.X * t - x;
            var pz = a.Y + ab.Y * t - z;
            best = MathF.Min(best, px * px + pz * pz);
        }
        return MathF.Sqrt(best);
    }

    /// <summary>Ramp surface height at |x| = ax (channel edge .. RampEnd) and z (TankArena.rampHeight).</summary>
    private static float RampHeight(float ax, float z)
    {
        var w = HalfW;
        var t = Math.Clamp((ax - w) / (GameConfig.TankArena.RampEnd - w), 0, 1);
        var e = t * t * (3 - 2 * t) * 0.35f + t * 0.65f;
        return MathHelper.Lerp(GameConfig.TankArena.FloorHeight(z) + 0.16f, GameConfig.TankArena.GroundY, e);
    }

    /// <summary>Ground height anywhere: the sloped channel floor inside, the ramps, the land outside.</summary>
    public float FloorAt(float x, float z)
    {
        var w = HalfW;
        var ax = MathF.Abs(x);
        if (ax <= w && z >= 0 && z <= GameConfig.TankArena.TopZ) return GameConfig.TankArena.FloorHeight(z);
        if (ax > w && ax <= GameConfig.TankArena.RampEnd && z >= GameConfig.TankArena.GapZ0 && z <= GameConfig.TankArena.GapZ1) return RampHeight(ax, z);
        if (ax <= w + 1.3f && z > -6 && z <= GameConfig.TankArena.TopZ + 1.4f) return GameConfig.TankArena.FloorHeight(z);
        return GameConfig.TankArena.GroundY;
    }

    public bool IsWater(float x, float z) => MathF.Abs(x) <= HalfW && z >= 0 && z <= GameConfig.TankArena.TopZ;

    /// <summary>A shell hitting a channel wall (inside the wall boxes, below the cap).</summary>
    public bool WallAt(Vector3 p)
    {
        var ax = MathF.Abs(p.X);
        if (ax < HalfW || ax > HalfW + 1.35f || p.Z < -4.2f || p.Z > GameConfig.TankArena.TopZ + 1.2f) return false;
        if (p.Y > GameConfig.TankArena.GroundY + 0.45f) return false;
        return !(p.Z > GameConfig.TankArena.GapZ0 && p.Z < GameConfig.TankArena.GapZ1);
    }

    /// <summary>Walkable ground: the channel, the ramps (past the gate at the top of the far one only once it is open), the roads, the base.</summary>
    private bool Walkable(float x, float z)
    {
        var A = GameConfig.TankArena.Block;
        var w = HalfW;
        var ax = MathF.Abs(x);
        var g0 = GameConfig.TankArena.GapZ0;
        var g1 = GameConfig.TankArena.GapZ1;
        var rampEnd = GameConfig.TankArena.RampEnd;
        var inGap = z > g0 + 0.15f && z < g1 - 0.15f;
        if (ax <= w && z >= 0.3f && z <= GameConfig.TankArena.TopZ - A * 2.6f) return true;
        var open = _gateT > 0.85f;
        var entry = MathF.Sign(GameConfig.TankArena.BaseX);
        if (ax > w && ax <= rampEnd + 0.1f && inGap) return true;
        if (ax > w && ax <= rampEnd + 0.8f && inGap) return MathF.Sign(x) == entry || open;
        if (ax <= rampEnd + 0.8f && z > g0 - 0.9f && z < g1 + 0.9f) return false; // ramp walls / gate posts
        if (ax <= w + 1.3f) return false;
        var bx = x - GameConfig.TankArena.BaseX;
        var bz = z - GameConfig.TankArena.BaseZ;
        if (MathF.Sqrt(bx * bx + bz * bz) < GameConfig.TankArena.BaseR - 0.8f) return true;
        if (MathF.Sign(x) == entry && DistToLine(_roadIn, x, z) < GameConfig.TankArena.RoadWidth / 2) return true;
        if (MathF.Sign(x) != entry && DistToLine(_roadOut, x, z) < GameConfig.TankArena.RoadWidth / 2) return open;
        return false;
    }

    /// <summary>Footprint corners (and edge midpoints) on walkable ground.</summary>
    private bool CanStand(float x, float z, float heading)
    {
        var c = MathF.Cos(heading);
        var sn = MathF.Sin(heading);
        foreach (var (u, v) in new[] { (-1, -1), (1, -1), (1, 1), (-1, 1), (0, 1), (0, -1), (1, 0), (-1, 0) })
        {
            var lx = u * GameConfig.Tank.HalfX;
            var lz = v * GameConfig.Tank.HalfZ;
            if (!Walkable(x + lx * c + lz * sn, z - lx * sn + lz * c)) return false;
        }
        return true;
    }

    private void UpdateGate(float dt) => _gateT = Math.Clamp(_gateT + (_gateOpen ? dt / 1.6f : -dt / 0.8f), 0, 1);

    // ---- Fighter, homing missiles ------------------------------------------------------------------

    private void UpdateFighter(float dt)
    {
        if (!_fighter.Available) return;
        if (_fighterActive)
        {
            _fighterCtx.TankPosition = Position;
            _fighterCtx.Armed = State == TankLevelState.Playing;
            _fighter.Update(dt, _fighterCtx);
            if (_fighter.Done)
            {
                _fighterActive = false;
                _fighterTimer = Rng.Shared.Range(GameConfig.Fighter.GapMin, GameConfig.Fighter.GapMax);
            }
            return;
        }
        if (State != TankLevelState.Playing) return;
        _fighterTimer -= dt;
        if (_fighterTimer > 0) return;
        _fighter.Start(Position, _fighterSide);
        _fighterSide = -_fighterSide;
        _fighterActive = true;
        Hud?.Log("▲ ENEMY FIGHTER INBOUND - KEEP MOVING", new Color(0xff, 0x8a, 0x7a));
    }

    /// <summary>R: homing missiles off the turret sides, up and out, curving onto blocks / the fighter.</summary>
    private void UpdateHoming(float dt)
    {
        if (Powers[SupplyType.R] <= 0 || !Available) return;
        _homingTimer -= dt;
        if (_homingTimer > 0) return;
        var targets = new List<Enemy>();
        foreach (var lane in Blocks.Lanes)
        foreach (var b in lane)
            if (MathF.Sqrt((b.X - Position.X) * (b.X - Position.X) + (b.Z - Position.Z) * (b.Z - Position.Z)) < GameConfig.Tank.HomingRange) targets.Add(b);
        if (_fighterActive && _fighter.IsAlive && Vector3.Distance(_fighter.Position, Position) < GameConfig.Tank.HomingRange * 1.4f)
            for (var i = 0; i < 4; i++) targets.Add(_fighter); // the favourite target while in reach
        _homingTimer = targets.Count > 0 ? GameConfig.Tank.HomingInterval : 0.2f;
        if (targets.Count == 0) return;
        var r = Rng.Shared;
        var pick = targets[(int)(r.Next() * targets.Count)];
        _homingSide = -_homingSide;
        var muzzle = Vector3.Transform(new Vector3(_homingSide * 1.1f, 1.0f, -0.4f), TurretWorld);
        var dir = Vector3.Normalize(Vector3.Transform(new Vector3(_homingSide * 0.7f + r.Spread(0.5f), 1.5f, r.Spread(0.6f)), Matrix.CreateRotationY(GunYaw)));
        var m = _projectiles.Spawn<HomingMissile>(muzzle, dir * GameConfig.Tank.MissileSpeed * 0.7f);
        m.Target = pick;
        Effects.MuzzleFlash(muzzle, dir, new Vector4(5, 2.4f, 0.6f, 1), 0.6f);
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
            var wet = IsWater(p.X, p.Z);
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(p.X + r.Spread(0.3f), FloorAt(p.X, p.Z) + 0.3f, p.Z + r.Spread(0.3f)),
                Velocity = new Vector3(r.Spread(0.8f), r.Range(0.8f, 1.8f), r.Spread(0.8f)), Drag = 1.8f, Gravity = wet ? 4 : 0.5f,
                Life = r.Range(0.5f, 0.9f) * (wet ? 1 : 1.5f), Size0 = 0.4f, Size1 = r.Range(1.2f, 1.8f) * (wet ? 1 : 1.4f), Aspect = 1,
                Color0 = wet ? new Vector4(1.15f, 1.3f, 1.4f, 0.6f) : new Vector4(0.62f, 0.53f, 0.4f, 0.55f),
                Color1 = wet ? new Vector4(1.1f, 1.2f, 1.3f, 0) : new Vector4(0.7f, 0.64f, 0.55f, 0), HasColor1 = true,
            });
        }
    }

    /// <summary>Follow camera looking up the channel: x partly, z at `follow` (the drain stays in view).</summary>
    private void UpdateCamera(float dt, bool snap = false)
    {
        // In the channel follow x only partly (keep it framed); out on the roads / in the base follow.
        var ax = MathF.Abs(Position.X);
        var camX = ax <= HalfW ? Position.X * 0.4f : MathF.Sign(Position.X) * (HalfW * 0.4f + (ax - HalfW) * 0.9f);
        var want = new Vector3(camX, GameConfig.Tank.CameraHeight,
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
        // Gate leaves: both swing outward (away from the channel), eased.
        var e = _gateT * _gateT * (3 - 2 * _gateT);
        foreach (var (mesh, hinge, dir) in _gate)
            if (mesh != null) queue.Add(mesh, Matrix.CreateRotationY(_gateSide * dir * e * 1.75f) * Matrix.CreateTranslation(hinge));
        if (_fighterActive) _fighter.Submit(queue);
        _projectiles.Submit(queue);
        queue.Add(_reticle);
        Effects.Submit(queue);
    }

    private static float Wrap(float a)
    {
        while (a > MathF.PI) a -= MathF.PI * 2;
        while (a < -MathF.PI) a += MathF.PI * 2;
        return a;
    }
}
