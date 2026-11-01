using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Core;

/// <summary>
/// Gameplay and world layout constants (port of src/config/GameConfig.js). World units: one block
/// is <see cref="BlockSize"/> wide. +Y is up, -Z is away from the camera.
/// </summary>
public static class GameConfig
{
    public const float BlockSize = 1.5f;

    public static class Board
    {
        public const float MinX = -10.5f, MaxX = 7.5f, MinZ = -9f, MaxZ = 10.5f;
        public const float FrameHeight = 1.35f, FrameWidth = 0.9f;
    }

    public static class Blocks
    {
        public const float Hp = 5, ArmoredHp = 14;
        public const float SupplyChance = 0.2f, ArmoredChance = 0.2f;
        public const float ChainDelay = 0.09f;
        /// <summary>Green gem acid: damage every AcidTick seconds, random in [min, max].</summary>
        public const float AcidTick = 1, AcidDamageMin = 1, AcidDamageMax = 2;
        public const float MaxDropDistance = 7;
    }

    public static class Track
    {
        public const float X = 3.0f, StartZ = -95, EndZ = 55, Gauge = 1.9f, RailTop = 0.42f;
        /// <summary>How much snow piles up between the rails (1 = the original drifts).</summary>
        public const float RailSnow = 0.1f;
    }

    public static class Heli
    {
        public const float Altitude = 2.7f, Speed = 10, Accel = 4.5f;
        public const float TurnRate = 7, KeyTurnRate = 2.6f, YawAccel = 16;
        /// <summary>Stick more than this far behind the nose flies backwards (no auto turn-around).</summary>
        public const float ReverseAngle = 1.75f, ReverseTurnRate = 0;
        public const float MaxHp = 100;
        public const float MainInterval = 0.13f;
        public const float AimCone = 0.3f, AimRange = 18;
        public const float TripleInterval = 0.28f, BurstInterval = 0.42f, BurstRange = 10;
        public const float HomingInterval = 0.22f, HomingRange = 12;
        public const float Margin = 1.4f;
        public const float Radius = 1.3f;
        public const float DefaultYaw = -0.42f;
    }

    public static class Train
    {
        public const float Speed = 3.2f;
        public const int WagonCount = 6, GrowEvery = 1, MaxWagons = 14;
        public const float RespawnDelay = 4, TurretFireInterval = 1.4f;
        /// <summary>
        /// Trains come in from just off screen and their trip ends once off screen: visible line
        /// relative to the camera z (key-art camera) plus a margin (Train.js view*).
        /// </summary>
        public const float ViewBottom = -1.2f, ViewTop = -53.1f, ViewMargin = 3;
        /// <summary>Wait between leaving the screen and coming back, as a share of the old wait.</summary>
        public const float ReturnFactor = 0.8f;
        /// <summary>"Train incoming" warning lead time (s).</summary>
        public const float WarnLead = 2.5f;
        /// <summary>Cargo cubes drop when the cube under them is shot away (car units / s^2).</summary>
        public const float CargoGravity = 30;
        public const float FastChance = 0.3f, SlowChance = 0.3f, FastMul = 1.9f, SlowMul = 0.55f;
        public const float StopChance = 0.65f, StopDuration = 3, StoppedFireMul = 0.4f;
        public const float CannonIntervalMin = 1.2f, CannonIntervalMax = 2.8f;
        public const float TurretBulletDamage = 4, GemShieldMul = 0.05f;
        public const float WreckSpeed = 14, WreckAccel = 6;
        public const float CollisionDamage = 25, RestockChance = 0.6f;
        public const float Scale = 1.6f;
        /// <summary>Head position of the locomotive in the poster frame.</summary>
        public const float PosterHeadZ = 2.8f;
    }

    public static class Supply
    {
        public const float DurationMin = 8, DurationMax = 15;
        public const float PickupRadius = 1.25f, CrateLifetime = 18;
        public const float MagnetRadius = 5.2f, MagnetAccel = 30, MagnetDamping = 1.05f;
        public const float HealAmount = 35;
        public const float GemDamageMul = 1.25f;
    }

    /// <summary>Engineer's forklift, dock and the CH-47F cargo chopper (GameConfig.logistics).</summary>
    public static class Logistics
    {
        public const int DockCol = 0;
        public const float ForkliftSpeed = 3.4f;
        public const float ChinookInterval = 120;
        public const int GoalRed = 20, GoalGreen = 20, GoalBlue = 20;
    }

