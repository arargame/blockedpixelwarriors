using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using BlockedPixelWarriors.World;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Gameplay;

public enum GameState { Title, Playing, Dead, Over, Won }

/// <summary>
/// Composition root of one game (Game.js): wires the systems, runs the simulation step and acts
/// as the collision Mediator between projectiles and entities.
/// </summary>
public sealed class GameSession : IRenderable
{
    private static class Score
    {
        public const int Block = 10, Cargo = 25, Turret = 100, Gem = 500, Mine = 50, Supply = 50, Delivery = 100;
    }

    private readonly GraphicsDevice _device;
    private readonly LightRig _lights;
    private readonly TrainFactory _trainFactory;
    private readonly IHudEvents _hud;
    private readonly BillboardBatch _reticle;
    private readonly Targeting _targeting = new();
    private float _trainTimer = 1.5f, _deadTimer;
    private float _tMain, _tTriple, _tBurst, _tHoming = 0.8f;
    private int _side, _homingSide;
    private float _exhaustTimer, _damageSmokeTimer, _reticleSpin;
    private (float time, string pod) _backblast;
    private bool _lastShotAimed;
    private (Train train, int lap, HashSet<int> rows) _restock;
    private readonly List<FloorSnow.Clearer> _clearers = new(4);
    private readonly HashSet<string> _takenCards = new();
    private readonly List<CardDefData> _cardDefs;
    private readonly List<CardDefData> _offer = new(2);
    private bool _gemDrops;
    private float _cardTimer, _eggTimer;
    private int _offersMade;
    private static Rng R => Rng.Shared;
    private static readonly Color[] BoxCss = { new(0xff, 0x6b, 0x6b), new(0x7b, 0xe8, 0x6a), new(0x5a, 0xb8, 0xff), new(0xff, 0xd3, 0x4a) };
    private static readonly Color[] MissionCss = { new(0xff, 0x5a, 0x5a), new(0x6e, 0xe0, 0x5a), new(0x38, 0xc8, 0xff) };
    private static readonly string[] RearPods = { "podRearL", "podRearR" };
    private static readonly float[] TripleAngles = { -0.26f, 0f, 0.26f };

    public WorldScene World { get; }
    public Effects Effects { get; }
    public ProjectileSystem Projectiles { get; }
    public BlockField Blocks { get; }
    public Helicopter Heli { get; }
    public SupplyCrates Supplies { get; }
    public PowerUpSystem PowerUps { get; } = new();
    public CameraRig Rig { get; }
    public Train Train { get; private set; }
    public Logistics Logistics { get; }
    public SpikeMines Mines { get; }
    /// <summary>Upgrade-card UI (set by the game once the UI exists).</summary>
    public ICardPicker Cards { get; set; }
    public IReadOnlyCollection<string> TakenCards => _takenCards;
    public IReadOnlyList<CardDefData> CardDefs => _cardDefs;
    public GameState State { get; private set; } = GameState.Title;
    public int ScoreValue { get; private set; }
    public int Lives { get; private set; } = 3;
    public int Wave { get; private set; }
    public float Time { get; private set; }
    public bool Paused { get; set; }
    /// <summary>Raised when the score, lives or HP change (HUD refresh).</summary>
    public float HealthRatio => Heli.Hp / GameConfig.Heli.MaxHp;

    public GameSession(GraphicsDevice device, ModelLibrary models, SceneData scene, LightRig lights, RenderQuality quality, IHudEvents hud)
    {
        _device = device;
        _lights = lights;
        _hud = hud;
        Rig = new CameraRig(scene.Camera);
        World = new WorldScene(device, models, scene, quality.ForegroundBlur);

        BillboardBatch Batch(string tex, int cap, bool additive, int order)
        {
            var (t, srgb) = models.Texture(tex);
            return new BillboardBatch(device, t, srgb, cap, additive, order);
        }
        var cube = models.Mesh("cargo_cube");
        var debrisMaterial = cube.Material.Clone();
        debrisMaterial.BaseColor = Vector4.One;
        debrisMaterial.Roughness = 0.6f;
        var debris = new DebrisSystem(cube, debrisMaterial, new InstanceBuffer(device, 420, true), (x, z) => World.Board.GroundHeightAt(x, z));
        Effects = new Effects(Batched(Batch("smoke", 2000, false, 11)), Batched(Batch("glow", 1400, true, 12)), Batched(Batch("streak", 1200, true, 13)),
            Batched(Batch("fireball0", 500, false, 12)), debris, lights, quality.FlashLights);
        static ParticleSystem Batched(BillboardBatch b) => new(b);

        Projectiles = new ProjectileSystem(device, models, Effects) { CollisionHandler = ResolveHit };
        Blocks = new BlockField(models, Effects) { OnBlockDestroyed = OnBlockDestroyed };
        Supplies = new SupplyCrates(device, models, scene.Prefabs.SupplyCrateTextures, Effects) { OnPickup = OnPickup };
        Heli = new Helicopter(models, scene.Prefabs.Heli, World.Board) { Spawn = Rig.HeliAnchor, Position = Rig.HeliAnchor };
        Logistics = new Logistics(models, scene.Prefabs.Forklift, scene.Prefabs.Chinook, Blocks, Effects, lights)
        {
            OnPackaged = c =>
            {
                if (c.HasValue && State == GameState.Playing)
                    _hud.Kill("ENGINEER", FeedColors.Engineer, $"{ColorName(c.Value)} PACKAGE", BoxCss[(int)c.Value], "→ dock", Color.White * 0.6f);
            },
            OnChinookArrive = count =>
            {
                if (State == GameState.Playing) _hud.Toast(count > 0 ? $"CARGO CHOPPER INBOUND - {count} PACKAGES" : "CARGO CHOPPER INBOUND - DOCK IS EMPTY!");
            },
            OnDelivered = OnPackageDelivered,
            OnEngineerReady = () =>
            {
                if (State == GameState.Playing) _hud.Toast("ENGINEER ON DUTY - SHOOT CARGO OFF THE TRAIN");
            },
            OnChinookLeft = loaded =>
            {
                if (State == GameState.Playing && loaded > 0) _hud.Toast($"CARGO CHOPPER AWAY - {loaded} DELIVERED");
            },
        };
        Mines = new SpikeMines(models, World.Board, Blocks, Effects);
        _targeting.Mines = Mines;
        _cardDefs = scene.Prefabs.Cards ?? new List<CardDefData>();
        _trainFactory = new TrainFactory(models, scene.Prefabs);
        var (ret, retSrgb) = models.Texture("ui_reticle");
        _reticle = new BillboardBatch(device, ret, retSrgb, 1, false, 30) { DepthTest = false };
        Rig.Update(0, Heli.Position, true);
        _hud.ShowTitle();
    }

    // ---- Run lifecycle ------------------------------------------------------------------------

    public void StartRun()
    {
        PowerUps.Clear();
        Logistics.Reset();
        _takenCards.Clear();
        _offersMade = 0;
        _gemDrops = false;
        _cardTimer = 0;
        _eggTimer = 0;
        Cards?.Cancel();
        Mines.ClearEggs();
        State = GameState.Playing;
        ScoreValue = 0;
        Lives = 3;
        Wave = 0;
        Heli.FlickerMul = 1;
        Heli.Respawn();
        _hud.HideOverlay();
        Paused = false;
    }

    private void AddScore(int points)
    {
        if (State != GameState.Playing) return;
        ScoreValue += points;
    }

    private void SpawnTrain()
    {
        Wave++;
        Train?.Dispose();
        Train = new Train(_trainFactory, Effects, _lights, _device, Wave, (uint)Wave)
        {
            OnFire = FireEnemyShell,
            OnCannonFire = FireCannonShell,
            OnCargoKnocked = (p, c) => Blocks.DropFromTrain(p, c),
            OnShieldDown = () => _hud.Toast("GEM SHIELD DOWN - HIT THE HEAD!"),
            OnTargetDestroyed = OnTrainPartDestroyed,
        };
        _hud.Toast($"WAVE {Wave} - ARMORED TRAIN INCOMING");
    }

    private void OnTrainPartDestroyed(TargetKind kind, Vector3 position)
    {
        AddScore(kind switch { TargetKind.Turret => Score.Turret, TargetKind.Gem => Score.Gem, TargetKind.Cargo => Score.Cargo, _ => 0 });
        Rig.AddShake(kind == TargetKind.Gem ? 0.9f : 0.25f);
        if (kind == TargetKind.Turret) _hud.Kill("HELI", FeedColors.Heli, "TURRET", FeedColors.Grey, $"+{Score.Turret}", FeedColors.Gold);
        if (kind == TargetKind.Gem)
        {
            _hud.Kill("HELI", FeedColors.Heli, $"ARMORED TRAIN #{Wave}", FeedColors.Train, "☠", FeedColors.Train);
            _hud.Toast("TRAIN DESTROYED! +500");
            _cardTimer = GameConfig.Cards.OfferDelay;
        }
    }

    private static string ColorName(BlockColor c) => c == BlockColor.Teal ? "BLUE" : Palette.Key(c).ToUpperInvariant();

    /// <summary>Supply types allowed to drop: G with GEM MINE, R with HOMING ROCKETS.</summary>
    private SupplyCrates.Item SpawnSupply(Vector3 p) => Supplies.SpawnRandom(p, _gemDrops, _takenCards.Contains("homing"));

    private void OnBlockDestroyed(Block block, int depth)
    {
        AddScore(Score.Block * (1 + depth));
        var at = new Vector3(block.X, GameConfig.BlockSize * 0.6f, block.Z);
        if (block.Type == BlockType.Supply && State != GameState.Over) SpawnSupply(at);
        // GEM MINE card: ordinary blocks may crack open a gem too.
        else if (_gemDrops && !block.Cargo && R.Next() < GameConfig.Cards.GemDropChance) Supplies.Spawn(SupplyType.G, at);
        if (block.Cargo && State == GameState.Playing)
        {
            _hud.Notice("CARGO LOST!", new Color(0xff, 0x6b, 0x6b));
            _hud.Kill("HELI", FeedColors.Heli, $"{ColorName(block.Color)} CARGO", BoxCss[(int)block.Color], "✖ lost", new Color(0xff, 0x8a, 0x7a));
        }
        if (depth > 0) Rig.AddShake(0.12f);
    }

    private void OnPackageDelivered(BlockColor color, MissionColor? key)
    {
        AddScore(Score.Delivery);
        if (key.HasValue && State == GameState.Playing) _hud.Notice($"+1 {key.Value.ToString().ToUpperInvariant()}", MissionCss[(int)key.Value]);
        if (Logistics.MissionComplete && State == GameState.Playing)
        {
            State = GameState.Won;
            Cards?.Cancel();
            _hud.ShowMissionComplete(ScoreValue, Logistics.Delivered);
        }
    }