    /// <summary>
    /// Stages (GameConfig.stages): 1 the depot board, then up the line over the trestle bridge to
    /// 2 the terrace (balconies both sides, checkpoint gate, the BLOCK HAULER).
    /// </summary>
    public static class Stages
    {
        /// <summary>Cubes shot off a train on the terrace bounce onto it and break open: share that leaves a supply.</summary>
        public const float DropSupplyChance = 0.6f;
        public const float TerraceMinX = -15, TerraceMaxX = 21, TerraceMinZ = -84, TerraceMaxZ = -58;
        public const float CheckpointX = 3, CheckpointZ = -55.5f;
        public const float HaulerStartZ = -200, HaulerEndZ = -20;
        public const float BallDamage = 20, ChainLength = 2.3f, CraneHp = 24;
        public const string SaveFile = "checkpoint.json";
        /// <summary>Clusters of shootable blocks already on the terrace when stage 2 starts.</summary>
        public const int TerraceBlocks = 14;
        /// <summary>Exactly one loaded cargo cube in this many (all terrace trains) is a CRT comm device; stage 2 asks for CrtGoal.</summary>
        public const int CrtEvery = 100, CrtGoal = 15;
    }

    /// <summary>Tank level (TankLevel.cs): the player's Blender tank (GameConfig.tank).</summary>
    public static class Tank
    {
        public const float Speed = 7, ReverseMul = 0.6f, Accel = 9, Brake = 14, TurnSpeed = 1.6f, TurretSpeed = 2.4f;
        public const float Reload = 0.5f, RecoilKick = 7.5f, RecoilSpring = 140, RecoilDamping = 15;
        public const float ShellSpeed = 52, ShellRange = 60, BlinkHz = 1.4f, Bounds = 90, ShellDamage = 1;
        /// <summary>Direct fire: the barrel depresses / elevates toward the locked block (rad, rad/s).</summary>
        public const float ElevationMin = -0.36f, ElevationMax = 0.12f, ElevationSpeed = 1.4f;
        /// <summary>Smart aim: cone around the turret's aim direction in which a block is locked.</summary>
        public const float AimCone = 0.32f, LockRefresh = 0.12f;
        // Auto aim: the turret swings onto the best block by itself (swing angle weighs
        // AutoSwingWeight per rad against 0.3 per unit of distance; the current lock gets an AutoKeep
        // bonus) and fires once within AutoFireAngle of it. Q / E take over; ManualHold s after
        // release the auto lock resumes from where the gun points.
        public const float AutoSwingWeight = 5, AutoKeep = 4, AutoFireAngle = 0.07f, ManualHold = 0.35f;
        /// <summary>Collision footprint half size of the hull (tank space).</summary>
        public const float HalfX = 2.0f, HalfZ = 2.25f;
        /// <summary>Armour: the fighter's guns and bombs are the only things that hurt the tank.</summary>
        public const float Hp = 100;
        /// <summary>R power-up: homing missiles (like the heli's) launched off the turret.</summary>
        public const float HomingInterval = 0.42f, HomingRange = 44, MissileSpeed = 14, MissileDamage = 2;
        /// <summary>Follow camera: z = tank z * follow - back, looking `ahead` up the channel.</summary>
        public const float CameraHeight = 40, CameraBack = 28, CameraFollow = 0.5f, CameraAhead = 44, CameraFov = 46;
    }

    /// <summary>
    /// Tank arena (GameConfig.tankArena): a sloped concrete channel with shallow flowing water.
    /// Trains cross the rail at the far end and drop blocks into its lanes; the blocks slide down
    /// at a constant speed and whatever passes the dam lip piles up in the oval drain.
    /// </summary>
    public static class TankArena
    {
        public const float Block = 2.0f;
        public const int Lanes = 13;
        public const float TopZ = 64, Slope = 0.03f, SlideSpeed = 1.15f, RailZ = 69;
        public const float TrainSpeed = 9, TrainGap = 2.5f;
        public const int TrainCarsMin = 4, TrainCarsMax = 6;
        public const float DropChance = 0.45f, DoubleChance = 0.25f;
        public const int PhaseBlocks = 1000, BreakGoal = 900, DrainLimit = 100;
        public const float HpWeak = 1, HpNormal = 2, HpStrong = 4, HpSupply = 2;
        public const float OddsWeak = 0.3f, OddsStrong = 0.18f, OddsSupply = 0.08f;
        public const float ChainDelay = 0.09f;
        public const float DrainZ = -6.2f, DrainRx = 14, DrainRz = 5.2f, DrainDepth = 5, DrainWater = 1.2f;
        public const float PowerTime = 12;
        /// <summary>
        /// The way in and out (TankArena.js): +x is the screen's LEFT. A round base at the bottom left,
        /// a road into the left wall's gap; the right wall's gap has a fence gate that opens when
        /// phase 1 is won (road lines come with the export: Prefabs.TankArena).
        /// </summary>
        public const float GapZ0 = 2.2f, GapZ1 = 11.4f;
        public const float BaseX = 48, BaseZ = 4, BaseR = 10, RoadWidth = 9.5f, Phase2X = 58;
        /// <summary>The land lies higher than the water: a concrete ramp (RampLength outside the wall) runs down through each gap.</summary>
        public const float GroundY = 2.3f, RampLength = 10;
        public static float RampEnd => Width / 2 + 1.2f + RampLength;
        /// <summary>Skill cards (level "tank"): one pick every CardEvery broken blocks.</summary>
        public const int CardEvery = 200;
        public static float Width => Block * Lanes;
        public static float RailY => Slope * TopZ + 3.0f;
        public static float FloorHeight(float z) => Slope * Math.Clamp(z, 0, TopZ);
    }