    private void OnPickup(SupplyType type, SupplyCrates.Item item)
    {
        AddScore(Score.Supply);
        var def = SupplyCatalog.Of(type);
        if (State == GameState.Playing)
        {
            if (item.Gem.HasValue)
            {
                var g = SupplyCatalog.Of(item.Gem.Value);
                _hud.Kill("HELI", FeedColors.Heli, $"{item.Gem.Value.ToString().ToUpperInvariant()} GEM · {g.Name}", g.Css);
            }
            else
            {
                _hud.Kill("HELI", FeedColors.Heli, def.Name, def.Css);
            }
        }
        switch (type)
        {
            case SupplyType.H:
            {
                var before = Heli.Hp;
                Heli.Hp = MathF.Min(GameConfig.Heli.MaxHp, Heli.Hp + GameConfig.Supply.HealAmount);
                _hud.Notice($"+{MathF.Round(Heli.Hp - before)} HP", new Color(0xff, 0x6b, 0x78));
                Effects.SparkBurst(Heli.Position, 30, 6, new Vector4(4, 0.8f, 1, 1));
                break;
            }
            case SupplyType.G:
                PowerUps.Activate(SupplyType.G, null, item.Gem);
                _hud.Notice(SupplyCatalog.Of(item.Gem.GetValueOrDefault()).Name, SupplyCatalog.Of(item.Gem.GetValueOrDefault()).Css);
                break;
            default:
                PowerUps.Activate(type);
                break;
        }
    }

    // ---- Enemy fire ---------------------------------------------------------------------------

    private void FireCannonShell(Vector3 muzzle, Vector3 barrel)
    {
        var d = Vector3.Normalize(barrel);
        d.Y += 0.06f;
        Projectiles.Spawn(ProjectileKind.Cannonball, muzzle, d);
        Rig.AddShake(0.12f);
    }

    private void FireEnemyShell(Vector3 muzzle, Vector3 barrel)
    {
        var d = Vector3.Normalize(barrel);
        d.X += R.Spread(0.03f);
        d.Z += R.Spread(0.03f);
        Projectiles.Spawn(ProjectileKind.Shell, muzzle, d, null, new ShotStyle { DamageMul = GameConfig.Train.TurretBulletDamage / 4 });
        Effects.MuzzleFlash(muzzle, Vector3.Normalize(d), new Vector4(5, 2.4f, 0.6f, 1), 0.8f);
        Effects.FlashLight(muzzle, 0xff8a30, 14, 0.1f, 5);
    }

    // ---- Collision mediator -------------------------------------------------------------------

    private bool ResolveHit(Projectile p, Vector3 point)
    {
        if (p.Def.Owner == Owner.Enemy)
        {
            if (Heli.Alive && Vector3.DistanceSquared(point, Heli.Position) < Heli.Radius * Heli.Radius)
            {
                if (Heli.TakeDamage(p.Damage))
                {
                    Effects.Impact(point, new Vector4(5, 2, 0.5f, 1));
                    Effects.FlashLight(point, 0xff6a20, 30, 0.2f, 7);
                    Rig.AddShake(0.35f);
                    _hud.DamageFlash(0.55f);
                    if (!Heli.Alive) OnHeliDestroyed();
                }
                return true;
            }
            if (point.Y < 0.05f && World.Board.Contains(point.X, point.Z))
            {
                Effects.Impact(point);
                Effects.SnowPuff(point, 3);
                return true;
            }
            return false;
        }

        // Player: generous 2.5D for straight guns, true 3D for missiles, bolts and aimed shots.
        var exact = p.Kind is ProjectileKind.Missile or ProjectileKind.Nova || p.Aimed;
        if (p.Kind == ProjectileKind.Missile && p.Life < 0.3f) return false;
        if (Train != null)
        {
            var hit = Train.HitTest(point, exact);
            if (hit.HasValue)
            {
                var (car, target) = hit.Value;
                ApplyPlayerDamage(p, point, () => Train.Damage(car, target, p.Damage, point));
                GemImpact(p, point, null);
                return true;
            }
        }
        var mine = Mines.HitTest(exact ? point : new Vector3(point.X, GameConfig.Mines.Radius, point.Z));
        if (mine != null && point.Y < 3.5f)
        {
            ApplyPlayerDamage(p, point, () =>
            {
                if (!Mines.Damage(mine, p.Damage, point)) return;
                AddScore(Score.Mine);
                // SURPRISE EGG balls crack open: 20% chance of a supply.
                var lucky = mine.Egg && R.Next() < GameConfig.Cards.EggSupplyChance;
                if (lucky) SpawnSupply(new Vector3(mine.Pos.X, 0.8f, mine.Pos.Z));
                _hud.Kill("HELI", FeedColors.Heli, mine.Egg ? "EGG BALL" : "SPIKE BALL", FeedColors.Grey, lucky ? "+ SUPPLY" : null, FeedColors.Gold);
            });
            return true;
        }
        var block = Blocks.BlockAt(point.X, exact ? point.Y : MathF.Min(point.Y, GameConfig.BlockSize * 0.9f), point.Z);
        if (block != null && point.Y < 3.6f)
        {
            var at = new Vector3(point.X, GameConfig.BlockSize + 0.05f, point.Z);
            ApplyPlayerDamage(p, at, () => Blocks.Damage(block, p.Damage, at));
            GemImpact(p, at, block);
            return true;
        }
        return false;
    }

    private void ApplyPlayerDamage(Projectile p, Vector3 point, Action apply)
    {
        apply();
        switch (p.Kind)
        {
            case ProjectileKind.Plasma:
                Effects.Impact(point, new Vector4(4, 1, 4, 1));
                break;
            case ProjectileKind.Nova:
                Effects.Impact(point, new Vector4(1, 3, 4, 1));
                break;
            case ProjectileKind.Missile:
                Effects.Explosion(point, 0.45f);
                break;
            case ProjectileKind.Rocket:
            {
                Effects.Explosion(point, 0.9f);
                Rig.AddShake(0.2f);
                var s = GameConfig.BlockSize;
                foreach (var (dx, dz) in new[] { (s, 0f), (-s, 0f), (0f, s), (0f, -s) })
                {
                    var b = Blocks.BlockAt(point.X + dx, 0.5f, point.Z + dz);
                    if (b != null && !b.Cargo) Blocks.Damage(b, 1.5f, new Vector3(b.X, s, b.Z));
                }
                break;
            }
        }
    }

    private void GemImpact(Projectile p, Vector3 point, Block block)
    {
        if (!p.Gem.HasValue) return;
        if (p.Crit)
        {
            _hud.FloatText("CRITICAL!", point, new Color(0xff, 0x3b, 0x3b));
            Rig.AddShake(0.22f);
            Effects.SparkBurst(point, 14, 6, new Vector4(4, 1, 1, 1));
        }
        if (p.Gem == GemKind.Red) Effects.Explosion(point, 0.35f);
        if (p.Gem == GemKind.Green && block != null) Blocks.ApplyAcid(block);
    }

    private void OnHeliDestroyed()
    {
        _hud.Kill("ARMORED TRAIN", FeedColors.Train, "HELI", FeedColors.Heli, "☠", FeedColors.Train);
        Effects.Explosion(Heli.Position, 2.2f, 0x6a9a33, 26);
        Rig.Shake = 1.2f;
        Lives--;
        State = GameState.Dead;
        _deadTimer = 2.5f;
    }

    /// <summary>Ramming the train: 25 HP, knock-back, flicker, red vignette.</summary>
    private void CheckTrainCollision()
    {
        var t = Train;
        var h = Heli;
        if (t == null || t.Finished || !h.Alive || h.Invulnerable > 0 || State != GameState.Playing) return;
        var p = h.Position;
        var halfWidth = 1.15f * t.Scale + 0.7f;
        if (MathF.Abs(p.X - t.X) > halfWidth || p.Z < t.MinZ - 0.5f || p.Z > t.MaxZ + 0.5f) return;
        var side = MathF.Sign(p.X - t.X);
        if (side == 0) side = -1;
        if (!h.TakeDamage(GameConfig.Train.CollisionDamage)) return;
        h.Invulnerable = 1.5f * h.FlickerMul;
        h.Velocity.X = side * 13;
        h.Velocity.Z += t.Dir * t.Speed;
        Effects.Explosion(new Vector3(t.X + side * 1.6f, p.Y - 0.4f, p.Z), 0.8f, 0x3a3d42, 8);
        Rig.AddShake(0.9f);
        _hud.DamageFlash(1);
        if (!h.Alive) OnHeliDestroyed();
    }

    /// <summary>The passing train restocks empty cells right of the track, once per row and trip.</summary>
    private void RestockFarSide()
    {
        var t = Train;
        if (t == null || t.Destroyed || t.Finished) return;
        if (_restock.train != t || _restock.lap != t.Lap) _restock = (t, t.Lap, new HashSet<int>());
        for (var r = 0; r < Blocks.Rows; r++)
        {
            if (_restock.rows.Contains(r)) continue;
            var rowZ = Blocks.CellCenter(0, r).z;
            if (rowZ < t.MinZ || rowZ > t.MaxZ) continue;
            _restock.rows.Add(r);
            for (var c = 0; c < Blocks.Cols; c++)
            {
                if (Blocks.IsTrackCell(c) || Blocks.CellCenter(c, r).x < GameConfig.Track.X) continue;
                var cell = Blocks.Cell(c, r);
                if (cell is { Alive: true } || R.Next() > GameConfig.Train.RestockChance) continue;
                Blocks.PlaceBlock(c, r, Palette.BlockColors[(int)(R.Next() * 4)], from: new Vector3(GameConfig.Track.X + 1.2f, 3.6f, rowZ));
            }
        }
    }

    // ---- Weapons ------------------------------------------------------------------------------

    private ShotStyle CurrentShotStyle()
    {
        var gem = PowerUps.Gem;
        if (!gem.HasValue) return Gameplay.ShotStyle.Plain;
        var def = SupplyCatalog.Of(gem.Value);
        var crit = def.CritChance > 0 && R.Next() < def.CritChance;
        return new ShotStyle
        {
            Tint = Palette.ToLinear(gem == GemKind.Black ? 0x9a7cffu : def.Color),
            Gem = gem,
            Crit = crit,
            DamageMul = def.DamageMul * (crit ? def.CritMul : 1),
        };
    }

    private float FireRateMul => PowerUps.Gem is { } g ? SupplyCatalog.Of(g).RateMul : 1;