    /// <summary>
    /// The Blocked Pixel Panzer fighter (GameConfig.fighter, JetFighter in TankCombat.cs): a strafing
    /// pass every 7-20 s, 3-4 s of machine-gun fire, then a bomb aimed at the tank.
    /// </summary>
    public static class Fighter
    {
        public const float Scale = 1.8f, Altitude = 15, Dive = 4, Speed = 21, Approach = 105, Exit = 110, PassOffset = 1.5f;
        public const float GapMin = 7, GapMax = 20, FirstDelay = 9, Hp = 6, HitRadius = 3.4f;
        public const float StrafeMin = 3, StrafeMax = 4, FireRate = 11, BulletSpeed = 62, BulletDamage = 0.7f, Spread = 1.8f;
        public const float BombGravity = 18, BombRadius = 5.5f, BombDamage = 30;
    }

    /// <summary>Upgrade cards (GameConfig.cards).</summary>
    public static class Cards
    {
        public const float OfferDelay = 1.6f;
        public const float GemDropChance = 0.14f;
        public const int GuaranteedOffers = 2;
        public static readonly string[] MustHave = { "cargoChopper", "engineer" };
        public const int EggCount = 3;
        public const float EggCooldown = 4, EggSupplyChance = 0.2f;
        public const float FlickerMul = 2, CargoTimeMul = 0.7f;
    }

    /// <summary>Spiked iron balls (SURPRISE EGG card).</summary>
    public static class Mines
    {
        public const float Speed = 1.6f, Radius = 0.62f;
    }

    public static class Camera
    {
        public const float FollowStrength = 0.2f;
        public static readonly Vector3 Position = new(-8.6f, 11.7f, 13.8f);
        public const float PitchDeg = 42, YawDeg = 19, RollDeg = 0, Fov = 60, LensK = 0.18f;
        public static readonly Vector2 HeliScreen = new(850, 690);
        /// <summary>Key-art reference resolution used for screen placements.</summary>
        public static readonly Vector2 Reference = new(1672, 941);
    }
}

/// <summary>Block colour keys in pick order (Palette.js BLOCK_COLOR_KEYS).</summary>
public enum BlockColor { Red, Green, Teal, Yellow }

public static class Palette
{
    public static readonly BlockColor[] BlockColors = { BlockColor.Red, BlockColor.Green, BlockColor.Teal, BlockColor.Yellow };

    /// <summary>sRGB colours as authored (UI / particles).</summary>
    public static Color Block(BlockColor c) => c switch
    {
        BlockColor.Red => new Color(0xe0, 0x1d, 0x22),
        BlockColor.Green => new Color(0x36, 0xc2, 0x25),
        BlockColor.Teal => new Color(0x0e, 0xa2, 0xa8),
        _ => new Color(0xf6, 0xbd, 0x10),
    };

    public static string Key(BlockColor c) => c switch
    {
        BlockColor.Red => "red",
        BlockColor.Green => "green",
        BlockColor.Teal => "teal",
        _ => "yellow",
    };

    public static BlockColor FromKey(string key) => key switch
    {
        "red" => BlockColor.Red,
        "green" => BlockColor.Green,
        "teal" => BlockColor.Teal,
        _ => BlockColor.Yellow,
    };

    /// <summary>sRGB byte colour to linear float RGB (what the shaders work in).</summary>
    public static Vector3 ToLinear(Color c) => new(SrgbToLinear(c.R / 255f), SrgbToLinear(c.G / 255f), SrgbToLinear(c.B / 255f));

    public static Vector3 ToLinear(uint hex) => ToLinear(new Color((int)((hex >> 16) & 255), (int)((hex >> 8) & 255), (int)(hex & 255)));

    public static float SrgbToLinear(float c) => c <= 0.04045f ? c / 12.92f : MathF.Pow((c + 0.055f) / 1.055f, 2.4f);
}