    private Vector3 AimFrom(Vector3 muzzle, float spread)
    {
        var target = _targeting.Lock(Time, Heli, Blocks, Train);
        _lastShotAimed = target.HasValue;
        var dir = target.HasValue ? Vector3.Normalize(target.Value.Position - muzzle) : Vector3.Normalize(Heli.ToWorldDirection(new Vector3(0, -0.045f, -1)));
        if (spread > 0)
        {
            dir.X += R.Spread(spread);
            dir.Z += R.Spread(spread);
            dir.Normalize();
        }
        return dir;
    }

    private void UpdateWeapons(float dt)
    {
        if (!Heli.Alive) return;
        _tMain -= dt;
        _tTriple -= dt;
        _tBurst -= dt;
        _tHoming -= dt;
        if (_tMain <= 0)
        {
            _tMain = GameConfig.Heli.MainInterval / FireRateMul;
            var pod = ++_side % 2 == 0 ? "podL" : "podR";
            var muzzle = Heli.Hardpoint(pod);
            var dir = AimFrom(muzzle, 0.012f);
            var style = CurrentShotStyle();
            style.Aimed = _lastShotAimed;
            Projectiles.Spawn(ProjectileKind.Tracer, muzzle, dir, null, style);
            Effects.MuzzleFlash(muzzle, dir, new Vector4(4.5f, 2.6f, 0.9f, 1), 0.6f);
        }
        if (PowerUps.Has(SupplyType.T) && _tTriple <= 0)
        {
            _tTriple = GameConfig.Heli.TripleInterval / FireRateMul;
            var muzzle = Heli.Hardpoint("chinGun");
            var center = AimFrom(muzzle, 0);
            foreach (var angle in TripleAngles)
            {
                var style = CurrentShotStyle();
                style.Aimed = _lastShotAimed;
                Projectiles.Spawn(ProjectileKind.Plasma, muzzle, Vector3.Transform(center, Matrix.CreateRotationY(angle)), null, style);
            }
            Effects.MuzzleFlash(muzzle, Heli.ToWorldDirection(new Vector3(0, 0, -1)), new Vector4(4, 1, 4, 1), 0.9f);
        }
        if (PowerUps.Has(SupplyType.D) && _tBurst <= 0)
        {
            _tBurst = GameConfig.Heli.BurstInterval;
            FireEightWay();
        }
        if (PowerUps.Has(SupplyType.R) && _tHoming <= 0)
        {
            var targets = _targeting.Collect(Heli.Position, GameConfig.Heli.HomingRange, Blocks, Train);
            _tHoming = targets.Count > 0 ? GameConfig.Heli.HomingInterval : 0.2f;
            if (targets.Count > 0)
            {
                var pick = targets[(int)(R.Next() * targets.Count)].Target;
                var left = ++_homingSide % 2 == 0;
                var muzzle = Heli.Hardpoint(left ? "podL" : "podR");
                var dir = Heli.ToWorldDirection(new Vector3(R.Spread(0.8f) + (left ? -0.5f : 0.5f), 1.4f, R.Spread(0.8f)));
                Projectiles.Spawn(ProjectileKind.Missile, muzzle, dir, pick);
                Effects.MuzzleFlash(muzzle, Vector3.Normalize(dir), new Vector4(5, 2.4f, 0.6f, 1), 0.6f);
                _backblast = (0.2f, left ? "podRearL" : "podRearR");
            }
        }
        UpdateBackblast(dt);
        UpdateExhaust(dt);
    }

    /// <summary>D power-up: 8 bolts in the heli's frame, each aimed at a target in its 45° sector.</summary>
    private void FireEightWay()
    {
        var targets = _targeting.Collect(Heli.Position, GameConfig.Heli.BurstRange, Blocks, Train);
        var origin = Heli.Position - new Vector3(0, 0.3f, 0);
        var sector = MathF.Cos(MathF.PI / 8);
        for (var k = 0; k < 8; k++)
        {
            var a = Heli.Yaw + k * MathF.PI / 4;
            float fx = -MathF.Sin(a), fz = -MathF.Cos(a);
            AimTarget? best = null;
            var bestD = float.MaxValue;
            foreach (var q in targets)
            {
                var d = MathF.Sqrt(q.Dx * q.Dx + q.Dz * q.Dz);
                if (d < 0.5f || (q.Dx * fx + q.Dz * fz) / d < sector) continue;
                if (d < bestD)
                {
                    bestD = d;
                    best = q.Target;
                }
            }
            var dir = best.HasValue ? best.Value.Position - origin : new Vector3(fx * 6, 0.8f - origin.Y, fz * 6);
            Projectiles.Spawn(ProjectileKind.Nova, origin, dir, null, CurrentShotStyle());
        }
        Effects.SparkBurst(origin, 10, 5, new Vector4(1.2f, 3, 4, 1));
    }

    /// <summary>Below 25% HP the helicopter trails thin black smoke.</summary>
    private void UpdateDamageSmoke(float dt)
    {
        if (!Heli.Alive || HealthRatio >= 0.25f) return;
        _damageSmokeTimer -= dt;
        if (_damageSmokeTimer > 0) return;
        _damageSmokeTimer = 0.05f;
        var p = Heli.Hardpoint(R.Chance(0.5f) ? "exhaustL" : "exhaustR");
        Effects.Smoke.Emit(new ParticleSpec
        {
            Position = p + new Vector3(R.Spread(0.15f), 0, R.Spread(0.15f)),
            Velocity = new Vector3(R.Spread(0.4f) - Heli.Velocity.X * 0.3f, R.Range(0.8f, 1.6f), R.Spread(0.4f) - Heli.Velocity.Z * 0.3f), Drag = 0.8f,
            Life = R.Range(1.0f, 1.6f), Size0 = 0.35f, Size1 = R.Range(1.4f, 2.0f), Aspect = 1,
            Color0 = new Vector4(0.06f, 0.06f, 0.07f, 0.75f), Color1 = new Vector4(0.25f, 0.25f, 0.27f, 0), HasColor1 = true, RotVel = R.Spread(0.8f),
        });
    }

    /// <summary>Afterburner flames + white contrails out of the wing pods (key-art look).</summary>
    private void UpdateExhaust(float dt)
    {
        _exhaustTimer -= dt;
        if (_exhaustTimer > 0) return;
        _exhaustTimer = 1 / 40f;
        var back = Vector3.Normalize(Heli.ToWorldDirection(new Vector3(0, -0.18f, 1)));
        foreach (var pod in RearPods)
        {
            var o = Heli.Hardpoint(pod);
            var speed = R.Range(5, 7);
            Effects.Sparks.Emit(new ParticleSpec { Position = o, Velocity = back * speed, Life = R.Range(0.1f, 0.16f), Size0 = 0.55f, Size1 = 0.3f, Aspect = 1, Stretch = 0.16f, Color0 = new Vector4(5, 3, 1.2f, 1), Color1 = new Vector4(3, 0.9f, 0.15f, 0), HasColor1 = true });
            Effects.Fireballs.Emit(new ParticleSpec { Position = o + back * 0.2f, Velocity = back * speed * 0.8f, Life = R.Range(0.1f, 0.16f), Size0 = R.Range(0.55f, 0.75f), Size1 = 0.25f, Aspect = 1, Rotation = R.Range(0, 6), Color0 = new Vector4(2.2f, 1.7f, 1.2f, 1), Color1 = new Vector4(1.6f, 0.7f, 0.3f, 0), HasColor1 = true });
            Effects.Fire.Emit(new ParticleSpec { Position = o, Velocity = back * speed * 0.5f, Life = 0.1f, Size0 = 1.3f, Size1 = 0.6f, Aspect = 1, Color0 = new Vector4(2.4f, 1.1f, 0.3f, 0.8f), Color1 = new Vector4(1.2f, 0.3f, 0.05f, 0), HasColor1 = true });
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = o + back * 0.6f, Velocity = new Vector3(back.X * 2.5f + R.Spread(0.2f), back.Y * 2.5f, back.Z * 2.5f + R.Spread(0.2f)), Drag = 1.2f,
                Life = R.Range(0.7f, 1.0f), Size0 = 0.25f, Size1 = 0.95f, Aspect = 1, Color0 = new Vector4(1, 1, 1, 0.42f), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true,
            });
        }
    }

    private void UpdateBackblast(float dt)
    {
        if (_backblast.time <= 0) return;
        _backblast.time -= dt;
        var back = Vector3.Normalize(Heli.ToWorldDirection(new Vector3(R.Spread(0.15f), -0.25f, 1)));
        foreach (var pod in RearPods)
        {
            var strength = pod == _backblast.pod ? 1 : 0.45f;
            var origin = Heli.Hardpoint(pod);
            for (var i = 0; i < 3; i++)
            {
                var speed = R.Range(5, 9) * strength;
                Effects.Fire.Emit(new ParticleSpec
                {
                    Position = origin, Velocity = new Vector3(back.X * speed + R.Spread(0.5f), back.Y * speed, back.Z * speed + R.Spread(0.5f)),
                    Life = R.Range(0.12f, 0.22f), Size0 = 0.55f * strength + 0.2f, Size1 = 0.15f, Aspect = 1, Color0 = new Vector4(2.6f, 1.3f, 0.35f, 1), Color1 = new Vector4(1.6f, 0.35f, 0.05f, 0), HasColor1 = true,
                });
            }
            Effects.Smoke.Emit(new ParticleSpec { Position = origin, Velocity = back * 3, Drag = 2, Life = 0.8f, Size0 = 0.4f, Size1 = 1.4f, Aspect = 1, Color0 = new Vector4(0.85f, 0.85f, 0.88f, 0.5f * strength), Color1 = new Vector4(1, 1, 1, 0), HasColor1 = true });
        }
    }

    // ---- Main step ----------------------------------------------------------------------------

    /// <summary>Attract-mode autopilot behind the title screen.</summary>
    private Vector2 DemoMove() => new(MathF.Sin(Time * 0.5f) * 0.6f, MathF.Sin(Time * 0.33f) * 0.35f);

    public void Step(float dt, PilotCommand cmd)
    {
        Time += dt;
        var playing = State == GameState.Playing;
        Vector2 move;
        if (playing && cmd.StickActive)
        {
            // Joystick / drag: screen-relative, the nose follows the direction unless a turn
            // button is held (then the heading is under manual control).
            move = Rig.ToCameraRelative(cmd.Stick, Heli.Position);
            Heli.FaceMovement = cmd.Turn == 0;
            Heli.TurnInput = cmd.Turn;
        }
        else if (playing)
        {
            // Keyboard pilot: move in the helicopter's own frame.
            float sy = MathF.Sin(Heli.Yaw), cy = MathF.Cos(Heli.Yaw);
            move = new Vector2(-sy * cmd.Forward + cy * cmd.Strafe, -cy * cmd.Forward - sy * cmd.Strafe);
            Heli.FaceMovement = false;
            Heli.TurnInput = cmd.Turn;
        }
        else
        {
            move = Rig.ToCameraRelative(DemoMove(), Heli.Position);
            Heli.FaceMovement = true;
            Heli.TurnInput = 0;
        }
        if (Heli.Alive) Heli.Update(dt, move);
        if (playing || State == GameState.Title) UpdateWeapons(dt);

        if (State == GameState.Dead)
        {
            _deadTimer -= dt;
            if (_deadTimer <= 0)
            {
                if (Lives > 0)
                {
                    Heli.Respawn();
                    State = GameState.Playing;
                }
                else
                {
                    State = GameState.Over;
                    Cards?.Cancel();
                    _hud.ShowGameOver(ScoreValue);
                }
            }
        }

        // The same train loops until its gem is destroyed; then the next wave brings a new one.
        if (Train == null || Train.Finished)
        {
            _trainTimer -= dt;
            if (_trainTimer <= 0)
            {
                if (Train != null && !Train.Destroyed)
                {
                    Train.RestartLap();
                    _hud.Toast($"THE TRAIN IS BACK - {MathF.Round(Train.Integrity * 100)}%");
                }
                else
                {
                    SpawnTrain();
                }
                _trainTimer = GameConfig.Train.RespawnDelay;
            }
        }
        Train?.Update(dt, Heli.Position, Heli.Alive);
        CheckTrainCollision();
        RestockFarSide();

        Blocks.Update(dt);
        Logistics.Update(dt, playing);
        Mines.Update(dt);
        Projectiles.Update(dt);
        PowerUps.Update(dt);
        if (_cardTimer > 0)
        {
            _cardTimer -= dt;
            if (_cardTimer <= 0) OfferCards();
        }
        UpdateSurpriseEggs(dt);
        Supplies.Update(dt, Heli.Position, Heli.Alive && State == GameState.Playing);
        UpdateReticle(dt);
        UpdateDamageSmoke(dt);
        Effects.Update(dt);
        World.Update(dt, Rig.Camera);
        World.RailSnow.Update(dt, Train, Effects);
        _clearers.Clear();
        if (Heli.Alive && Heli.Visible) _clearers.Add(new FloorSnow.Clearer(Heli.Position.X, Heli.Position.Z, 2.3f, 2.5f, true));
        Logistics.SnowClearers(_clearers);
        World.FloorSnow.Update(dt, System.Runtime.InteropServices.CollectionsMarshal.AsSpan(_clearers), Effects);
        Rig.Update(dt, Heli.Position);
    }

    // ---- Upgrade cards ------------------------------------------------------------------------

    private bool CardOpen(CardDefData d) => !_takenCards.Contains(d.Id) && (d.Requires == null || _takenCards.Contains(d.Requires));

    /// <summary>
    /// Two cards (or the last one left) the player hasn't taken yet, after a train went down. The
    /// mission can't be won without the cargo chopper and the engineer, so in the first offers one
    /// of the two is always the first of <see cref="GameConfig.Cards.MustHave"/> not taken yet.
    /// </summary>
    public void OfferCards()
    {
        if (State is not (GameState.Playing or GameState.Dead) || Cards == null || Cards.Active) return;
        var pool = _cardDefs.Where(CardOpen).ToList();
        if (pool.Count == 0) return;
        _offer.Clear();
        if (_offersMade < GameConfig.Cards.GuaranteedOffers)
        {
            var must = GameConfig.Cards.MustHave.Select(id => pool.Find(d => d.Id == id)).FirstOrDefault(d => d != null);
            if (must != null) _offer.Add(must);
        }
        foreach (var d in pool.Where(x => !_offer.Contains(x)).OrderBy(_ => R.Next()))
        {
            if (_offer.Count >= 2) break;
            _offer.Add(d);
        }
        _offersMade++;
        Cards.Show(_offer.ToArray(), ApplyCard);
    }

    /// <summary>SURPRISE EGG: an empty board brings 3 rolling balls down from the sky (one wave at a time).</summary>
    private void UpdateSurpriseEggs(float dt)
    {
        if (!_takenCards.Contains("surpriseEgg") || State != GameState.Playing) return;
        _eggTimer = MathF.Max(0, _eggTimer - dt);
        if (_eggTimer > 0 || Mines.EggsAlive > 0) return;
        if (Blocks.Blocks.Exists(b => b.Alive && !b.Cargo)) return;
        var e = Logistics.Engineer;
        var minX = Blocks.CellCenter(Logistics.Dock.Columns, 0).x - 0.75f;
        bool Free(float x, float z) =>
            !(e.Active && MathF.Sqrt((e.Position.X - x) * (e.Position.X - x) + (e.Position.Z - z) * (e.Position.Z - z)) < 2) && x > minX;
        if (Mines.DropEggs(GameConfig.Cards.EggCount, Free) > 0)
        {
            _eggTimer = GameConfig.Cards.EggCooldown;
            _hud.Toast("SURPRISE EGGS INCOMING!");
        }
    }

    public void ApplyCard(CardDefData def)
    {
        _takenCards.Add(def.Id);
        switch (def.Id)
        {
            case "engineer":
                Logistics.HireEngineer();
                _hud.Toast("FIELD ENGINEER INBOUND");
                break;
            case "gemMine":
                _gemDrops = true;
                _hud.Toast("GEM MINE - BLOCKS NOW DROP GEMS");
                break;
            case "cargoChopper":
                Logistics.EnableChopper();
                _hud.Toast(Logistics.Enabled ? "CARGO CHOPPER - PICK-UP EVERY 2 MINUTES" : "CARGO CHOPPER SIGNED - NOW YOU NEED AN ENGINEER");
                break;
            case "homing":
                _hud.Toast("HOMING ROCKETS UNLOCKED - LOOK FOR R SUPPLIES");
                // A first taste right away.
                Supplies.Spawn(SupplyType.R, new Vector3(Heli.Position.X, 2, Heli.Position.Z));
                break;
            case "doubleRow":
                Logistics.WidenDock();
                _hud.Toast("DOUBLE ROW - THE DOCK HOLDS TWICE AS MANY");
                break;
            case "flicker":
                Heli.FlickerMul = GameConfig.Cards.FlickerMul;
                _hud.Toast("FLICKER - LONGER SAFE TIME AFTER HITS");
                break;
            case "cargoTime":
                Logistics.SpeedUpChopper(GameConfig.Cards.CargoTimeMul);
                _hud.Toast("RUSH DELIVERY - CHOPPER COMES 30% SOONER");
                break;
            case "surpriseEgg":
                _hud.Toast("SURPRISE EGG - EMPTY BOARD? BALLS FROM THE SKY");
                _eggTimer = 0;
                break;
        }
    }

    /// <summary>
    /// Poster mode (Game.renderPoster): stages the key-art moment deterministically so a frame can
    /// be compared with the web build's screenshot.
    /// </summary>
    public void StagePoster()
    {
        _hud.HideOverlay();
        Heli.Steerable = false;
        Mines.AddPosterBalls();
        SpawnTrain();
        Train.ForceCruise();
        Heli.Position = Rig.HeliAnchor;
        const float dt = 1 / 30f;
        Train.SetHeadZ(GameConfig.Train.PosterHeadZ - Train.Speed * 3.2f);
        Rig.Update(dt, Heli.Position, true);
        PowerUps.Activate(SupplyType.T, 999);
        foreach (var (type, x, z) in new[] { (SupplyType.T, -4.6f, -2.2f), (SupplyType.G, -2.2f, -5.4f), (SupplyType.H, -7.4f, 3.4f) })
        {
            var crate = Supplies.Spawn(type, new Vector3(x, 0.62f, z));
            crate.Landed = true;
            crate.Vel = Vector3.Zero;
        }
        var debrisColors = new[] { 0xe01d22u, 0x36c225u, 0x0ea2a8u, 0xf6bd10u };
        for (var i = 0; i < 96; i++)
        {
            Heli.Position = Rig.HeliAnchor;
            if (i == 84 || i == 89)
            {
                foreach (var (x, y, z) in new[] { (-1.5f, 2.2f, -3f), (0.8f, 2.6f, -1.0f), (-3.5f, 2.4f, -2.0f), (2.0f, 2.0f, 2.5f), (-0.5f, 2.0f, 1.5f) })
                    Effects.Shatter(new Vector3(x + R.Spread(1), y, z + R.Spread(1)), debrisColors[(int)(R.Next() * 4)], 7, 1.1f, 0.16f, 0.36f);
            }
            Step(dt, default);
        }
        Effects.Explosion(new Vector3(1.2f, 1.8f, -1.2f), 1.0f);
        Effects.Explosion(new Vector3(-8.25f, 1.6f, 0.9f), 0.7f);
        for (var i = 0; i < 4; i++) Step(dt, default);
        // The hero frame always shows the helicopter (a last-frame hit would blink it out).
        Heli.Invulnerable = 0;
        Heli.Visible = true;
    }

    /// <summary>
    /// Calibration frame: the initial scene exactly as the web build shows it right after loading
    /// (no simulation step yet: no train, heli at the anchor with yaw 0, clouds placed once).
    /// </summary>
    public void StageStatic()
    {
        _hud.HideOverlay();
        Heli.Position = Rig.HeliAnchor;
        Heli.SetPose(0, 0, 0);
        Rig.Update(0, Heli.Position, true);
        World.Update(0, Rig.Camera);
    }

    /// <summary>Crosshair brackets on the locked target.</summary>
    private void UpdateReticle(float dt)
    {
        var target = State == GameState.Playing && Heli.Alive ? _targeting.Lock(Time, Heli, Blocks, Train) : null;
        _reticle.Begin();
        if (target.HasValue)
        {
            _reticleSpin += dt * 2;
            var p = target.Value.Position;
            var s = 1.7f + MathF.Sin(_reticleSpin * 3) * 0.12f;
            _reticle.Push(p.X, p.Y, p.Z, s, s, 1, 1, 1, 1, _reticleSpin);
        }
        _reticle.End();
    }

    public void Submit(RenderQueue queue)
    {
        World.Submit(queue);
        Blocks.Submit(queue);
        Logistics.Submit(queue);
        Mines.Submit(queue);
        Train?.Submit(queue);
        Heli.Submit(queue);
        Supplies.Submit(queue);
        Projectiles.Submit(queue);
        Effects.Submit(queue);
        queue.Add(_reticle);
    }
}
